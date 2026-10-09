import "server-only";

import { ApiError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { HistoryPoint, SensorHistory, SensorValue } from "@/types/domain";

type TelemetryRow = {
  value_numeric: number | null;
  value_boolean: boolean | null;
  value_text: string | null;
  recorded_at: string;
};

function readValue(row: TelemetryRow): SensorValue {
  if (row.value_numeric !== null) {
    return row.value_numeric;
  }

  if (row.value_boolean !== null) {
    return row.value_boolean;
  }

  if (row.value_text !== null) {
    return row.value_text;
  }

  return null;
}

/**
 * Histórico de um sensor, pronto para alimentar gráficos.
 *
 * Leitura pública: o histórico de monitoramento é aberto, como o valor atual.
 */
export async function getSensorHistory(
  deviceKey: string,
  sensorKey: string,
  options: { minutes: number; limit: number },
): Promise<SensorHistory> {
  const supabase = supabaseAdmin();

  const { data: sensor, error: sensorError } = await supabase
    .from("sensors")
    .select("id, unit, devices!inner(device_key)")
    .eq("sensor_key", sensorKey)
    .eq("devices.device_key", deviceKey)
    .maybeSingle<{ id: string; unit: string | null }>();

  if (sensorError) {
    throw sensorError;
  }

  if (!sensor) {
    throw new ApiError("SENSOR_UNKNOWN", `Unknown sensor: ${sensorKey}`);
  }

  const since = new Date(Date.now() - options.minutes * 60_000).toISOString();

  const { data, error } = await supabase
    .from("telemetry")
    .select("value_numeric, value_boolean, value_text, recorded_at")
    .eq("sensor_id", sensor.id)
    .gte("recorded_at", since)
    .order("recorded_at", { ascending: false })
    .limit(options.limit);

  if (error) {
    throw error;
  }

  // A consulta desce do mais recente para respeitar o índice; o gráfico quer
  // ordem cronológica.
  const points: HistoryPoint[] = ((data ?? []) as TelemetryRow[])
    .map((row) => ({ recordedAt: row.recorded_at, value: readValue(row) }))
    .reverse();

  return {
    deviceKey,
    sensorKey,
    unit: sensor.unit,
    points,
  };
}
