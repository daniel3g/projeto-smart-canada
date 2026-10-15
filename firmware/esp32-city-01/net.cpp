#include "net.h"

#include <WiFi.h>
#include <time.h>

#include "config.h"

namespace {

/**
 * Tempo que uma tentativa de associação tem para terminar.
 *
 * Associar leva de 2 a 8 segundos numa rede doméstica. A primeira versão disto
 * reiniciava a conexão a cada 1 s e, como cada `WiFi.begin()` aborta a
 * tentativa anterior, o dispositivo nunca chegava a conectar — o stack do
 * ESP32 respondia "sta is connecting, cannot set config". O prazo abaixo
 * existe para não repetir esse erro.
 */
constexpr unsigned long CONNECT_TIMEOUT_MS = 15000;

// Backoff entre tentativas que estouraram o prazo.
constexpr unsigned long RETRY_MIN_MS = 5000;
constexpr unsigned long RETRY_MAX_MS = 60000;

unsigned long retryDelayMs = RETRY_MIN_MS;
unsigned long attemptStartedMs = 0;
unsigned long lastFailureMs = 0;
bool attemptInProgress = false;

// Detecta a transição desconectado -> conectado. Usar o backoff para isso
// falharia na primeira conexão bem-sucedida, quando ele ainda está no valor
// inicial.
bool wasConnected = false;

bool timeSynced = false;
unsigned long lastTimeCheckMs = 0;

/** Traduz o status para algo diagnosticável no Serial. */
const char* statusText(wl_status_t status) {
  switch (status) {
    case WL_NO_SHIELD:
      return "sem interface";
    case WL_IDLE_STATUS:
      return "ocioso";
    case WL_NO_SSID_AVAIL:
      return "rede nao encontrada (SSID errado ou fora de alcance)";
    case WL_SCAN_COMPLETED:
      return "varredura concluida";
    case WL_CONNECTED:
      return "conectado";
    case WL_CONNECT_FAILED:
      return "falha na associacao (senha errada?)";
    case WL_CONNECTION_LOST:
      return "conexao perdida";
    case WL_DISCONNECTED:
      return "desconectado";
    default:
      return "desconhecido";
  }
}

void startConnect() {
  Serial.printf("[wifi] conectando a %s\n", WIFI_SSID);

  // true também libera a configuração anterior, evitando o erro
  // "cannot set config" quando uma tentativa ainda estava pendente.
  WiFi.disconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  attemptStartedMs = millis();
  attemptInProgress = true;
}

/**
 * Diagnóstico na falha: a rede configurada está ao alcance?
 *
 * O status do stack não distingue "SSID inexistente" de "senha errada" — nos
 * dois casos costuma reportar apenas "desconectado". Uma varredura responde
 * essa pergunta e economiza muito tempo de adivinhação quando a maquete troca
 * de local.
 *
 * Bloqueia por 2 a 3 segundos, e só no caminho de falha, quando o dispositivo
 * não tem nada melhor a fazer.
 */
void reportScan() {
  // Parar a tentativa antes de varrer. Com setAutoReconnect ligado o driver
  // segue tentando associar, o rádio fica ocupado e a varredura volta vazia —
  // reportando "nenhuma rede" numa sala cheia delas.
  WiFi.disconnect(true, false);
  delay(200);

  const int found = WiFi.scanNetworks();

  if (found <= 0) {
    Serial.println("[wifi] varredura nao encontrou nenhuma rede");
    WiFi.scanDelete();
    return;
  }

  for (int i = 0; i < found; i++) {
    if (WiFi.SSID(i) == WIFI_SSID) {
      Serial.printf(
          "[wifi] %s esta ao alcance (rssi %d dBm, canal %d). "
          "Se nao conecta, suspeite da senha.\n",
          WIFI_SSID, WiFi.RSSI(i), WiFi.channel(i));
      WiFi.scanDelete();
      return;
    }
  }

  Serial.printf("[wifi] %s NAO esta ao alcance. Redes visiveis (%d):\n",
                WIFI_SSID, found);

  for (int i = 0; i < found && i < 8; i++) {
    Serial.printf("         %s (rssi %d dBm)\n", WiFi.SSID(i).c_str(),
                  WiFi.RSSI(i));
  }

  Serial.println("[wifi] Corrija WIFI_SSID em config.h.");
  WiFi.scanDelete();
}

void startTimeSync() {
  // UTC. O servidor manda timestamps em UTC e a interface formata no fuso do
  // navegador, então o dispositivo não precisa saber o fuso local.
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.println("[ntp] sincronizando relogio");
}

}  // namespace

void netBegin() {
  WiFi.mode(WIFI_STA);

  // Deixa o core do ESP32 tentar reconectar sozinho, além do nosso backoff.
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);

  startConnect();
}

void netLoop() {
  const unsigned long now = millis();

  if (WiFi.status() == WL_CONNECTED) {
    attemptInProgress = false;

    if (!wasConnected) {
      wasConnected = true;
      retryDelayMs = RETRY_MIN_MS;

      Serial.printf("[wifi] conectado, ip %s, rssi %d dBm\n",
                    WiFi.localIP().toString().c_str(), WiFi.RSSI());

      // Só na primeira vez: o relógio não precisa ser refeito a cada
      // reconexão de Wi-Fi.
      if (!timeSynced) {
        startTimeSync();
      }
    }

    // Confere o relógio de vez em quando, sem gastar ciclo em toda volta.
    if (!timeSynced && now - lastTimeCheckMs >= 1000) {
      lastTimeCheckMs = now;

      // Qualquer valor acima de 2020 indica que o NTP respondeu.
      const time_t epoch = time(nullptr);
      if (epoch > 1600000000) {
        timeSynced = true;
        Serial.printf("[ntp] relogio sincronizado: %lu\n",
                      static_cast<unsigned long>(epoch));
      }
    }

    return;
  }

  if (wasConnected) {
    wasConnected = false;
    Serial.println("[wifi] conexao perdida");
  }

  // Tentativa em curso: deixar terminar. Chamar begin() de novo aqui abortaria
  // a associação e o dispositivo giraria sem nunca conectar.
  if (attemptInProgress) {
    if (now - attemptStartedMs < CONNECT_TIMEOUT_MS) {
      return;
    }

    Serial.printf("[wifi] tentativa expirou: %s\n",
                  statusText(WiFi.status()));

    attemptInProgress = false;

    // Só na primeira falha de uma sequência: repetir a varredura a cada
    // tentativa poluiria o log sem acrescentar nada.
    if (retryDelayMs == RETRY_MIN_MS) {
      reportScan();
    }

    lastFailureMs = millis();

    retryDelayMs = retryDelayMs * 2;
    if (retryDelayMs > RETRY_MAX_MS) {
      retryDelayMs = RETRY_MAX_MS;
    }

    Serial.printf("[wifi] proxima tentativa em %lu s\n", retryDelayMs / 1000);
    return;
  }

  if (now - lastFailureMs < retryDelayMs) {
    return;
  }

  startConnect();
}

bool netConnected() {
  return WiFi.status() == WL_CONNECTED;
}

bool netTimeSynced() {
  return timeSynced;
}

int netRssi() {
  return WiFi.RSSI();
}
