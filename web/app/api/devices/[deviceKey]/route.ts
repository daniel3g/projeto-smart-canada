import { NextResponse } from "next/server";
import { connection } from "next/server";

import { ApiError, handleRoute } from "@/lib/api/errors";
import { getDeviceSnapshot } from "@/lib/data/device";

/**
 * Nível: `public`. Sem login.
 *
 * Monitoramento é aberto por regra de negócio. Ver AGENTS.md
 * "Modelo de permissões". A projeção não contém GPIO nem credencial.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ deviceKey: string }> },
): Promise<NextResponse> {
  return handleRoute(async () => {
    // Estado de sensor nunca pode ser pré-renderizado no build.
    await connection();

    const { deviceKey } = await params;
    const snapshot = await getDeviceSnapshot(deviceKey);

    if (!snapshot) {
      throw new ApiError("DEVICE_NOT_FOUND");
    }

    const response = NextResponse.json(snapshot);

    // Cache curto na CDN: o painel atualiza a cada 5 s, então 3 s de validade
    // não atrasa nada perceptível e faz vários visitantes simultâneos
    // compartilharem uma única invocação de função. Seguro porque a projeção é
    // pública e não depende de quem pergunta — nada aqui varia por sessão.
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=3, stale-while-revalidate=10",
    );

    return response;
  });
}
