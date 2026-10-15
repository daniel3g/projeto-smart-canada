#include "cloud.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>

#include "actuators.h"
#include "config.h"
#include "lighting.h"
#include "net.h"
#include "pins.h"
#include "sensors.h"

#if ARDUINOJSON_VERSION_MAJOR < 7
#error "Este firmware usa a API do ArduinoJson 7. Atualize a biblioteca no Gerenciador de Bibliotecas."
#endif

namespace {

constexpr char FIRMWARE_VERSION[] = "0.2.0";

constexpr uint16_t HTTP_TIMEOUT_MS = 5000;

// Fallback até o servidor dizer o ritmo, e teto de segurança caso ele mande um
// valor absurdo.
constexpr unsigned long POLL_DEFAULT_MS = 30000;
constexpr unsigned long POLL_MIN_MS = 500;
constexpr unsigned long POLL_MAX_MS = 300000;

// Penalidades. Credencial errada não se resolve tentando mais rápido, e 429
// existe justamente para pedir que o cliente pare.
constexpr unsigned long PENALTY_AUTH_MS = 60000;
constexpr unsigned long PENALTY_RATE_MS = 30000;

// Comandos confirmados por ciclo. Um UUID ocupa 36 caracteres.
constexpr int MAX_PENDING_ACKS = 8;
constexpr size_t UUID_BUFFER = 40;

struct PendingAck {
  char id[UUID_BUFFER];
  bool executed;
  bool reportedState;
  const char* error;  // literal estático, nunca memória dinâmica
};

/**
 * Dois clientes, escolhidos pelo esquema de API_BASE_URL.
 *
 * A primeira versão usava sempre o cliente TLS. Com `http://` na bancada, ele
 * tentava handshake contra um servidor em texto claro e o connect falhava com
 * "connection refused" — enquanto Wi-Fi, rota e servidor estavam perfeitos.
 * O erro parecia de rede e era de protocolo.
 *
 * WiFiClientSecure herda de WiFiClient, então uma referência serve para os
 * dois casos.
 */
WiFiClient plainClient;
WiFiClientSecure secureClient;
bool useTls = false;

WiFiClient& transport() {
  if (useTls) {
    return secureClient;
  }

  return plainClient;
}

HTTPClient http;

unsigned long blockedUntilMs = 0;
unsigned long nextPollMs = POLL_DEFAULT_MS;

PendingAck pendingAcks[MAX_PENDING_ACKS];
int pendingAckCount = 0;

bool isBlocked() {
  if (blockedUntilMs == 0) {
    return false;
  }

  if (millis() >= blockedUntilMs) {
    blockedUntilMs = 0;
    Serial.println("[http] fim da penalidade, voltando a tentar");
    return false;
  }

  return true;
}

void penalize(unsigned long durationMs, const char* reason) {
  blockedUntilMs = millis() + durationMs;
  Serial.printf("[http] pausando %lu s: %s\n", durationMs / 1000, reason);
}

void queueAck(const char* id, bool executed, bool reportedState,
              const char* error) {
  if (pendingAckCount >= MAX_PENDING_ACKS) {
    // Perder uma confirmação não perde o estado: o mapa de atuadores do ciclo
    // seguinte informa a verdade, e o servidor reconcilia.
    Serial.println("[ack] fila cheia, confirmacao descartada");
    return;
  }

  PendingAck& ack = pendingAcks[pendingAckCount++];
  strncpy(ack.id, id, UUID_BUFFER - 1);
  ack.id[UUID_BUFFER - 1] = '\0';
  ack.executed = executed;
  ack.reportedState = reportedState;
  ack.error = error;
}

/** Interpreta o status. Retorna true somente para 2xx. */
bool handleStatus(int status, const String& body) {
#if DEBUG_HTTP
  Serial.printf("[http] sync -> %d %s\n", status, body.c_str());
#endif

  if (status >= 200 && status < 300) {
    return true;
  }

  if (status == 401 || status == 403) {
    Serial.printf("[http] recusado (%d). Confira DEVICE_ID e DEVICE_KEY.\n",
                  status);
    penalize(PENALTY_AUTH_MS, "credencial recusada");
    return false;
  }

  if (status == 429) {
    penalize(PENALTY_RATE_MS, "limite de requisicoes");
    return false;
  }

  if (status == 404) {
    // SENSOR_UNKNOWN rejeita o pacote inteiro: banco e firmware estão fora de
    // sincronia. Insistir no mesmo ritmo não resolve.
    Serial.println("[http] 404: sensor desconhecido ou rota inexistente");
    return false;
  }

  if (status < 0) {
    Serial.printf("[http] falha de transporte (%d: %s)\n", status,
                  HTTPClient::errorToString(status).c_str());
    return false;
  }

  Serial.printf("[http] servidor respondeu %d\n", status);
  return false;
}

void applyDesired(JsonObject desired) {
  for (JsonPair entry : desired) {
    const char* key = entry.key().c_str();
    const bool wanted = entry.value().as<bool>();

    bool found = false;
    bool current = false;

    for (int i = 0; i < actuatorCount(); i++) {
      if (strcmp(actuatorKeyAt(i), key) == 0) {
        found = true;
        current = actuatorStateAt(i);
        break;
      }
    }

    if (!found) {
      // A API conhece um atuador que este firmware não tem. Normalmente
      // significa tabela e pinagem fora de sincronia.
      Serial.printf("[sync] atuador desconhecido no firmware: %s\n", key);
      continue;
    }

    if (current != wanted) {
      Serial.printf("[sync] reconciliando %s: %s -> %s\n", key,
                    current ? "ligado" : "desligado",
                    wanted ? "ligado" : "desligado");
      actuatorApply(key, wanted);
    }
  }
}

void applyCommands(JsonArray commands) {
  for (JsonObject command : commands) {
    const char* id = command["id"];
    const char* actuator = command["actuator"];
    const char* type = command["type"];

    if (id == nullptr) {
      continue;
    }

    if (type == nullptr || strcmp(type, "set_boolean") != 0) {
      Serial.printf("[sync] tipo nao suportado: %s\n",
                    type == nullptr ? "(nulo)" : type);
      queueAck(id, false, false, "unsupported command type");
      continue;
    }

    if (actuator == nullptr) {
      queueAck(id, false, false, "missing actuator");
      continue;
    }

    const bool value = command["value"].as<bool>();

    if (!actuatorApply(actuator, value)) {
      queueAck(id, false, false, "GPIO unavailable");
      continue;
    }

    queueAck(id, true, value, nullptr);
  }
}

}  // namespace

