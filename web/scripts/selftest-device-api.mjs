/**
 * Teste de ponta a ponta da rota de dispositivo, sem precisar do segredo do
 * ESP32.
 *
 *   npm run selftest -- --url http://localhost:3000
 *
 * Cria uma credencial temporária, exercita o ciclo de sync por HTTP, e apaga a
 * credencial no final — inclusive se algo falhar.
 *
 * O segredo é gerado e usado dentro deste processo e nunca é impresso. A
 * credencial real do dispositivo não é tocada: credenciais ativas coexistem de
 * propósito, é o que permite rotacionar sem derrubar o ESP32.
 *
 * Reverte tudo que escreve: telemetria, estado dos sensores, estado do atuador
 * e comandos voltam ao que eram antes.
 *
 * Duas defesas contra falso positivo, aprendidas na prática:
 *
 *   1. Os valores publicados são aleatórios a cada execução. Com valores
 *      fixos, uma leitura obsoleta de `sensor_state` passava por nova e o
 *      teste dizia "ok" enquanto a rota devolvia 500.
 *   2. Toda verificação de escrita confere o timestamp, não só o valor. Valor
 *      igual por coincidência não prova que foi este ciclo que gravou.
 */
import { createHash, randomBytes } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const urlIndex = args.indexOf("--url");
const baseUrl = (urlIndex >= 0 && args[urlIndex + 1] ? args[urlIndex + 1] : "http://localhost:3000").replace(/\/$/, "");
const deviceKey = "esp32-city-01";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("\n  Variáveis do Supabase ausentes em .env.local.\n");
  process.exit(1);
}

const db = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

let failures = 0;

function check(ok, label, detail) {
  if (!ok) {
    failures += 1;
  }
  console.log(`  ${ok ? "ok" : "XX"}  ${label}${detail ? ` (${detail})` : ""}`);
}

/** Lançado quando um sync falha: continuar produziria resultados vazios. */
class AbortTest extends Error {}

/** Motivo da interrupção, quando houver. Abortar conta como falha. */
let aborted = null;

function requireOk(result, label) {
  const ok = result.status === 200;
  check(ok, label, `HTTP ${result.status}${ok ? "" : ` ${result.body?.error?.code ?? ""}`}`);

  if (!ok) {
    throw new AbortTest(
      `${label} devolveu HTTP ${result.status}. As demais verificações dependem dela.`,
    );
  }

  return result.body;
}

const secret = randomBytes(32).toString("base64url");
const secretHash = createHash("sha256").update(secret, "utf8").digest("hex");

const { data: device, error: deviceError } = await db
  .from("devices")
  .select("id")
  .eq("device_key", deviceKey)
  .maybeSingle();

if (deviceError || !device) {
  console.error(`\n  Dispositivo ${deviceKey} não encontrado. Rode npm run db:check.\n`);
  process.exit(1);
}

const { data: credential, error: credentialError } = await db
  .from("device_credentials")
  .insert({ device_id: device.id, secret_hash: secretHash })
  .select("id")
  .single();

if (credentialError) {
  console.error(`\n  Não foi possível criar a credencial temporária: ${credentialError.message}\n`);
  process.exit(1);
}

// ------------------------------------------------- estado anterior, para voltar
const { data: sensorsBefore } = await db
  .from("sensors")
  .select("id, sensor_key, sensor_state ( value_numeric, value_boolean, value_text, recorded_at )")
  .eq("device_id", device.id);

const { data: actuatorBefore } = await db
  .from("actuators")
  .select("id, actuator_state ( desired_boolean, reported_boolean, desired_updated_at, reported_updated_at )")
  .eq("device_id", device.id)
  .eq("actuator_key", "led_main")
  .maybeSingle();

function embedded(value) {
  return Array.isArray(value) ? value[0] : value;
}

const testStartedAt = new Date().toISOString();

