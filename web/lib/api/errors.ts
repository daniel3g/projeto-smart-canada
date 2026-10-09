import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";

/**
 * Códigos e status definidos em API.md "Formato de erro".
 * Mensagens de autenticação são genéricas de propósito: não revelam se o
 * e-mail existe, nem se o erro foi no id ou na chave do dispositivo.
 */
export const API_ERROR_STATUS = {
  INVALID_PAYLOAD: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  DEVICE_UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  DEVICE_DISABLED: 403,
  DEVICE_NOT_FOUND: 404,
  SENSOR_UNKNOWN: 404,
  ACTUATOR_UNKNOWN: 404,
  COMMAND_NOT_FOUND: 404,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_STATUS;

const DEFAULT_MESSAGE: Record<ApiErrorCode, string> = {
  INVALID_PAYLOAD: "Invalid payload",
  UNAUTHENTICATED: "Authentication required",
  INVALID_CREDENTIALS: "Invalid credentials",
  DEVICE_UNAUTHORIZED: "Device authentication failed",
  FORBIDDEN: "Admin privileges required",
  DEVICE_DISABLED: "Device is disabled",
  DEVICE_NOT_FOUND: "Unknown device",
  SENSOR_UNKNOWN: "Unknown sensor",
  ACTUATOR_UNKNOWN: "Unknown actuator",
  COMMAND_NOT_FOUND: "Command not found",
  RATE_LIMITED: "Too many attempts",
  INTERNAL_ERROR: "Internal error",
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message?: string, details?: unknown) {
    super(message ?? DEFAULT_MESSAGE[code]);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }
}

export function errorResponse(error: ApiError): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    },
    { status: API_ERROR_STATUS[error.code] },
  );
}

/**
 * Envelope único para route handlers.
 *
 * Um `ApiError` vira a resposta documentada. Qualquer outra exceção vira
 * `INTERNAL_ERROR`, sem vazar stack trace nem detalhe interno para o cliente.
 */
export async function handleRoute(
  fn: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await fn();
  } catch (error) {
    // O Next sinaliza controle de fluxo por exceção: redirect(), notFound(),
    // connection() ao fim de um prerender. Engolir isso aqui quebraria o
    // framework de formas difíceis de diagnosticar.
    unstable_rethrow(error);

    if (error instanceof ApiError) {
      return errorResponse(error);
    }

    console.error("[api] erro não tratado:", error);
    return errorResponse(new ApiError("INTERNAL_ERROR"));
  }
}

/** Respostas que carregam sessão não podem ser cacheadas por CDN. */
export function noStore(response: NextResponse): NextResponse {
  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0",
  );
  return response;
}
