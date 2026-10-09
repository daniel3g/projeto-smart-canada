import "server-only";

import { ApiError } from "./errors";

/**
 * Limite de tentativas de login. API.md "Regras".
 *
 * Contador em memória, por instância. Em serverless cada instância tem o seu,
 * então o limite efetivo é mais frouxo do que o configurado e some a cada
 * reciclagem do processo. É proteção contra força bruta ingênua, não contra um
 * atacante distribuído.
 *
 * Para um limite real, mover o contador para armazenamento compartilhado.
 */
const WINDOW_MS = 5 * 60_000;
const MAX_ATTEMPTS = 10;

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

/** Evita que a memória cresça indefinidamente com chaves expiradas. */
function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

export function clientIdentifier(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");

  if (forwarded) {
    return forwarded.split(",")[0]!.trim();
  }

  return request.headers.get("x-real-ip") ?? "unknown";
}

export function enforceRateLimit(key: string): void {
  const now = Date.now();

  if (buckets.size > 500) {
    sweep(now);
  }

  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }

  bucket.count += 1;

  if (bucket.count > MAX_ATTEMPTS) {
    throw new ApiError("RATE_LIMITED");
  }
}

/** Chamado após um login bem-sucedido, para não punir o usuário legítimo. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}
