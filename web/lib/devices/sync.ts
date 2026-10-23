import "server-only";

import { ApiError } from "@/lib/api/errors";
import {
  SYNC_DELIVERED_TIMEOUT_MS,
  SYNC_FAST_POLL_MS,
  SYNC_FAST_WINDOW_MS,
  SYNC_IDLE_POLL_MS,
  SYNC_MAX_COMMANDS,
} from "@/lib/constants";
import { one } from "@/lib/data/embed";
import { toValueColumns } from "@/lib/data/values";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SyncInput } from "@/lib/validation/iot";

export type SyncCommand = {
  id: string;
  actuator: string | null;
  type: string;
  value: unknown;
};

export type SyncResult = {
  serverTime: string;
  nextPollMs: number;
  commands: SyncCommand[];
  actuators: Record<string, boolean>;
};

type ActuatorRow = {
  id: string;
  actuator_key: string;
  actuator_state:
    | { desired_boolean: boolean | null }
    | { desired_boolean: boolean | null }[]
    | null;
};

type CommandRow = {
  id: string;
  command_type: string;
  payload: Record<string, unknown> | null;
  actuators: { actuator_key: string } | { actuator_key: string }[] | null;
};

function actuatorKeyOf(row: CommandRow): string | null {
  if (Array.isArray(row.actuators)) {
    return row.actuators[0]?.actuator_key ?? null;
  }

  return row.actuators?.actuator_key ?? null;
}

/**
 * Um ciclo completo do dispositivo, em uma requisição.
 *
 * Ordem das etapas importa:
 *
 *   1. versão do firmware
 *   2. leituras            → telemetry + sensor_state
 *   3. acks                → status dos comandos
 *   4. estado real         → reported (depois dos acks, porque o mapa é a
 *                            verdade completa e deve vencer)
 *   5. estado desejado     → o que o painel quer
 *   6. comandos pendentes  → marcados delivered
 *   7. nextPollMs          → ritmo do próximo ciclo
 */
