import { NextResponse } from "next/server";

import { ApiError, handleRoute, noStore } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/request";
import { requireAdmin } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { actuatorCommandSchema } from "@/lib/validation/iot";

/**
 * Nível: `admin`.
 *
 * Esta é a rota que acende LED, liga irrigação e dispara alarme. Ela nunca
 * pode ser pública. Ver AGENTS.md "Controle restrito a admin".
 *
 * O painel manda `actuator_key` e um valor. Nunca GPIO: o mapeamento para pino
 * é responsabilidade do firmware. Ver API.md "Regras".
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ deviceKey: string; actuatorKey: string }> },
): Promise<NextResponse> {
  return handleRoute(async () => {
    // Primeira linha da rota, antes de ler o corpo: sem admin, nada acontece.
    const admin = await requireAdmin();

    const { deviceKey, actuatorKey } = await params;
    const body = await parseJsonBody(request, actuatorCommandSchema);

    const supabase = supabaseAdmin();

    const { data: device, error: deviceError } = await supabase
      .from("devices")
      .select("id, enabled")
      .eq("device_key", deviceKey)
      .maybeSingle<{ id: string; enabled: boolean }>();

    if (deviceError) {
      throw deviceError;
    }

    if (!device) {
      throw new ApiError("DEVICE_NOT_FOUND");
    }

    if (!device.enabled) {
      throw new ApiError("DEVICE_DISABLED");
    }

    const { data: actuator, error: actuatorError } = await supabase
      .from("actuators")
      .select("id")
      .eq("device_id", device.id)
      .eq("actuator_key", actuatorKey)
      .eq("enabled", true)
      .maybeSingle<{ id: string }>();

    if (actuatorError) {
      throw actuatorError;
    }

    if (!actuator) {
      throw new ApiError("ACTUATOR_UNKNOWN", `Unknown actuator: ${actuatorKey}`);
    }

    const now = new Date().toISOString();

    // created_by torna o comando rastreável até o admin que o emitiu.
    // AGENTS.md, princípio 21.
    const { data: command, error: commandError } = await supabase
      .from("commands")
      .insert({
        device_id: device.id,
        actuator_id: actuator.id,
        command_type: "set_boolean",
        payload: { value: body.value },
        status: "pending",
        created_by: admin.userId,
      })
      .select("id")
      .single<{ id: string }>();

    if (commandError) {
      throw commandError;
    }

    // `desired` é a intenção do painel. `reported` só muda no ACK do
    // dispositivo, que é a única fonte de verdade sobre o GPIO.
    const { error: stateError } = await supabase.from("actuator_state").upsert(
      {
        actuator_id: actuator.id,
        desired_boolean: body.value,
        desired_updated_at: now,
      },
      { onConflict: "actuator_id" },
    );

    if (stateError) {
      throw stateError;
    }

    return noStore(NextResponse.json({ ok: true, commandId: command.id }));
  });
}
