#pragma once

#include <Arduino.h>

// Registro de atuadores.
//
// É aqui, e só aqui, que uma chave lógica vira um GPIO. O painel e a API nunca
// enviam número de pino (API.md "Regras").
//
// Para adicionar um atuador: uma linha na tabela de actuators.cpp, uma linha no
// banco. Nada mais muda.

void actuatorsBegin();

/**
 * Aplica um valor pela chave lógica.
 * Retorna false quando a chave não existe neste dispositivo.
 */
bool actuatorApply(const char* key, bool value);

int actuatorCount();
const char* actuatorKeyAt(int index);
bool actuatorStateAt(int index);
