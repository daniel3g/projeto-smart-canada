#pragma once

#include <Arduino.h>

// Wi-Fi e relógio.
//
// Nada aqui bloqueia depois do setup. O loop principal não pode travar
// esperando rede: os sensores continuam sendo lidos e os atuadores continuam
// respondendo mesmo sem nuvem (FIRMWARE.md "Estado offline").

void netBegin();

/** Chamar a cada volta do loop. Cuida de reconexão com backoff. */
void netLoop();

bool netConnected();

/**
 * O relógio só importa quando API_INSECURE_TLS é 0: validar certificado exige
 * comparar as datas de validade, e o ESP32 acorda em 1970.
 */
bool netTimeSynced();

int netRssi();
