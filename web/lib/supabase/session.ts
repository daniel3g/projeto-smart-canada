import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { supabaseAnonKey, supabaseUrl } from "@/lib/env";

/**
 * Cliente ligado aos cookies da requisição, usado apenas para resolver quem é
 * o usuário. A chave é a `anon`: este cliente nunca escreve dados de domínio.
 *
 * Um cliente novo por requisição, conforme exigido pelo @supabase/ssr.
 */
export async function supabaseSession(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components não podem escrever cookies. O refresh de token
          // acontece nas rotas de /api/auth, que podem.
        }
      },
    },
  });
}
