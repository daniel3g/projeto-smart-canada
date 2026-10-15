#pragma once

#include <Arduino.h>

// Cliente HTTP da API. Ver API.md.
//
// Todas as requisições levam os headers X-Device-Id e X-Device-Key. Essa
// credencial identifica somente este ESP32: ela não dá nenhum poder de admin
// (AGENTS.md "Três identidades distintas").

void cloudBegin();

/**
 * Um ciclo completo, em uma única requisição a POST /api/iot/sync.
 *
 * Envia leituras, estado real dos atuadores e a confirmação dos comandos
 * executados no ciclo anterior. Recebe comandos novos, o estado desejado e o
 * ritmo do próximo ciclo.
 *
 * Quatro requisições viraram uma porque a soma delas não caberia no plano
 * gratuito da Vercel. Ver ARCHITECTURE.md "Orçamento de requisições".
 */
bool cloudSync();

/**
 * Quanto esperar até o próximo ciclo, em milissegundos.
 *
 * Quem decide é o servidor, via `nextPollMs`: em repouso ele manda dormir, e
 * abre uma janela rápida quando há comando em aberto. Assim a política de
 * consumo muda sem regravar firmware.
 */
unsigned long cloudNextPollMs();

/**
 * true quando a nuvem está em penalidade por falha de autenticação ou 429.
 * O loop usa isso apenas para log: `cloudSync` já se recusa a chamar.
 */
bool cloudBlocked();
