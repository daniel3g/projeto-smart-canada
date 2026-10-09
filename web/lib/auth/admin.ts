import "server-only";

import { ApiError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseSession } from "@/lib/supabase/session";
import type { SessionInfo } from "@/types/domain";

export type AdminIdentity = {
  userId: string;
  email: string;
};

type ResolvedSession = {
  /** Existe sessão válida, admin ou não. */
  authenticated: boolean;
  /** Preenchido só quando a sessão é de um admin ativo. */
  admin: AdminIdentity | null;
};

/**
 * Duas perguntas distintas, nessa ordem:
 *
 *   1. existe sessão válida?            → Supabase Auth
 *   2. essa sessão é de um admin ativo? → tabela admin_users
 *
 * Admin é binário. Não há papel, nível nem permissão por dispositivo.
 * Ver AGENTS.md "Sem níveis de acesso".
 */
async function resolveSession(): Promise<ResolvedSession> {
  const supabase = await supabaseSession();

  // getUser valida o token junto ao Supabase. getSession apenas lê o cookie e
  // por isso não serve para decidir autorização.
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return { authenticated: false, admin: null };
  }

  const { data: row, error: adminError } = await supabaseAdmin()
    .from("admin_users")
    .select("user_id, email")
    .eq("user_id", data.user.id)
    .is("revoked_at", null)
    .maybeSingle();

  if (adminError) {
    throw adminError;
  }

  if (!row) {
    return { authenticated: true, admin: null };
  }

  return {
    authenticated: true,
    admin: { userId: row.user_id as string, email: row.email as string },
  };
}

export async function getSessionInfo(): Promise<SessionInfo> {
  const { authenticated, admin } = await resolveSession();

  if (!admin) {
    return { authenticated, isAdmin: false };
  }

  return { authenticated: true, isAdmin: true, email: admin.email };
}

/**
 * Porta de entrada de toda rota de controle.
 *
 * Sem sessão → 401. Sessão que não é de admin → 403. É a mesma verificação em
 * todas as rotas `admin`, de propósito: não existe permissão parcial.
 */
export async function requireAdmin(): Promise<AdminIdentity> {
  const { authenticated, admin } = await resolveSession();

  if (!authenticated) {
    throw new ApiError("UNAUTHENTICATED");
  }

  if (!admin) {
    throw new ApiError("FORBIDDEN");
  }

  return admin;
}
