#include "sensors.h"

#include <DHT.h>

#include "pins.h"

namespace {

DHT dht(PIN_DHT, DHT11);

// O módulo de som é um comparador com potenciômetro: a saída oscila em volta
// do limiar. Sem debounce, uma única palma gera dezenas de transições.
constexpr unsigned long SOUND_DEBOUNCE_MS = 50;

bool soundStable = false;
bool soundLastRead = false;
unsigned long soundLastChangeMs = 0;

// Trava do evento: fica ligada até a publicação seguinte. É o que impede uma
// palma curta de desaparecer entre dois ciclos de 30 s.
bool soundLatched = false;

bool dhtValid = false;
float temperature = NAN;
float humidity = NAN;

}  // namespace

void sensorsBegin() {
  pinMode(PIN_SOUND, INPUT);
  dht.begin();

  soundStable = digitalRead(PIN_SOUND) == HIGH;
  soundLastRead = soundStable;
  soundLastChangeMs = millis();
}

void sensorsPoll() {
  const bool reading = digitalRead(PIN_SOUND) == HIGH;
  const unsigned long now = millis();

  if (reading != soundLastRead) {
    soundLastRead = reading;
    soundLastChangeMs = now;
    return;
  }

  // Só aceita a leitura depois que ela se mantém estável pelo tempo do
  // debounce.
  if (reading != soundStable && now - soundLastChangeMs >= SOUND_DEBOUNCE_MS) {
    soundStable = reading;

    if (soundStable) {
      soundLatched = true;
    }

    Serial.printf("[som] %s\n", soundStable ? "detectado" : "silencio");
  }
}

bool sensorsReadDht() {
  const float h = dht.readHumidity();
  const float t = dht.readTemperature();

  // O DHT11 falha com alguma frequência. Manter o último valor válido é melhor
  // do que publicar NaN.
  if (isnan(h) || isnan(t)) {
    Serial.println("[dht] leitura invalida");
    return false;
  }

  humidity = h;
  temperature = t;
  dhtValid = true;

  return true;
}

bool sensorsDhtValid() {
  return dhtValid;
}

float sensorsTemperature() {
  return temperature;
}

float sensorsHumidity() {
  return humidity;
}

bool sensorsSoundDetected() {
  return soundStable;
}

bool sensorsSoundLatched() {
  // O estado instantâneo também conta: som ainda ativo no momento da
  // publicação deve aparecer como detectado.
  return soundLatched || soundStable;
}

void sensorsClearSoundLatch() {
  soundLatched = false;
}
