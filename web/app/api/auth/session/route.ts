import { NextResponse } from "next/server";
import { connection } from "next/server";

import { handleRoute, noStore } from "@/lib/api/errors";
import { getSessionInfo } from "@/lib/auth/admin";

/**
 * Nível: `public`. Responde quem é o usuário atual.
 *
 * A interface usa isto apenas para decidir o que desenhar. A autorização de
 * verdade acontece em cada rota de controle: esconder botão não é autorização.
 */
export async function GET(): Promise<NextResponse> {
  return handleRoute(async () => {
    await connection();

    return noStore(NextResponse.json(await getSessionInfo()));
  });
}
