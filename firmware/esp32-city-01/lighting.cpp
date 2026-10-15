#include "lighting.h"

#include "pins.h"

namespace {

// Leitura do ADC de 12 bits: 0 a 4095.
//
// O sentido depende de como o divisor foi montado. Com o LDR entre o 3,3 V e
// o pino (resistor para o GND), escurecer BAIXA a leitura; invertido, SOBE.
// LDR_DARK_IS_HIGH registra qual dos dois é o da maquete.
//
// Medido na maquete em 2026-10-15: luz da sala ~2450, LDR tapado 600 a 850.
constexpr bool LDR_DARK_IS_HIGH = false;

// Histerese: acende ao passar de um limiar e só apaga ao voltar além do outro.
// Com um limiar só, no crepúsculo a leitura fica em cima dele e o LED pisca.
// Valores no sentido "escuro" (4095 - bruto), já corrigidos por
// LDR_DARK_IS_HIGH: acende com bruto abaixo de ~1200, apaga acima de ~1600.
constexpr int DARK_ON = 2900;
constexpr int DARK_OFF = 2500;

constexpr unsigned long SAMPLE_INTERVAL_MS = 100;
// Leitura bruta no Serial, para recalibrar. A troca de estado sempre é logada.
constexpr unsigned long LOG_INTERVAL_MS = 10000;

// Média móvel exponencial. Uma sombra passando ou o reflexo do próprio LED
// no LDR não devem virar o estado; a média leva uns 2 s para cruzar.
constexpr float SMOOTHING = 0.05f;

float darkness = -1;  // negativo: ainda sem leitura
bool lightOn = false;
unsigned long lastSampleMs = 0;
unsigned long lastLogMs = 0;

int readDarkness() {
  const int raw = analogRead(PIN_LDR);
  return LDR_DARK_IS_HIGH ? raw : 4095 - raw;
}

void setLight(bool on) {
  lightOn = on;
  digitalWrite(PIN_STREET_LIGHT, on ? HIGH : LOW);
  Serial.printf("[luz] %s (escuridao %d)\n", on ? "acesa" : "apagada",
                static_cast<int>(darkness));
}

}  // namespace

void lightingBegin() {
  pinMode(PIN_STREET_LIGHT, OUTPUT);
  digitalWrite(PIN_STREET_LIGHT, LOW);

  // Faixa completa de 0 a 3,3 V no ADC.
  analogSetPinAttenuation(PIN_LDR, ADC_11db);
}

void lightingPoll() {
  const unsigned long now = millis();

  if (now - lastSampleMs < SAMPLE_INTERVAL_MS) {
    return;
  }
  lastSampleMs = now;

  const int sample = readDarkness();
  darkness = darkness < 0 ? sample : darkness + SMOOTHING * (sample - darkness);

  if (!lightOn && darkness >= DARK_ON) {
    setLight(true);
  } else if (lightOn && darkness <= DARK_OFF) {
    setLight(false);
  }

  if (now - lastLogMs >= LOG_INTERVAL_MS) {
    lastLogMs = now;
    Serial.printf("[ldr] bruto %d, escuridao %d, luz %s\n", analogRead(PIN_LDR),
                  static_cast<int>(darkness), lightOn ? "acesa" : "apagada");
  }
}

bool lightingValid() {
  return darkness >= 0;
}

int lightingLuminosityPercent() {
  return static_cast<int>(lroundf(100.0f - darkness * 100.0f / 4095.0f));
}

bool lightingOn() {
  return lightOn;
}
