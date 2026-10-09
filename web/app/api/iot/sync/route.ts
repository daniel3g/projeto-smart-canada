import { NextResponse } from "next/server";
import { connection } from "next/server";

import { handleRoute } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/request";
import { authenticateDevice } from "@/lib/devices/auth";
import { runDeviceSync } from "@/lib/devices/sync";
import { syncSchema } from "@/lib/validation/iot";

/**
 * Nível: `device`. Ciclo único do dispositivo.
 *
 * Substitui as rotas separadas de telemetria, heartbeat, consulta de comandos
 * e ACK. Quatro requisições por ciclo viraram uma, porque a soma delas não
 * cabia no plano gratuito da Vercel: eram cerca de 3,4 milhões de invocações
 * por mês para um único ESP32.
 *
 * Ver API.md "POST /api/iot/sync" e ARCHITECTURE.md "Orçamento de requisições".
 */
export async function POST(request: Request): Promise<NextResponse> {
  return handleRoute(async () => {
    await connection();

    const device = await authenticateDevice(request);
    const body = await parseJsonBody(request, syncSchema);

    const result = await runDeviceSync(device.id, body);

    return NextResponse.json({ ok: true, ...result });
  });
}
