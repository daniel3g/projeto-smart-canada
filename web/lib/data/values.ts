import type { SensorValue } from "@/types/domain";

export type ValueColumns = {
  value_numeric: number | null;
  value_boolean: boolean | null;
  value_text: string | null;
};

/**
 * Distribui o valor na coluna correspondente ao seu tipo.
 *
 * O tipo vem do JavaScript, não de `sensors.sensor_type`: aquele campo
 * descreve o hardware ("DHT11", "sound_module"), não o formato do valor.
 */
export function toValueColumns(value: Exclude<SensorValue, null>): ValueColumns {
  if (typeof value === "number") {
    return { value_numeric: value, value_boolean: null, value_text: null };
  }

  if (typeof value === "boolean") {
    return { value_numeric: null, value_boolean: value, value_text: null };
  }

  return { value_numeric: null, value_boolean: null, value_text: value };
}
