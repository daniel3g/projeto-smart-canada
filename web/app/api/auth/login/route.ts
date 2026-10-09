import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { ApiError, handleRoute, noStore } from "@/lib/api/errors";
import {
  clientIdentifier,
  enforceRateLimit,
  resetRateLimit,
} from "@/lib/api/rate-limit";
import { parseJsonBody } from "@/lib/api/request";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseSession } from "@/lib/supabase/session";
import { loginSchema } from "@/lib/validation/iot";

/**
 * Nível: `public` — é a porta de entrada do admin.
 *
 * Não existe cadastro. Admins são criados fora da aplicação e marcados em
 * `admin_users`. Ver AGENTS.md "Modelo de permissões".
 *
 * Toda falha responde o mesmo `INVALID_CREDENTIALS`: credencial errada,
 * e-mail inexistente e usuário sem permissão de admin são indistinguíveis de
 * fora, para não confirmar quais contas existem.
 */
export async function POST(request: Request): Promise<NextResponse> {
  return handleRoute(async () => {
    const identifier = clientIdentifier(request);
    enforceRateLimit(identifier);

    const body = await parseJsonBody(request, loginSchema);
    const supabase = await supabaseSession();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: body.email,
      password: body.password,
    });

    // Supabase fora do ar não é senha errada. Dizer "credencial inválida" num
    // incidente de infraestrutura faz o admin duvidar da própria senha e
    // esconde a falha real de quem opera.
    if (error && isAuthRetryableFetchError(error)) {
      throw error;
    }

    if (error || !data.user) {
      throw new ApiError("INVALID_CREDENTIALS");
    }

    const { data: admin, error: adminError } = await supabaseAdmin()
      .from("admin_users")
      .select("email")
      .eq("user_id", data.user.id)
      .is("revoked_at", null)
      .maybeSingle();

    if (adminError) {
      throw adminError;
    }

    // Autenticar não é autorizar. Uma conta válida que não é admin não deve
    // sair daqui com sessão ativa.
    if (!admin) {
      await supabase.auth.signOut();
      throw new ApiError("INVALID_CREDENTIALS");
    }

    resetRateLimit(identifier);

    return noStore(
      NextResponse.json({ ok: true, email: admin.email as string }),
    );
  });
}
