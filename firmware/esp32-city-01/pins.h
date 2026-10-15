#pragma once

#include <Arduino.h>

// Pinagem física da maquete. Ver FIRMWARE.md "Hardware atual".
//
// Não alterar sem atualizar a documentação e a coluna gpio no banco
// (AGENTS.md, princípio 12).

constexpr uint8_t PIN_SOUND = 21;  // entrada digital, saída do módulo de som
constexpr uint8_t PIN_DHT = 22;    // DHT11
constexpr uint8_t PIN_LED = 23;    // saída digital

// Iluminação externa da cidade. O LED da rua é decidido localmente pelo LDR;
// o painel só vê os dois como sensores (luminosidade e estado da
// iluminação), nunca comanda. Ver lighting.cpp.
constexpr uint8_t PIN_LDR = 34;           // entrada analógica (ADC1)
constexpr uint8_t PIN_STREET_LIGHT = 25;  // base do 2N2222A, LED na bateria

// Chaves lógicas. O painel e a API só conhecem estas; o mapeamento para GPIO
// vive aqui, no firmware. Ver API.md "Regras".
#define KEY_TEMPERATURE "temperature"
#define KEY_HUMIDITY "humidity"
#define KEY_SOUND "sound_detected"
#define KEY_LUMINOSITY "luminosity"
#define KEY_STREET_LIGHTS "street_lights"
#define KEY_LED "led_main"
