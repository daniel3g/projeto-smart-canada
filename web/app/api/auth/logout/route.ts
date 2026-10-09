import { NextResponse } from "next/server";

import { handleRoute, noStore } from "@/lib/api/errors";
import { supabaseSession } from "@/lib/supabase/session";

/**
 * Encerra a sessão.
 *
 * Não exige ser admin: qualquer sessão pode se desfazer. Exigir `requireAdmin`
 * aqui deixaria preso quem autenticou e não é admin.
 */
export async function POST(): Promise<NextResponse> {
  return handleRoute(async () => {
    const supabase = await supabaseSession();
    await supabase.auth.signOut();

    return noStore(NextResponse.json({ ok: true }));
  });
}
