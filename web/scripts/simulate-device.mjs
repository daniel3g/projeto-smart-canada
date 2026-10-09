/**
 * Simula o ESP32 contra a API, para validar o caminho de nuvem e ver o painel
 * ao vivo antes do firmware existir.
 *
 *   # PowerShell
 *   $env:DEVICE_SECRET="o-segredo-do-provision"
 *   npm run simulate:device
 *   npm run simulate:device -- --watch
 *
 *   # bash
 *   DEVICE_SECRET=... npm run simulate:device -- --watch
 *
 * Opções:
 *   --watch          roda continuamente, no ritmo que o servidor ditar
 *   --url <base>     padrão http://localhost:3000
 *   --device <key>   padrão esp32-city-01
 *
 * O segredo vem do ambiente de propósito, para não ficar no histórico do
 * shell. Ele também pode ser passado como primeiro argumento.
 *
 * Espelha o firmware: um único POST /api/iot/sync por ciclo, com as leituras,
 * o estado real dos atuadores e as confirmações do ciclo anterior. O intervalo
 * é o `nextPollMs` que o servidor devolve, não um valor fixo daqui.
 */
const args = process.argv.slice(2);

function flag(name) {
  return args.includes(name);
}

function option(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const secret =
  process.env.DEVICE_SECRET ?? (args[0] && !args[0].startsWith("--") ? args[0] : null);
const baseUrl = option("--url", "http://localhost:3000").replace(/\/$/, "");
const deviceKey = option("--device", "esp32-city-01");
const watch = flag("--watch");

if (!secret) {
  console.error(`
  Falta o segredo do dispositivo.

    PowerShell:  $env:DEVICE_SECRET="..."; npm run simulate:device
    bash:        DEVICE_SECRET=... npm run simulate:device

  Gere um novo com:
    npm run provision:device -- ${deviceKey} --revoke-existing
`);
  process.exit(1);
}

/** Estado real dos atuadores, como o firmware manteria em RAM. */
const actuatorState = { led_main: false };

/** Confirmações a enviar no próximo ciclo, como o firmware faz. */
let pendingAcks = [];

/** Trava do evento de som: ver sensors.h no firmware. */
let soundLatched = false;

let nextPollMs = 30_000;

function readSensors() {
  // Valores plausíveis, com variação suave.
  const t = 25 + Math.sin(Date.now() / 60_000) * 2 + (Math.random() - 0.5) * 0.3;
  const h = 58 + Math.cos(Date.now() / 90_000) * 5 + (Math.random() - 0.5);

  // Sensor de som é binário e esporádico. A trava segura o evento até a
  // publicação, igual ao firmware.
  if (Math.random() < 0.15) {
    soundLatched = true;
  }

  return [
    { key: "temperature", value: Number(t.toFixed(1)), unit: "celsius" },
    { key: "humidity", value: Math.round(h), unit: "percent" },
    { key: "sound_detected", value: soundLatched, unit: "boolean" },
  ];
}

function stamp() {
  return new Date().toLocaleTimeString("pt-BR");
}

async function sync() {
  const payload = {
    firmwareVersion: "0.2.0-sim",
    wifiRssi: -55 - Math.round(Math.random() * 10),
    uptimeSeconds: Math.round(process.uptime()),
    readings: readSensors(),
    actuators: { ...actuatorState },
  };

  if (pendingAcks.length > 0) {
    payload.acks = pendingAcks;
  }

  let response;
  let body;

  try {
    response = await fetch(`${baseUrl}/api/iot/sync`, {
      method: "POST",
      headers: {
        "X-Device-Id": deviceKey,
        "X-Device-Key": secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text.slice(0, 200);
    }
  } catch (error) {
    console.log(`  ${stamp()}  sync        sem conexao (${error.message})`);
    return;
  }

  if (response.status === 401 || response.status === 403) {
    console.error(`
  Credencial recusada: HTTP ${response.status} ${body?.error?.code ?? ""}

  Gere outra:
    npm run provision:device -- ${deviceKey} --revoke-existing
`);
    process.exit(1);
  }

  if (!response.ok) {
    console.log(
      `  ${stamp()}  sync        HTTP ${response.status}  ${JSON.stringify(body)}`,
    );
    return;
  }

  // Aceitas: a fila de confirmações esvazia e a janela de som recomeça.
  pendingAcks = [];
  soundLatched = false;

  if (typeof body?.nextPollMs === "number") {
    nextPollMs = body.nextPollMs;
  }

  const readingSummary = payload.readings
    .map((r) => `${r.key}=${r.value}`)
    .join(" ");

  console.log(
    `  ${stamp()}  sync        HTTP 200  proximo=${nextPollMs}ms  ${readingSummary}`,
  );

  // Reconciliação: o servidor diz o que o painel quer.
  const desired = body?.actuators ?? {};

  for (const [key, value] of Object.entries(desired)) {
    if (!(key in actuatorState)) {
      console.log(`  ${stamp()}  aviso       atuador desconhecido: ${key}`);
      continue;
    }

    if (actuatorState[key] !== value) {
      actuatorState[key] = value;
      console.log(
        `  ${stamp()}  reconcilia  ${key} -> ${value ? "LIGADO" : "DESLIGADO"} (divergia do painel)`,
      );
    }
  }

  // Comandos: executa e enfileira a confirmação para o próximo ciclo.
  for (const command of body?.commands ?? []) {
    const { id, actuator, type, value } = command;

    console.log(`  ${stamp()}  comando     ${actuator} ${type} valor=${value}`);

    if (type !== "set_boolean" || typeof value !== "boolean") {
      pendingAcks.push({ id, status: "failed", error: `unsupported command: ${type}` });
      continue;
    }

    if (!(actuator in actuatorState)) {
      pendingAcks.push({ id, status: "failed", error: "GPIO unavailable" });
      continue;
    }

    // Aqui o firmware faria digitalWrite.
    actuatorState[actuator] = value;
    console.log(
      `  ${stamp()}  GPIO        ${actuator} -> ${value ? "LIGADO" : "DESLIGADO"}`,
    );

    pendingAcks.push({ id, status: "executed", reportedState: value });
  }
}

console.log(`
  Simulando ${deviceKey} contra ${baseUrl}
  ${watch ? "modo continuo, ritmo ditado pelo servidor — Ctrl+C para parar" : "ciclo unico"}
`);

await sync();

if (!watch) {
  console.log(`
  Pronto. O painel deve mostrar o dispositivo online por ~30 s.
  Para manter online e testar os botoes, rode com --watch.
`);
  process.exit(0);
}

// setTimeout em cadeia, não setInterval: o intervalo muda a cada resposta.
async function loop() {
  await sync();
  setTimeout(() => void loop(), nextPollMs);
}

setTimeout(() => void loop(), nextPollMs);
