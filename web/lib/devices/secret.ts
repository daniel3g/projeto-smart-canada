import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Credencial de dispositivo.
 *
 * O segredo é gerado aqui, com 32 bytes aleatórios, e guardado apenas como
 * hash SHA-256. Não é senha de usuário: é um valor de alta entropia que
 * ninguém digita e ninguém memoriza.
 *
 * Por isso SHA-256 e não bcrypt. A consulta de comandos roda a cada 1 s por
 * dispositivo (ARCHITECTURE.md "Frequências iniciais"); um KDF deliberadamente
 * lento transformaria o custo de autenticação no gargalo da API, sem ganho
 * real contra força bruta sobre 256 bits de entropia.
 */
export function generateDeviceSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function hashDeviceSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** Comparação de tempo constante, para não vazar o hash por timing. */
export function secretMatchesHash(secret: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashDeviceSecret(secret), "hex");

  let stored: Buffer;
  try {
    stored = Buffer.from(storedHash, "hex");
  } catch {
    return false;
  }

  if (candidate.length !== stored.length) {
    return false;
  }

  return timingSafeEqual(candidate, stored);
}
