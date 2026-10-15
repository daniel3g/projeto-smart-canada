// esp32-city-01
//
// Maquete de cidade inteligente. Lê sensores, aciona atuadores, publica
// telemetria e busca comandos na API.
//
// Este sketch é só o agendador. A lógica vive nos módulos:
//
//   net        Wi-Fi e relógio
//   sensors    DHT11 e sensor de som
//   actuators  chave lógica -> GPIO
//   lighting   LDR acende o LED da rua ao escurecer, sem nuvem
//   cloud      HTTP contra /api/iot
//
// O loop nunca bloqueia: todo agendamento usa millis(). O único delay() do
// firmware está no setup, para o Serial subir antes do primeiro log.
// Ver FIRMWARE.md "Loop principal".

#if !__has_include("config.h")
#error "Falta config.h. Copie config.example.h para config.h e preencha."
#endif

#include "config.h"

#include "actuators.h"
#include "cloud.h"
#include "lighting.h"
#include "net.h"
#include "pins.h"
#include "sensors.h"

// O DHT11 não entrega leitura confiável mais rápido que isso. É local, não
// custa requisição, e roda mesmo sem rede.
constexpr unsigned long DHT_INTERVAL_MS = 5000;

// O ritmo da rede não está aqui: quem decide é o servidor, via nextPollMs.
// Em repouso ele manda dormir 30 s; com comando em aberto, 1 s. Assim a
// política de consumo muda sem regravar firmware.
// Ver ARCHITECTURE.md "Orçamento de requisições".

unsigned long lastDhtMs = 0;
unsigned long lastSyncMs = 0;

bool wasCloudReady = false;

/** Subtração de unsigned, correta também quando millis() dá a volta. */
bool due(unsigned long last, unsigned long interval) {
  return millis() - last >= interval;
}

/**
 * Com validação de certificado ligada, não há como falar com a API antes do
 * NTP responder: o ESP32 acorda em 1970 e todo certificado pareceria expirado.
 */
bool cloudReady() {
  if (!netConnected()) {
    return false;
  }

#if API_INSECURE_TLS
  return true;
#else
  return netTimeSynced();
#endif
}

void setup() {
  Serial.begin(115200);
  delay(100);  // único delay do firmware: deixa o Serial subir antes do log

  Serial.println();
  Serial.println("=== esp32-city-01 ===");
  Serial.printf("dispositivo: %s\n", DEVICE_ID);
  Serial.printf("api: %s\n", API_BASE_URL);

  // Atuadores primeiro: a maquete sobe num estado conhecido e seguro.
  actuatorsBegin();
  sensorsBegin();
  lightingBegin();
  cloudBegin();
  netBegin();
}

void loop() {
  netLoop();
  sensorsPoll();
  lightingPoll();

  // O DHT11 é lido mesmo sem rede. Sem nuvem, a maquete continua medindo.
  if (due(lastDhtMs, DHT_INTERVAL_MS)) {
    lastDhtMs = millis();
    sensorsReadDht();
  }

  const bool ready = cloudReady();

  // Ao conectar, sincroniza imediatamente: depois de um reboot os atuadores
  // estão desligados e o painel pode querer outra coisa.
  if (ready && !wasCloudReady) {
    Serial.println("[loop] nuvem alcancavel, sincronizando estado");
    lastSyncMs = millis();
    cloudSync();
  }

  wasCloudReady = ready;

  if (!ready) {
    // Sem nuvem os atuadores permanecem no último estado conhecido e nada é
    // reiniciado. Ver FIRMWARE.md "Estado offline".
    return;
  }

  if (due(lastSyncMs, cloudNextPollMs())) {
    lastSyncMs = millis();
    cloudSync();
  }
}
