/**
 * Verifica se o Supabase está pronto: schema, seed e o modelo de permissões.
 *
 *   node --env-file=.env.local scripts/check-setup.mjs
 *
 * Usa fetch direto contra o PostgREST em vez do cliente, de propósito: o
 * status HTTP é a resposta honesta. Um `head` pelo cliente pode devolver
 * sucesso aparente quando a tabela não existe.
 *
 * A segunda metade é o teste que importa de verdade: com a chave pública,
 * confirma que leitura funciona, que GPIO não sai, que as tabelas privadas não
 * são alcançáveis e que escrita é recusada.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !serviceKey) {
  console.error(
    "\n  NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente em .env.local.\n",
  );
  process.exit(1);
}

let failures = 0;
let skipped = 0;

function report(ok, label, detail) {
  if (ok === null) {
    skipped += 1;
    console.log(`  --  ${label}${detail ? ` (${detail})` : ""}`);
    return;
  }

  if (!ok) {
    failures += 1;
  }

  console.log(`  ${ok ? "ok" : "XX"}  ${label}${detail ? ` (${detail})` : ""}`);
}

async function rest(path, key, init = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();

  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  return { status: response.status, body };
}

const TABLES = [
  "devices",
  "device_credentials",
  "sensors",
  "sensor_state",
  "telemetry",
  "actuators",
  "actuator_state",
  "commands",
  "admin_users",
];

console.log(`\n  Projeto: ${new URL(url).host}\n`);
console.log("  SCHEMA");

for (const table of TABLES) {
  const { status, body } = await rest(`${table}?select=*&limit=1`, serviceKey);
  report(
    status === 200,
    `tabela ${table}`,
    status === 200 ? undefined : `HTTP ${status} ${body?.code ?? ""}`.trim(),
  );
}

const isAdmin = await rest("rpc/is_admin", serviceKey, {
  method: "POST",
  body: JSON.stringify({ uid: "00000000-0000-0000-0000-000000000000" }),
});
report(
  isAdmin.status === 200,
  "função is_admin()",
  isAdmin.status === 200 ? undefined : `HTTP ${isAdmin.status}`,
);

if (failures > 0) {
  console.log(
    "\n  As migrations não foram aplicadas (ou ficaram incompletas).",
  );
  console.log("  Aplique com a CLI:");
  console.log('    supabase db push --db-url "postgresql://..."');
  console.log("  ou cole os arquivos de supabase/migrations/ no SQL Editor.\n");
  process.exit(1);
}

console.log("\n  SEED");

const devices = await rest("devices?select=device_key,enabled", serviceKey);
report(
  Array.isArray(devices.body) && devices.body.length > 0,
  "dispositivo cadastrado",
  Array.isArray(devices.body)
    ? devices.body.map((d) => d.device_key).join(", ") || "nenhum"
    : "erro",
);

const sensors = await rest("sensors?select=sensor_key", serviceKey);
report(
  Array.isArray(sensors.body) && sensors.body.length >= 3,
  "sensores cadastrados",
  Array.isArray(sensors.body)
    ? sensors.body.map((s) => s.sensor_key).join(", ") || "nenhum"
    : "erro",
);

const actuators = await rest("actuators?select=actuator_key", serviceKey);
report(
  Array.isArray(actuators.body) && actuators.body.length >= 1,
  "atuadores cadastrados",
  Array.isArray(actuators.body)
    ? actuators.body.map((a) => a.actuator_key).join(", ") || "nenhum"
    : "erro",
);

const credentials = await rest(
  "device_credentials?select=id&revoked_at=is.null",
  serviceKey,
);
const hasCredential =
  Array.isArray(credentials.body) && credentials.body.length > 0;
report(
  hasCredential,
  "credencial de dispositivo",
  hasCredential ? undefined : "nenhuma — rode provision:device",
);

const admins = await rest(
  "admin_users?select=email&revoked_at=is.null",
  serviceKey,
);
const hasAdmin = Array.isArray(admins.body) && admins.body.length > 0;
report(
  hasAdmin,
  "admin ativo",
  hasAdmin ? admins.body.map((a) => a.email).join(", ") : "nenhum — rode admin:promote",
);

console.log("\n  PERMISSÕES (com a chave pública)");

if (!anonKey) {
  report(null, "NEXT_PUBLIC_SUPABASE_ANON_KEY vazia", "testes pulados");
} else {
  const publicReads = [
    ["devices", "device_key"],
    ["sensors", "sensor_key"],
    ["sensor_state", "recorded_at"],
    ["telemetry", "recorded_at"],
    ["actuators", "actuator_key"],
    ["actuator_state", "desired_boolean"],
  ];

  for (const [table, column] of publicReads) {
    const { status } = await rest(`${table}?select=${column}&limit=1`, anonKey);
    report(status === 200, `leitura pública de ${table}`, status === 200 ? undefined : `HTTP ${status}`);
  }

  // Princípio 20: leitura pública nunca retorna GPIO.
  for (const table of ["sensors", "actuators"]) {
    const { status } = await rest(`${table}?select=gpio&limit=1`, anonKey);
    report(
      status !== 200,
      `GPIO de ${table} bloqueado`,
      status === 200 ? "VAZANDO: anon leu gpio" : `HTTP ${status}`,
    );
  }

  // Tabelas sem leitura pública.
  for (const table of ["device_credentials", "commands", "admin_users"]) {
    const { status, body } = await rest(`${table}?select=*&limit=1`, anonKey);
    const blocked = status !== 200 || (Array.isArray(body) && body.length === 0);
    report(
      blocked,
      `${table} inalcançável`,
      status === 200 && Array.isArray(body) && body.length > 0
        ? "VAZANDO: anon leu dados"
        : `HTTP ${status}`,
    );
  }

  // Escrita pelo cliente é negada: toda escrita passa pela API.
  const write = await rest("telemetry", anonKey, {
    method: "POST",
    body: JSON.stringify({
      device_id: "00000000-0000-0000-0000-000000000000",
      sensor_id: "00000000-0000-0000-0000-000000000000",
      value_numeric: 1,
    }),
  });
  report(
    write.status !== 201,
    "escrita anônima recusada",
    write.status === 201 ? "VAZANDO: anon inseriu telemetria" : `HTTP ${write.status}`,
  );
}

console.log("");

if (failures > 0) {
  console.log(`  ${failures} verificação(ões) falharam.\n`);
  process.exit(1);
}

console.log(
  skipped > 0
    ? `  Tudo certo no que foi testado. ${skipped} teste(s) pulado(s).\n`
    : "  Tudo certo.\n",
);
