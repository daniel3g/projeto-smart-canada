import "server-only";

import { ApiError } from "@/lib/api/errors";
import { LAST_SEEN_WRITE_THROTTLE_SECONDS } from "@/lib/constants";
import { supabaseAdmin } from "@/lib/supabase/admin";

import { secretMatchesHash } from "./secret";

export type AuthenticatedDevice = {
  id: string;
  deviceKey: string;
};

type CredentialRow = { secret_hash: string };

/**
 * Autentica o ESP32 pelos headers documentados em API.md:
 *
 *   X-Device-Id:  device_key
 *   X-Device-Key: segredo
 *
 * Esta credencial identifica somente aquele dispositivo. Ela não concede
 * nenhum poder de admin. Ver AGENTS.md "Três identidades distintas".
 */
export async function authenticateDevice(
  request: Request,
): Promise<AuthenticatedDevice> {
  const deviceKey = request.headers.get("x-device-id");
  const secret = request.headers.get("x-device-key");

  if (!deviceKey || !secret) {
    throw new ApiError("DEVICE_UNAUTHORIZED");
  }

  const supabase = supabaseAdmin();

  const { data: device, error } = await supabase
    .from("devices")
    .select("id, enabled")
    .eq("device_key", deviceKey)
    .maybeSingle();

  if (error) {
    throw error;
  }

  // Dispositivo inexistente e segredo errado respondem igual, para não
  // confirmar quais device_key existem.
  if (!device) {
    throw new ApiError("DEVICE_UNAUTHORIZED");
  }

  if (!device.enabled) {
    throw new ApiError("DEVICE_DISABLED");
  }

  const { data: credentials, error: credentialsError } = await supabase
    .from("device_credentials")
    .select("secret_hash")
    .eq("device_id", device.id)
    .is("revoked_at", null);

  if (credentialsError) {
    throw credentialsError;
  }

  // Várias credenciais ativas são aceitas de propósito: permite rotacionar o
  // segredo sem derrubar o dispositivo que ainda usa o antigo.
  const authenticated = ((credentials ?? []) as CredentialRow[]).some((row) =>
    secretMatchesHash(secret, row.secret_hash),
  );

  if (!authenticated) {
    throw new ApiError("DEVICE_UNAUTHORIZED");
  }

  await touchLastSeen(device.id as string);

  return { id: device.id as string, deviceKey };
}

/**
 * API.md: atualizar `last_seen_at` em chamadas autenticadas.
 *
 * A escrita é limitada por tempo. Sem isso, a consulta de comandos de 1 s
 * geraria um UPDATE por segundo e por dispositivo, enquanto o limiar de online
 * é de 30 s e o heartbeat chega a cada 10 s.
 */
async function touchLastSeen(deviceId: string): Promise<void> {
  const threshold = new Date(
    Date.now() - LAST_SEEN_WRITE_THROTTLE_SECONDS * 1000,
  ).toISOString();

  const { error } = await supabaseAdmin()
    .from("devices")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", deviceId)
    .or(`last_seen_at.is.null,last_seen_at.lt.${threshold}`);

  if (error) {
    // Falhar o heartbeat por causa do carimbo de presença seria pior do que
    // perder o carimbo.
    console.error("[device] falha ao atualizar last_seen_at:", error);
  }
}