async function cleanup() {
  // Apagada, não revogada: uma credencial de teste não é histórico de
  // segurança, e revogar deixaria uma linha nova a cada execução.
  await db.from("device_credentials").delete().eq("id", credential.id);

  await db
    .from("telemetry")
    .delete()
    .eq("device_id", device.id)
    .gte("recorded_at", testStartedAt);

  await db
    .from("commands")
    .delete()
    .eq("device_id", device.id)
    .gte("created_at", testStartedAt);

  // sensor_state não é histórico: é o que o painel mostra. Deixar valores de
  // teste aqui fazia o dashboard exibir leituras inventadas até a telemetria
  // seguinte.
  for (const sensor of sensorsBefore ?? []) {
    const previous = embedded(sensor.sensor_state);

    if (!previous) {
      await db.from("sensor_state").delete().eq("sensor_id", sensor.id);
      continue;
    }

    await db.from("sensor_state").upsert(
      {
        sensor_id: sensor.id,
        value_numeric: previous.value_numeric,
        value_boolean: previous.value_boolean,
        value_text: previous.value_text,
        recorded_at: previous.recorded_at,
      },
      { onConflict: "sensor_id" },
    );
  }

  if (actuatorBefore?.id) {
    const previous = embedded(actuatorBefore.actuator_state);

    await db.from("actuator_state").upsert(
      {
        actuator_id: actuatorBefore.id,
        desired_boolean: previous?.desired_boolean ?? null,
        reported_boolean: previous?.reported_boolean ?? null,
        desired_updated_at: previous?.desired_updated_at ?? null,
        reported_updated_at: previous?.reported_updated_at ?? null,
      },
      { onConflict: "actuator_id" },
    );
  }
}

async function sync(payload) {
  let response;

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
  } catch (error) {
    // Servidor fora do ar é a causa mais comum. Despejar stack trace aqui
    // esconderia isso atrás de ruído.
    throw new AbortTest(
      `nao foi possivel falar com ${baseUrl} (${error.cause?.code ?? error.message}). ` +
        "O servidor esta rodando? cd web && npm run dev",
    );
  }

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text.slice(0, 160);
  }

  return { status: response.status, body };
}

// Valores diferentes a cada execução: leitura obsoleta não pode coincidir.
const probe = {
  temperature: Number((15 + Math.random() * 20).toFixed(2)),
  humidity: Math.floor(30 + Math.random() * 60),
  sound: Math.random() < 0.5,
};

