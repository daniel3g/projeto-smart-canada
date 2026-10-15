import type { SensorValue } from "@/types/domain";

/** Unidades do banco são chaves estáveis; o símbolo é coisa de interface. */
const UNIT_SYMBOL: Record<string, string> = {
  celsius: "°C",
  percent: "%",
  lux: "lx",
  ppm: "ppm",
};

export function unitSymbol(unit: string | null): string | null {
  if (!unit || unit === "boolean") {
    return null;
  }

  return UNIT_SYMBOL[unit] ?? unit;
}

/**
 * Texto de verdadeiro/falso por tipo de sensor. "Detectado" só faz sentido
 * para som; o resto é estado de ligado/desligado.
 */
const BOOLEAN_LABEL: Record<string, readonly [string, string]> = {
  sound_module: ["Detectado", "Silêncio"],
  street_lights: ["Ligada", "Desligada"],
};

const DEFAULT_BOOLEAN_LABEL = ["Ligado", "Desligado"] as const;

export function formatSensorValue(
  value: SensorValue,
  unit: string | null,
  type?: string,
): string {
  if (value === null) {
    return "—";
  }

  if (typeof value === "boolean") {
    const [on, off] =
      (type && BOOLEAN_LABEL[type]) || DEFAULT_BOOLEAN_LABEL;

    return value ? on : off;
  }

  if (typeof value === "number") {
    const symbol = unitSymbol(unit);
    const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1);

    return symbol ? `${rounded} ${symbol}` : rounded;
  }

  return value;
}

export function formatRelativeTime(
  isoDate: string | null,
  now: number = Date.now(),
): string {
  if (!isoDate) {
    return "nunca";
  }

  const elapsedSeconds = Math.round((now - new Date(isoDate).getTime()) / 1000);

  if (elapsedSeconds < 0) {
    return "agora";
  }

  if (elapsedSeconds < 60) {
    return `há ${elapsedSeconds} s`;
  }

  const minutes = Math.floor(elapsedSeconds / 60);

  if (minutes < 60) {
    return `há ${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `há ${hours} h`;
  }

  return `há ${Math.floor(hours / 24)} d`;
}

export function formatClock(isoDate: string | null): string {
  if (!isoDate) {
    return "—";
  }

  return new Date(isoDate).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
  });
}