void cloudBegin() {
  // O esquema da URL decide o transporte. Nada de TLS contra servidor em
  // texto claro, nem o contrário.
  useTls = strncmp(API_BASE_URL, "https://", 8) == 0;

  if (!useTls) {
    Serial.println("[http] sem TLS: API_BASE_URL usa http (bancada)");
    return;
  }

#if API_INSECURE_TLS
  // Criptografa, mas não autentica o servidor. Ver o aviso em config.example.h.
  secureClient.setInsecure();
  Serial.println("[tls] AVISO: servidor nao autenticado (API_INSECURE_TLS=1)");
#else
  secureClient.setCACert(API_ROOT_CA);
  Serial.println("[tls] validando certificado do servidor");
#endif
}

bool cloudSync() {
  if (isBlocked() || !netConnected()) {
    return false;
  }

  JsonDocument doc;
  doc["firmwareVersion"] = FIRMWARE_VERSION;
  doc["wifiRssi"] = netRssi();
  doc["uptimeSeconds"] = static_cast<uint32_t>(millis() / 1000);

  // ------------------------------------------------------------- leituras
  JsonArray readings = doc["readings"].to<JsonArray>();

  // O DHT11 falha às vezes. Enquanto não houver leitura válida, o pacote sai
  // só com o som: melhor publicar menos do que publicar NaN.
  if (sensorsDhtValid()) {
    JsonObject temp = readings.add<JsonObject>();
    temp["key"] = KEY_TEMPERATURE;
    temp["value"] = sensorsTemperature();
    temp["unit"] = "celsius";

    JsonObject hum = readings.add<JsonObject>();
    hum["key"] = KEY_HUMIDITY;
    hum["value"] = sensorsHumidity();
    hum["unit"] = "percent";
  }

  // A trava, não o estado instantâneo: com ciclo de 30 s, publicar o
  // instantâneo perderia quase todo evento curto. Ver sensors.h.
  JsonObject sound = readings.add<JsonObject>();
  sound["key"] = KEY_SOUND;
  sound["value"] = sensorsSoundLatched();
  sound["unit"] = "boolean";

  if (lightingValid()) {
    JsonObject light = readings.add<JsonObject>();
    light["key"] = KEY_LUMINOSITY;
    light["value"] = lightingLuminosityPercent();
    light["unit"] = "percent";

    // O estado vai no ciclo normal, não na hora da troca: chega ao painel em
    // até 30 s, sem requisição extra a cada sombra que passa.
    JsonObject street = readings.add<JsonObject>();
    street["key"] = KEY_STREET_LIGHTS;
    street["value"] = lightingOn();
    street["unit"] = "boolean";
  }

  // --------------------------------------------------------- estado real
  JsonObject states = doc["actuators"].to<JsonObject>();
  for (int i = 0; i < actuatorCount(); i++) {
    states[actuatorKeyAt(i)] = actuatorStateAt(i);
  }

  // ----------------------------------------- confirmações do ciclo anterior
  if (pendingAckCount > 0) {
    JsonArray acks = doc["acks"].to<JsonArray>();

    for (int i = 0; i < pendingAckCount; i++) {
      JsonObject ack = acks.add<JsonObject>();
      ack["id"] = pendingAcks[i].id;

      if (pendingAcks[i].executed) {
        ack["status"] = "executed";
        ack["reportedState"] = pendingAcks[i].reportedState;
      } else {
        ack["status"] = "failed";
        ack["error"] = pendingAcks[i].error;
      }
    }
  }

  String payload;
  serializeJson(doc, payload);

  http.begin(transport(), String(API_BASE_URL) + "/sync");
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setConnectTimeout(HTTP_TIMEOUT_MS);

  // Sem keep-alive, cada ciclo pagaria um handshake TLS de 1 a 2 s.
  http.setReuse(true);

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Id", DEVICE_ID);
  http.addHeader("X-Device-Key", DEVICE_KEY);

  const int status = http.POST(payload);
  const String body = http.getString();
  const bool ok = handleStatus(status, body);

  http.end();

  if (!ok) {
    // As confirmações continuam na fila para a próxima tentativa.
    return false;
  }

  // Enviadas com sucesso: a fila pode ser esvaziada e a janela de detecção de
  // som recomeça.
  pendingAckCount = 0;
  sensorsClearSoundLatch();

  JsonDocument response;
  if (deserializeJson(response, body) != DeserializationError::Ok) {
    Serial.println("[sync] resposta ilegivel");
    return false;
  }

  if (response["nextPollMs"].is<unsigned long>()) {
    const unsigned long requested = response["nextPollMs"].as<unsigned long>();
    nextPollMs = constrain(requested, POLL_MIN_MS, POLL_MAX_MS);
  }

  // Reconciliação antes dos comandos: o estado desejado é a meta, o comando é
  // o pedido explícito que vem a seguir e vence em caso de conflito.
  applyDesired(response["actuators"].as<JsonObject>());
  applyCommands(response["commands"].as<JsonArray>());

  return true;
}

unsigned long cloudNextPollMs() {
  return nextPollMs;
}

bool cloudBlocked() {
  return isBlocked();
}
