import type { z } from "zod";

import { ApiError } from "./errors";

/**
 * Lê e valida o corpo JSON. API.md "Regras": validar payloads.
 * Corpo ilegível e corpo que não passa no schema resultam no mesmo
 * `INVALID_PAYLOAD`, com a lista de problemas em `details`.
 */
export async function parseJsonBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.output<T>> {
  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    throw new ApiError("INVALID_PAYLOAD", "Malformed JSON body");
  }

  const result = schema.safeParse(raw);

  if (!result.success) {
    throw new ApiError(
      "INVALID_PAYLOAD",
      "Invalid payload",
      result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  return result.data;
}
