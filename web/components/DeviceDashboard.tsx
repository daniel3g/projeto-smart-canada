"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { ActuatorCard } from "@/components/ActuatorCard";
import { SensorCard } from "@/components/SensorCard";
import { StatusPill } from "@/components/StatusPill";
import { DASHBOARD_REFRESH_MS } from "@/lib/constants";
import { formatClock, formatRelativeTime } from "@/lib/format";
import type { DeviceSnapshot, SessionInfo } from "@/types/domain";

type ApiErrorBody = {
  error?: { code?: string; message?: string };
};

/**
 * O painel é renderizado no cliente e busca os dados pela API pública.
 *
 * Isso mantém a página um shell estático e deixa a decisão de autorização
 * inteiramente no servidor, em cada rota. A atualização por polling de 5 s
 * segue ARCHITECTURE.md "Frequências iniciais".
 */
export function DeviceDashboard({ deviceKey }: { deviceKey: string }) {
  const [snapshot, setSnapshot] = useState<DeviceSnapshot | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyActuator, setBusyActuator] = useState<string | null>(null);

  // Evita que uma resposta atrasada sobrescreva uma mais recente.
  const requestSeq = useRef(0);

  const loadSnapshot = useCallback(async () => {
    const seq = ++requestSeq.current;

    try {
      const response = await fetch(`/api/devices/${deviceKey}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiErrorBody;

        if (seq === requestSeq.current) {
          setLoadError(
            body.error?.code === "DEVICE_NOT_FOUND"
              ? `Dispositivo ${deviceKey} não encontrado.`
              : "Não foi possível carregar os dados.",
          );
        }

        return;
      }

      const data = (await response.json()) as DeviceSnapshot;

      if (seq === requestSeq.current) {
        setSnapshot(data);
        setLoadError(null);
      }
    } catch {
      if (seq === requestSeq.current) {
        setLoadError("Sem conexão com o servidor.");
      }
    }
  }, [deviceKey]);

  const loadSession = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      setSession((await response.json()) as SessionInfo);
    } catch {
      setSession({ authenticated: false, isAdmin: false });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    // O timer é o sistema externo que alimenta o painel. Mesmo a primeira
    // carga passa por ele, para que nenhum setState saia do corpo do efeito.
    //
    // Aba oculta não é atualizada: uma janela esquecida aberta a noite inteira
    // gastaria ~17 mil requisições sem ninguém olhando.
    const refresh = () => {
      if (cancelled || document.visibilityState !== "visible") {
        return;
      }

      void loadSnapshot();
    };

    const firstSnapshot = setTimeout(refresh, 0);
    const firstSession = setTimeout(() => {
      if (!cancelled) {
        void loadSession();
      }
    }, 0);
    const timer = setInterval(refresh, DASHBOARD_REFRESH_MS);

    // Ao voltar para a aba, atualiza na hora em vez de esperar o próximo ciclo.
    document.addEventListener("visibilitychange", refresh);

    return () => {
      cancelled = true;
      clearTimeout(firstSnapshot);
      clearTimeout(firstSession);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadSnapshot, loadSession]);

  const toggleActuator = useCallback(
    async (actuatorKey: string, value: boolean) => {
      setBusyActuator(actuatorKey);
      setActionError(null);

      try {
        const response = await fetch(
          `/api/admin/devices/${deviceKey}/actuators/${actuatorKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value }),
          },
        );

        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
          const code = body.error?.code;

          if (code === "UNAUTHENTICATED" || code === "FORBIDDEN") {
            // A sessão caiu enquanto a página estava aberta.
            setActionError("Sessão expirada. Entre novamente para controlar.");
            await loadSession();
          } else {
            setActionError("O comando não foi aceito.");
          }

          return;
        }

        await loadSnapshot();
      } catch {
        setActionError("Falha ao enviar o comando.");
      } finally {
        setBusyActuator(null);
      }
    },
    [deviceKey, loadSession, loadSnapshot],
  );

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    await loadSession();
  }, [loadSession]);

  if (loadError && !snapshot) {
    return (
      <p className="rounded-xl border border-edge bg-offline-soft p-5 text-sm text-offline">
        {loadError}
      </p>
    );
  }

  if (!snapshot) {
    return (
      <p className="rounded-xl border border-edge bg-surface p-5 text-sm text-muted">
        Carregando dados do dispositivo…
      </p>
    );
  }

  // O relógio de referência é o do servidor: o navegador pode estar
  // dessincronizado e produzir tempos relativos absurdos.
  const now = new Date(snapshot.serverTime).getTime();

  const sensors = Object.values(snapshot.sensors).sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR"),
  );
  const actuators = Object.values(snapshot.actuators).sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR"),
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {snapshot.name}
            </h1>
            {snapshot.online ? (
              <StatusPill tone="online">online</StatusPill>
            ) : (
              <StatusPill tone="offline">offline</StatusPill>
            )}
            {snapshot.enabled ? null : (
              <StatusPill tone="pending">desabilitado</StatusPill>
            )}
          </div>

          <p className="mt-1.5 text-sm text-muted">
            Última comunicação {formatRelativeTime(snapshot.lastSeenAt, now)}
            {snapshot.lastSeenAt ? ` · ${formatClock(snapshot.lastSeenAt)}` : null}
          </p>
        </div>

        <div className="flex items-center gap-3 text-sm">
          {session?.isAdmin ? (
            <>
              <span className="text-muted">{session.email}</span>
              <button
                type="button"
                onClick={() => void logout()}
                className="rounded-lg border border-edge px-3 py-1.5 font-medium transition hover:bg-surface-muted"
              >
                Sair
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-lg border border-edge px-3 py-1.5 font-medium transition hover:bg-surface-muted"
            >
              Entrar como admin
            </Link>
          )}
        </div>
      </header>

      {loadError ? (
        <p className="rounded-lg bg-pending-soft px-4 py-3 text-sm text-pending">
          {loadError} Mostrando a última leitura recebida.
        </p>
      ) : null}

      <section aria-labelledby="sensores">
        <h2
          id="sensores"
          className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted"
        >
          Sensores
        </h2>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sensors.map((sensor) => (
            <SensorCard key={sensor.key} sensor={sensor} now={now} />
          ))}
        </div>
      </section>

      <section aria-labelledby="atuadores">
        <h2
          id="atuadores"
          className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted"
        >
          Controle
        </h2>

        {actionError ? (
          <p className="mb-3 rounded-lg bg-offline-soft px-4 py-3 text-sm text-offline">
            {actionError}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {actuators.map((actuator) => (
            <ActuatorCard
              key={actuator.key}
              actuator={actuator}
              canControl={session?.isAdmin === true}
              busy={busyActuator === actuator.key}
              now={now}
              onToggle={(value) => void toggleActuator(actuator.key, value)}
            />
          ))}
        </div>
      </section>

      <footer className="text-xs text-muted">
        <span className="font-mono">{snapshot.deviceKey}</span>
        {snapshot.firmwareVersion ? ` · firmware ${snapshot.firmwareVersion}` : null}
        {" · atualiza a cada 5 s"}
      </footer>
    </div>
  );
}
