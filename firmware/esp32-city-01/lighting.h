#pragma once

#include <Arduino.h>

// Iluminação automática: o LDR decide, o LED da rua obedece.
//
// Roda só no firmware, sem nuvem: anoiteceu, acende; amanheceu, apaga. Não
// passa pelo painel nem custa requisição. Ver FIRMWARE.md "Iluminação
// automática".

void lightingBegin();

/** Chamado a cada volta do loop. Lê o LDR no próprio ritmo, sem bloquear. */
void lightingPoll();

/** Já houve ao menos uma leitura do LDR. */
bool lightingValid();

/**
 * Luminosidade de 0 (escuro) a 100 (claro), suavizada.
 *
 * É a faixa do ADC, não lux: o LDR não tem calibração absoluta. Serve para
 * comparar momentos, não para medir. Na maquete, luz da sala dá ~60 e o
 * LDR tapado ~17.
 */
int lightingLuminosityPercent();

/** A iluminação externa está acesa. */
bool lightingOn();
