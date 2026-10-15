import { formatRelativeTime, formatSensorValue } from "@/lib/format";
import type { SensorReadout } from "@/types/domain";

/**
 * A interface mostra nome em português e não conhece GPIO.
 * Ver ARCHITECTURE.md "Dashboard".
 */
export function SensorCard({
  sensor,
  now,
}: {
  sensor: SensorReadout;
  now: number;
}) {
  const isBoolean = typeof sensor.value === "boolean";

  return (
    <article className="rounded-xl border border-edge bg-surface p-5">
      <h3 className="text-sm font-medium text-muted">{sensor.name}</h3>

      <p
        className={`mt-2 tabular-nums ${
          isBoolean ? "text-2xl" : "text-3xl"
        } font-semibold tracking-tight`}
      >
        {formatSensorValue(sensor.value, sensor.unit, sensor.type)}
      </p>

      <p className="mt-3 text-xs text-muted">
        <span className="font-mono">{sensor.key}</span>
        {" · "}
        {sensor.recordedAt
          ? formatRelativeTime(sensor.recordedAt, now)
          : "sem leitura"}
      </p>
    </article>
  );
}
