import "server-only";

import { DEVICE_ONLINE_THRESHOLD_SECONDS } from "@/lib/constants";
import { one } from "@/lib/data/embed";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  ActuatorReadout,
  DeviceSnapshot,
  SensorReadout,
  SensorValue,
} from "@/types/domain";

type StateRow = {
  value_numeric: number | null;
  value_boolean: boolean | null;
  value_text: string | null;
  recorded_at: string;
};

type SensorRow = {
  sensor_key: string;
  name: string;
  sensor_type: string;
  unit: string | null;
  sensor_state: StateRow | StateRow[] | null;
};

type ActuatorStateRow = {
  desired_boolean: boolean | null;
  reported_boolean: boolean | null;
  desired_updated_at: string | null;
  reported_updated_at: string | null;
};

type ActuatorRow = {
  actuator_key: string;
  name: string;
  actuator_type: string;
  actuator_state: ActuatorStateRow | ActuatorStateRow[] | null;
};

type DeviceRow = {
  device_key: string;
  name: string;
  description: string | null;
  enabled: boolean;
  last_seen_at: string | null;
  firmware_version: string | null;
  sensors: SensorRow[] | null;
  actuators: ActuatorRow[] | null;
};

/**
 * Lê o valor da coluna correspondente ao tipo.
 * A comparação é com `null` explícito: `false` e `0` são valores válidos.
 */
function readValue(state: StateRow | null): SensorValue {
  if (!state) {
    return null;
  }

  if (state.value_numeric !== null) {
    return state.value_numeric;
  }

  if (state.value_boolean !== null) {
    return state.value_boolean;
  }

  if (state.value_text !== null) {
    return state.value_text;
  }

  return null;
}

export function isOnline(lastSeenAt: string | null, now = Date.now()): boolean {
  if (!lastSeenAt) {
    return false;
  }

  const elapsedMs = now - new Date(lastSeenAt).getTime();

  return elapsedMs < DEVICE_ONLINE_THRESHOLD_SECONDS * 1000;
}

/**
 * Snapshot público de um dispositivo. Usado pela rota pública e pela página.
 *
 * As colunas são listadas uma a uma de propósito: um `select *` passaria a
 * vazar GPIO no dia em que alguém adicionasse uma coluna sensível.
 */
export async function getDeviceSnapshot(
  deviceKey: string,
): Promise<DeviceSnapshot | null> {
  const { data, error } = await supabaseAdmin()
    .from("devices")
    .select(
      `
      device_key,
      name,
      description,
      enabled,
      last_seen_at,
      firmware_version,
      sensors (
        sensor_key,
        name,
        sensor_type,
        unit,
        enabled,
        sensor_state ( value_numeric, value_boolean, value_text, recorded_at )
      ),
      actuators (
        actuator_key,
        name,
        actuator_type,
        enabled,
        actuator_state (
          desired_boolean,
          reported_boolean,
          desired_updated_at,
          reported_updated_at
        )
      )
    `,
    )
    .eq("device_key", deviceKey)
    .eq("sensors.enabled", true)
    .eq("actuators.enabled", true)
    .maybeSingle<DeviceRow>();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  const sensors: Record<string, SensorReadout> = {};

  for (const row of data.sensors ?? []) {
    const state = one(row.sensor_state);

    sensors[row.sensor_key] = {
      key: row.sensor_key,
      name: row.name,
      type: row.sensor_type,
      unit: row.unit,
      value: readValue(state),
      recordedAt: state?.recorded_at ?? null,
    };
  }

  const actuators: Record<string, ActuatorReadout> = {};

  for (const row of data.actuators ?? []) {
    const state = one(row.actuator_state);

    actuators[row.actuator_key] = {
      key: row.actuator_key,
      name: row.name,
      type: row.actuator_type,
      desired: state?.desired_boolean ?? null,
      reported: state?.reported_boolean ?? null,
      desiredUpdatedAt: state?.desired_updated_at ?? null,
      reportedUpdatedAt: state?.reported_updated_at ?? null,
    };
  }

  return {
    deviceKey: data.device_key,
    name: data.name,
    description: data.description,
    enabled: data.enabled,
    // Um dispositivo desabilitado nunca está online: a API recusa suas chamadas.
    online: data.enabled && isOnline(data.last_seen_at),
    lastSeenAt: data.last_seen_at,
    firmwareVersion: data.firmware_version,
    serverTime: new Date().toISOString(),
    sensors,
    actuators,
  };
}
