#pragma once

#include <Arduino.h>

// Leitura dos sensores.
//
// O som é lido com frequência e tem debounce; o DHT11 é lido a cada 5 s porque
// o sensor não entrega mais que isso de forma confiável.

void sensorsBegin();

/** Leitura rápida, a cada volta do loop. Trata o debounce do som. */
void sensorsPoll();

/** Tenta ler o DHT11. Retorna false quando a leitura vem inválida. */
bool sensorsReadDht();

bool sensorsDhtValid();
float sensorsTemperature();
float sensorsHumidity();

/** Estado instantâneo, já com debounce. */
bool sensorsSoundDetected();

/**
 * Houve som em algum momento desde a última publicação.
 *
 * O ciclo de sincronização é de 30 s em repouso, e uma palma dura milissegundos
 * — publicar o estado instantâneo perderia quase todos os eventos. O que vai
 * para a nuvem é esta trava: "houve som neste intervalo".
 *
 * Durante uma apresentação o servidor abre a janela rápida de 1 s, e aí a trava
 * e o estado instantâneo são praticamente a mesma coisa.
 */
bool sensorsSoundLatched();

/** Chamado após publicar com sucesso, para reabrir a janela de detecção. */
void sensorsClearSoundLatch();
