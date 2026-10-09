import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { supabaseServiceRoleKey, supabaseUrl } from "@/lib/env";

let client: SupabaseClient | null = null;

/**
 * Cliente com `service_role`. Ignora RLS.
 *
 * Só pode ser usado depois de uma verificação de autorização explícita:
 * `requireAdmin()` nas rotas de controle, `authenticateDevice()` nas rotas de
 * dispositivo, ou em leitura pública já classificada como pública.
 *
 * Ver AGENTS.md, princípios 1 e 20, e a regra 16 para agentes.
 */
export function supabaseAdmin(): SupabaseClient {
  if (!client) {
    client = createClient(supabaseUrl(), supabaseServiceRoleKey(), {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return client;
}
