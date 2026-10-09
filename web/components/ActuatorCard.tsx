"use client";

import { StatusPill } from "@/components/StatusPill";
import { formatRelativeTime } from "@/lib/format";
import type { ActuatorReadout } from "@/types/domain";

/**
 * Visitante vê o estado. Só admin recebe o controle.
 *
 * Esconder o botão é conveniência visual, não autorização: a recusa de verdade
 * está na rota. Ver AGENTS.md, regra 15 para agentes.
 */
export function ActuatorCard({
  actuator,
  canControl,
  busy,
  now,
  onToggle,
}: {
  actuator: ActuatorReadout;
  canControl: boolean;
  busy: boolean;
  now: number;
  onToggle: (value: boolean) => void;
}) {
  const reported = actuator.reported;
  const desired = actuator.desired;

  // Comando emitido e ainda não confirmado pelo dispositivo.
  const awaitingDevice =
    desired !== null && reported !== null && desired !== reported;

  const neverReported = reported === null;

  return (
    <article className="rounded-xl border border-edge bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-medium text-muted">{actuator.name}</h3>

        {neverReported ? (
          <StatusPill tone="pending">sem confirmação</StatusPill>
        ) : awaitingDevice ? (
          <StatusPill tone="pending">aguardando dispositivo</StatusPill>
        ) : reported ? (
          <StatusPill tone="online">ligado</StatusPill>
        ) : (
          <StatusPill tone="offline">desligado</StatusPill>
        )}
      </div>

      <p className="mt-2 text-3xl font-semibold tracking-tight">
        {neverReported ? "—" : reported ? "Ligado" : "Desligado"}
      </p>

      <p className="mt-3 text-xs text-muted">
        <span className="font-mono">{actuator.key}</span>
        {" · confirmado "}
        {formatRelativeTime(actuator.reportedUpdatedAt, now)}
      </p>

      {canControl ? (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onToggle(true)}
            aria-pressed={desired === true}
            className="flex-1 rounded-lg border border-edge px-3 py-2 text-sm font-medium transition enabled:hover:bg-surface-muted disabled:opacity-50 aria-pressed:border-accent aria-pressed:text-accent"
          >
            Ligar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onToggle(false)}
            aria-pressed={desired === false}
            className="flex-1 rounded-lg border border-edge px-3 py-2 text-sm font-medium transition enabled:hover:bg-surface-muted disabled:opacity-50 aria-pressed:border-accent aria-pressed:text-accent"
          >
            Desligar
          </button>
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted">
          Controle restrito a administrador.
        </p>
      )}
    </article>
  );
}