try {
  console.log(`\n  Autoteste contra ${baseUrl}`);
  console.log(
    `  sonda: temperature=${probe.temperature} humidity=${probe.humidity} sound=${probe.sound}\n`,
  );

  // -------------------------------------------------- leituras e repouso
  const first = requireOk(
    await sync({
      firmwareVersion: "selftest",
      readings: [
        { key: "temperature", value: probe.temperature },
        { key: "humidity", value: probe.humidity },
        { key: "sound_detected", value: probe.sound },
      ],
      actuators: { led_main: false },
    }),
    "sync aceito",
  );

  check(first?.nextPollMs === 30000, "intervalo de repouso devolvido", `${first?.nextPollMs}ms`);
  check(Array.isArray(first?.commands), "campo commands presente");
  check(
    typeof first?.actuators === "object" && first.actuators !== null,
    "estado desejado presente",
    JSON.stringify(first?.actuators),
  );

  const { data: stored } = await db
    .from("sensor_state")
    .select("value_numeric, value_boolean, recorded_at, sensors!inner(sensor_key, device_id)")
    .eq("sensors.device_id", device.id);

  const byKey = Object.fromEntries(
    (stored ?? []).map((row) => [row.sensors.sensor_key, row]),
  );

  function checkSensor(key, expected, label) {
    const row = byKey[key];
    const value = row?.value_numeric ?? row?.value_boolean;
    const fresh = row?.recorded_at >= testStartedAt;

    // Valor E frescor: valor certo com timestamp velho é leitura obsoleta
    // passando por nova.
    check(
      value === expected && fresh,
      label,
      `${value}${fresh ? "" : " — TIMESTAMP ANTIGO, nao foi este ciclo"}`,
    );
  }

  checkSensor("temperature", probe.temperature, "temperatura gravada neste ciclo");
  checkSensor("humidity", probe.humidity, "umidade gravada neste ciclo");
  checkSensor("sound_detected", probe.sound, "som gravado neste ciclo");

  const { data: reportedAfterSync } = await db
    .from("actuator_state")
    .select("reported_boolean, reported_updated_at")
    .eq("actuator_id", actuatorBefore.id)
    .single();

  check(
    reportedAfterSync?.reported_boolean === false &&
      reportedAfterSync?.reported_updated_at >= testStartedAt,
    "estado real registrado sem precisar de ack",
    String(reportedAfterSync?.reported_boolean),
  );

  // Chave desconhecida rejeita o pacote inteiro.
  const unknown = await sync({ readings: [{ key: "nao_existe", value: 1 }] });
  check(
    unknown.status === 404 && unknown.body?.error?.code === "SENSOR_UNKNOWN",
    "sensor desconhecido rejeitado",
    `HTTP ${unknown.status} ${unknown.body?.error?.code ?? ""}`,
  );

  // ------------------------------------------- comando, janela rápida, ack
  // Reproduz o que a rota de admin faz: o comando E o estado desejado. São
  // duas escritas, e esquecer a segunda foi exatamente o que fez este teste
  // falhar na primeira versão.
  const { data: command } = await db
    .from("commands")
    .insert({
      device_id: device.id,
      actuator_id: actuatorBefore.id,
      command_type: "set_boolean",
      payload: { value: true },
      status: "pending",
    })
    .select("id")
    .single();

  await db.from("actuator_state").upsert(
    {
      actuator_id: actuatorBefore.id,
      desired_boolean: true,
      desired_updated_at: new Date().toISOString(),
    },
    { onConflict: "actuator_id" },
  );

  const withCommand = requireOk(
    await sync({ actuators: { led_main: false } }),
    "sync com comando pendente",
  );

  const delivered = (withCommand?.commands ?? []).find((c) => c.id === command.id);
  check(delivered !== undefined, "comando entregue");
  check(delivered?.actuator === "led_main", "actuator_key no comando", delivered?.actuator);
  check(delivered?.value === true, "valor no comando", String(delivered?.value));
  check(
    withCommand?.nextPollMs === 1000,
    "janela rapida aberta ao entregar comando",
    `${withCommand?.nextPollMs}ms`,
  );
  check(
    withCommand?.actuators?.led_main === true,
    "divergencia informada (desejado true x real false)",
    JSON.stringify(withCommand?.actuators),
  );

  // Ciclo seguinte confirma e reporta o estado real já aplicado.
  const withAck = requireOk(
    await sync({
      actuators: { led_main: true },
      acks: [{ id: command.id, status: "executed", reportedState: true }],
    }),
    "sync com ack",
  );

  // Só vale se o campo veio: lista ausente não prova nao-reentrega.
  check(
    Array.isArray(withAck?.commands) &&
      !withAck.commands.some((c) => c.id === command.id),
    "comando nao e reentregue",
  );

  const { data: afterAck } = await db
    .from("commands")
    .select("status, executed_at")
    .eq("id", command.id)
    .single();
  check(
    afterAck?.status === "executed" && afterAck?.executed_at >= testStartedAt,
    "comando marcado executed",
    afterAck?.status,
  );

  const { data: reported } = await db
    .from("actuator_state")
    .select("reported_boolean, reported_updated_at")
    .eq("actuator_id", actuatorBefore.id)
    .single();
  check(
    reported?.reported_boolean === true &&
      reported?.reported_updated_at >= testStartedAt,
    "reported atualizado",
    String(reported?.reported_boolean),
  );

  // Ack de id inexistente não deve derrubar o ciclo.
  const foreign = await sync({
    acks: [
      {
        id: "00000000-0000-0000-0000-000000000000",
        status: "executed",
        reportedState: true,
      },
    ],
  });
  check(
    foreign.status === 200,
    "ack de id inexistente nao derruba o ciclo",
    `HTTP ${foreign.status}`,
  );

  // Credencial inválida continua sendo recusada.
  const badAuth = await fetch(`${baseUrl}/api/iot/sync`, {
    method: "POST",
    headers: {
      "X-Device-Id": deviceKey,
      "X-Device-Key": "errado",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ actuators: {} }),
  });
  check(badAuth.status === 401, "credencial invalida recusada", `HTTP ${badAuth.status}`);
} catch (error) {
  if (error instanceof AbortTest) {
    aborted = error.message;
  } else {
    throw error;
  }
} finally {
  await cleanup();
  console.log("\n  credencial temporaria apagada, estado anterior restaurado");
}

// Abortar não é passar. Um teste que para no meio e anuncia sucesso é pior do
// que teste nenhum: foi assim que uma rota quebrada passou por sã.
if (aborted) {
  console.log(`\n  INTERROMPIDO: ${aborted}`);
  console.log("  As verificacoes restantes nao rodaram.\n");
  process.exit(1);
}

console.log(
  failures > 0
    ? `\n  ${failures} verificacao(oes) falharam.\n`
    : "\n  Todas as verificacoes passaram.\n",
);

process.exit(failures > 0 ? 1 : 0);
