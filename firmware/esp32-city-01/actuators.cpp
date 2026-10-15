#include "actuators.h"

#include "pins.h"

namespace {

struct Actuator {
  const char* key;
  uint8_t pin;
  bool activeLow;  // módulos de relé costumam acionar em LOW
  bool state;
};

// Tabela única de atuadores deste dispositivo.
//
// Um atuador novo entra aqui. Exemplos previstos em AGENTS.md:
//   {"street_lights", 19, false, false},
//   {"irrigation_pump", 18, true, false},
Actuator actuators[] = {
    {KEY_LED, PIN_LED, false, false},
};

constexpr int ACTUATOR_COUNT = sizeof(actuators) / sizeof(actuators[0]);

void write(Actuator& actuator) {
  const bool level = actuator.activeLow ? !actuator.state : actuator.state;
  digitalWrite(actuator.pin, level ? HIGH : LOW);
}

}  // namespace

void actuatorsBegin() {
  for (int i = 0; i < ACTUATOR_COUNT; i++) {
    pinMode(actuators[i].pin, OUTPUT);

    // Estado inicial seguro: desligado. O estado desejado de verdade vive no
    // banco e chega no primeiro heartbeat, que reconcilia a divergência.
    actuators[i].state = false;
    write(actuators[i]);
  }
}

bool actuatorApply(const char* key, bool value) {
  for (int i = 0; i < ACTUATOR_COUNT; i++) {
    if (strcmp(actuators[i].key, key) != 0) {
      continue;
    }

    // Idempotente: num mesmo ciclo a reconciliação e o comando pedem o mesmo
    // valor, e escrever duas vezes só polui o log. Somos o único escritor
    // destes pinos, então o estado em RAM é autoritativo.
    if (actuators[i].state == value) {
      return true;
    }

    actuators[i].state = value;
    write(actuators[i]);

    Serial.printf("[gpio] %s (pino %u) -> %s\n", key, actuators[i].pin,
                  value ? "LIGADO" : "DESLIGADO");
    return true;
  }

  Serial.printf("[gpio] chave desconhecida: %s\n", key);
  return false;
}

int actuatorCount() {
  return ACTUATOR_COUNT;
}

const char* actuatorKeyAt(int index) {
  if (index < 0 || index >= ACTUATOR_COUNT) {
    return nullptr;
  }

  return actuators[index].key;
}

bool actuatorStateAt(int index) {
  if (index < 0 || index >= ACTUATOR_COUNT) {
    return false;
  }

  return actuators[index].state;
}
