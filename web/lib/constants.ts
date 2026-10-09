/** Limiar de online. Ver ARCHITECTURE.md "Online / Offline". */
export const DEVICE_ONLINE_THRESHOLD_SECONDS = 30;

/** Intervalo de atualização do dashboard. ARCHITECTURE.md "Frequências iniciais". */
export const DASHBOARD_REFRESH_MS = 5_000;

/**
 * Evita um UPDATE por requisição. A consulta de comandos roda a cada 1 s;
 * gravar `last_seen_at` em todas as chamadas custaria uma escrita por segundo
 * sem ganho, já que o limiar de online é de 30 s.
 */
export const LAST_SEEN_WRITE_THROTTLE_SECONDS = 5;

/**
 * Ritmo do ciclo do dispositivo.
 *
 * O intervalo é decidido pelo servidor e enviado em `nextPollMs`, para que
 * mudar a política não exija regravar firmware.
 *
 * Em repouso, 30 s. Com trabalho em aberto ou atividade recente do admin, 1 s.
 * Ver ARCHITECTURE.md "Orçamento de requisições".
 */
export const SYNC_IDLE_POLL_MS = 30_000;
export const SYNC_FAST_POLL_MS = 1_000;

/**
 * Quanto tempo a janela rápida permanece aberta após um comando.
 *
 * Cada clique novo a renova, então durante uso ativo ela não fecha. Medido em
 * requisições: a 1 s, cada minuto de janela custa 60 invocações por clique
 * isolado. Três minutos custavam 180 e não davam sensação melhor.
 */
export const SYNC_FAST_WINDOW_MS = 60_000;

/** Comandos entregues por ciclo. */
export const SYNC_MAX_COMMANDS = 20;

/** Dispositivo exibido pelo dashboard quando nenhum outro é informado. */
export const DEFAULT_DEVICE_KEY =
  process.env.NEXT_PUBLIC_DEFAULT_DEVICE_KEY ?? "esp32-city-01";

export const APP_NAME =
  process.env.NEXT_PUBLIC_APP_NAME ?? "ESP32 IoT Dashboard";