export async function runDeviceSync(
  deviceId: string,
  body: SyncInput,
): Promise<SyncResult> {
  const supabase = supabaseAdmin();
  const now = new Date().toISOString();

  if (body.firmwareVersion) {
    const { error } = await supabase
      .from("devices")
      .update({ firmware_version: body.firmwareVersion })
      .eq("id", deviceId);

    if (error) {
      throw error;
    }
  }

  // ------------------------------------------------------------- leituras
  if (body.readings && body.readings.length > 0) {
    // Chave repetida no mesmo pacote: vence a última leitura. Sem isso o
    // upsert falharia ao tentar afetar a mesma linha duas vezes.
    const readings = new Map(body.readings.map((r) => [r.key, r.value]));
    const keys = [...readings.keys()];

    const { data: sensors, error } = await supabase
      .from("sensors")
      .select("id, sensor_key")
      .eq("device_id", deviceId)
      .eq("enabled", true)
      .in("sensor_key", keys);

    if (error) {
      throw error;
    }

    const sensorIdByKey = new Map(
      ((sensors ?? []) as { id: string; sensor_key: string }[]).map((s) => [
        s.sensor_key,
        s.id,
      ]),
    );

    // Pacote rejeitado por inteiro. Aceitar parcialmente esconderia um sensor
    // mal cadastrado atrás de uma resposta de sucesso.
    const unknown = keys.filter((key) => !sensorIdByKey.has(key));

    if (unknown.length > 0) {
      throw new ApiError("SENSOR_UNKNOWN", "Unknown sensor key", { unknown });
    }

    const rows = [...readings.entries()].map(([key, value]) => ({
      sensorId: sensorIdByKey.get(key)!,
      columns: toValueColumns(value),
    }));

    const { error: telemetryError } = await supabase.from("telemetry").insert(
      rows.map((row) => ({
        device_id: deviceId,
        sensor_id: row.sensorId,
        ...row.columns,
        recorded_at: now,
      })),
    );

    if (telemetryError) {
      throw telemetryError;
    }

    const { error: stateError } = await supabase.from("sensor_state").upsert(
      rows.map((row) => ({
        sensor_id: row.sensorId,
        ...row.columns,
        recorded_at: now,
      })),
      { onConflict: "sensor_id" },
    );

    if (stateError) {
      throw stateError;
    }
  }

  // ----------------------------------------------------------- atuadores
  const { data: actuatorData, error: actuatorError } = await supabase
    .from("actuators")
    .select("id, actuator_key, actuator_state ( desired_boolean )")
    .eq("device_id", deviceId)
    .eq("enabled", true);

  if (actuatorError) {
    throw actuatorError;
  }

  const actuators = (actuatorData ?? []) as ActuatorRow[];
  const actuatorIdByKey = new Map(
    actuators.map((row) => [row.actuator_key, row.id]),
  );

  // ---------------------------------------------------------------- acks
  if (body.acks && body.acks.length > 0) {
    // O filtro por device_id impede que um dispositivo confirme comando de
    // outro. Um id que não seja dele simplesmente não atualiza nada.
    for (const ack of body.acks) {
      const { error } = await supabase
        .from("commands")
        .update({
          status: ack.status,
          executed_at: now,
          error_message:
            ack.status === "failed" ? (ack.error ?? null) : null,
        })
        .eq("id", ack.id)
        .eq("device_id", deviceId);

      if (error) {
        throw error;
      }
    }
  }

  // ------------------------------------------------------- estado real
  if (body.actuators) {
    // Chave desconhecida é ignorada, ao contrário das leituras, que rejeitam o
    // pacote. Recusar o ciclo por causa de um atuador removido do banco
    // deixaria o dispositivo aparecendo como offline — pior do que a
    // divergência que se quer evitar.
    const rows = Object.entries(body.actuators)
      .filter(([key]) => actuatorIdByKey.has(key))
      .map(([key, value]) => ({
        actuator_id: actuatorIdByKey.get(key)!,
        reported_boolean: value,
        reported_updated_at: now,
      }));

    if (rows.length > 0) {
      const { error } = await supabase
        .from("actuator_state")
        .upsert(rows, { onConflict: "actuator_id" });

      if (error) {
        throw error;
      }
    }
  }

  // --------------------------------------------------- estado desejado
  // Só entram atuadores com desejo registrado. Um atuador nunca comandado não
  // tem meta, e o firmware deve deixá-lo como está em vez de adivinhar.
  const desired: Record<string, boolean> = {};

  for (const row of actuators) {
    const state = one(row.actuator_state);

    if (state?.desired_boolean !== null && state?.desired_boolean !== undefined) {
      desired[row.actuator_key] = state.desired_boolean;
    }
  }

  // ------------------------------------------------------------ comandos
  const { data: pendingData, error: pendingError } = await supabase
    .from("commands")
    .select("id, command_type, payload, actuators ( actuator_key )")
    .eq("device_id", deviceId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(SYNC_MAX_COMMANDS);

  if (pendingError) {
    throw pendingError;
  }

  const pending = (pendingData ?? []) as CommandRow[];
  let commands: SyncCommand[] = [];

  if (pending.length > 0) {
    // A marcação é condicionada a `status = 'pending'` e só os comandos
    // efetivamente marcados são devolvidos, para que dois ciclos simultâneos
    // não entreguem o mesmo comando duas vezes.
    const { data: claimed, error: claimError } = await supabase
      .from("commands")
      .update({ status: "delivered", delivered_at: now })
      .in(
        "id",
        pending.map((row) => row.id),
      )
      .eq("status", "pending")
      .select("id");

    if (claimError) {
      throw claimError;
    }

    const claimedIds = new Set(
      ((claimed ?? []) as { id: string }[]).map((row) => row.id),
    );

    commands = pending
      .filter((row) => claimedIds.has(row.id))
      .map((row) => ({
        id: row.id,
        actuator: actuatorKeyOf(row),
        type: row.command_type,
        value: row.payload?.value ?? null,
      }));
  }

  return {
    serverTime: now,
    nextPollMs: await resolvePollInterval(deviceId, commands.length > 0),
    commands,
    actuators: desired,
  };
}

/**
 * Ritmo do próximo ciclo.
 *
 * Em repouso o dispositivo dorme, para caber no plano gratuito. Quando há
 * trabalho em aberto ou houve atividade recente do admin, abre uma janela
 * rápida: o primeiro clique espera um ciclo de repouso, os seguintes são
 * imediatos.
 */
async function resolvePollInterval(
  deviceId: string,
  justDelivered: boolean,
): Promise<number> {
  if (justDelivered) {
    return SYNC_FAST_POLL_MS;
  }

  const supabase = supabaseAdmin();

  // Entregue e nunca confirmado dentro do prazo: a resposta se perdeu no
  // caminho. Vira `expired` para não prender a janela rápida para sempre.
  // Ver SYNC_DELIVERED_TIMEOUT_MS.
  const deadline = new Date(
    Date.now() - SYNC_DELIVERED_TIMEOUT_MS,
  ).toISOString();

  const { error: expireError } = await supabase
    .from("commands")
    .update({
      status: "expired",
      error_message: "no ack within delivery timeout",
    })
    .eq("device_id", deviceId)
    .eq("status", "delivered")
    .lt("delivered_at", deadline);

  if (expireError) {
    throw expireError;
  }

  // Comando aguardando entrega ou confirmação é trabalho em aberto.
  const { data: outstanding, error } = await supabase
    .from("commands")
    .select("id")
    .eq("device_id", deviceId)
    .in("status", ["pending", "delivered"])
    .limit(1);

  if (error) {
    throw error;
  }

  if ((outstanding ?? []).length > 0) {
    return SYNC_FAST_POLL_MS;
  }

  // Atividade recente: alguém está mexendo no painel agora.
  const since = new Date(Date.now() - SYNC_FAST_WINDOW_MS).toISOString();

  const { data: recent, error: recentError } = await supabase
    .from("commands")
    .select("id")
    .eq("device_id", deviceId)
    .gte("created_at", since)
    .limit(1);

  if (recentError) {
    throw recentError;
  }

  return (recent ?? []).length > 0 ? SYNC_FAST_POLL_MS : SYNC_IDLE_POLL_MS;
}
