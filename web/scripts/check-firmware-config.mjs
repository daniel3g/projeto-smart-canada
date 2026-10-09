/**
 * Valida firmware/esp32-city-01/config.h antes de gravar na placa.
 *
 *   npm run check:firmware
 *
 * Confere o preenchimento, a coerência da URL com o ambiente, e — o que mais
 * importa — se o DEVICE_KEY do arquivo casa com uma credencial ativa no banco.
 * Isso evita descobrir uma credencial errada pelo Serial Monitor.
 *
 * Nenhum segredo é impresso: apenas comprimentos e o resultado da comparação
 * de hash.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";

import { createClient } from "@supabase/supabase-js";

const CONFIG_PATH = "../firmware/esp32-city-01/config.h";
const EXPECTED_DEVICE_ID = "esp32-city-01";

const fixIp = process.argv.includes("--fix-ip");

/**
 * IP desta máquina na rede local.
 *
 * A maquete alterna entre redes — hotspot do celular na bancada, Wi-Fi da
 * instituição na apresentação — e cada troca muda o IP do servidor. Editar o
 * config.h à mão a cada vez é como o IP fica obsoleto sem ninguém notar.
 */
function localIpv4() {
  const candidates = [];

  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        candidates.push({ name, ip: address.address });
      }
    }
  }

  return candidates;
}

const PLACEHOLDERS = new Set([
  "SEU_WIFI",
  "SUA_SENHA",
  "CHAVE_DO_DISPOSITIVO",
  "",
]);

if (!existsSync(CONFIG_PATH)) {
  console.error(`
  ${CONFIG_PATH} nao existe.

  Copie o template:
    cp firmware/esp32-city-01/config.example.h firmware/esp32-city-01/config.h
`);
  process.exit(1);
}

const source = readFileSync(CONFIG_PATH, "utf8");

/**
 * Lê os #define do arquivo.
 *
 * Uma passada só, com regex literal. A primeira versão disto montava a regex
 * por nome com `new RegExp` e não casava nada — falhava calada, dizendo que
 * todos os campos estavam ausentes num arquivo que estava correto.
 */
function readDefines(text) {
  const found = new Map();

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed.startsWith("#define")) {
      continue;
    }

    const match = trimmed.match(/^#define\s+([A-Za-z_][A-Za-z0-9_]*)\s+(.*)$/);

    if (!match) {
      continue;
    }

    const raw = match[2].trim();
    const quoted = raw.match(/^"(.*)"$/);

    found.set(match[1], quoted ? quoted[1] : raw);
  }

  return found;
}

const defines = readDefines(source);

let problems = 0;
let warnings = 0;

function check(ok, label, detail) {
  if (!ok) {
    problems += 1;
  }
  console.log(`  ${ok ? "ok" : "XX"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

function warn(label, detail) {
  warnings += 1;
  console.log(`  !!  ${label}${detail ? ` — ${detail}` : ""}`);
}

function filled(name) {
  const value = defines.get(name);
  return value !== undefined && !PLACEHOLDERS.has(value);
}

const ssid = defines.get("WIFI_SSID");
const password = defines.get("WIFI_PASSWORD");
const baseUrl = defines.get("API_BASE_URL");
const deviceId = defines.get("DEVICE_ID");
const deviceKey = defines.get("DEVICE_KEY");
const insecureTls = defines.get("API_INSECURE_TLS");
const debugHttp = defines.get("DEBUG_HTTP");

console.log("\n  PREENCHIMENTO");
check(filled("WIFI_SSID"), "WIFI_SSID", ssid ? `${ssid.length} caracteres` : "ausente");
check(
  filled("WIFI_PASSWORD"),
  "WIFI_PASSWORD",
  password ? `${password.length} caracteres` : "ausente",
);
check(
  deviceId === EXPECTED_DEVICE_ID,
  "DEVICE_ID",
  deviceId ?? "ausente",
);
check(
  filled("DEVICE_KEY"),
  "DEVICE_KEY",
  deviceKey ? `${deviceKey.length} caracteres` : "ausente",
);
check(
  insecureTls === "0" || insecureTls === "1",
  "API_INSECURE_TLS",
  insecureTls ?? "ausente",
);
check(debugHttp === "0" || debugHttp === "1", "DEBUG_HTTP", debugHttp ?? "ausente");

if (deviceKey && deviceKey.length !== 43) {
  // 32 bytes em base64url dão 43 caracteres. Outro tamanho sugere corte na
  // cópia.
  warn("DEVICE_KEY com tamanho inesperado", `${deviceKey.length}, esperado 43`);
}

console.log("\n  API_BASE_URL");

if (!baseUrl || baseUrl.includes("SEU_DOMINIO")) {
  check(false, "preenchida", baseUrl ?? "ausente");
} else {
  console.log(`      ${baseUrl}`);

  // Só mexe em host que é IP privado. Domínio público é decisão de deploy e
  // não deve ser sobrescrito por um IP de bancada.
  let parsedForIp = null;
  try {
    parsedForIp = new URL(baseUrl);
  } catch {}

  const isPrivateIp =
    parsedForIp !== null &&
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(
      parsedForIp.hostname,
    );

  if (isPrivateIp) {
    const candidates = localIpv4();
    const current = candidates.find((c) => c.ip === parsedForIp.hostname);

    if (!current && candidates.length > 0) {
      const target = candidates[0];

      if (fixIp) {
        parsedForIp.hostname = target.ip;
        const updated = parsedForIp.toString().replace(/\/$/, "");
        writeFileSync(
          CONFIG_PATH,
          source.replace(baseUrl, updated),
          "utf8",
        );
        console.log(`      corrigido para ${updated} (interface ${target.name})`);
        console.log("      regrave o firmware para a mudanca valer");
        process.exit(0);
      }

      check(
        false,
        "IP corresponde a esta maquina",
        `config.h aponta ${parsedForIp.hostname}, mas esta maquina esta em ` +
          candidates.map((c) => `${c.ip} (${c.name})`).join(", ") +
          " — rode com --fix-ip",
      );
    } else if (current) {
      check(true, "IP corresponde a esta maquina", `interface ${current.name}`);
    }
  }

  check(
    !baseUrl.endsWith("/"),
    "sem barra no final",
    baseUrl.endsWith("/") ? "o firmware concatena /sync e viraria //sync" : undefined,
  );
  check(
    baseUrl.endsWith("/api/iot"),
    "termina em /api/iot",
    baseUrl.endsWith("/api/iot") ? undefined : "o firmware chama <base>/sync",
  );

  let parsed = null;
  try {
    parsed = new URL(baseUrl);
  } catch {
    check(false, "URL valida");
  }

  if (parsed) {
    const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname);
    const isLocal = isIp || parsed.hostname === "localhost";

    check(
      parsed.hostname !== "localhost",
      "host alcancavel pelo ESP32",
      parsed.hostname === "localhost"
        ? "localhost no ESP32 aponta para ele mesmo; use o IP da sua maquina"
        : parsed.hostname,
    );

    if (parsed.protocol === "https:" && isLocal) {
      check(false, "esquema coerente", "https com IP local nao tem certificado valido; use http na bancada");
    } else if (parsed.protocol === "http:" && !isLocal) {
      check(false, "esquema coerente", "http para dominio publico expoe o DEVICE_KEY em texto claro");
    } else if (parsed.protocol === "http:" && isLocal) {
      check(true, "esquema coerente", "bancada em http, TLS fora da equacao");
    } else {
      check(true, "esquema coerente", "producao em https");

      if (insecureTls === "1") {
        warn(
          "https com API_INSECURE_TLS=1",
          "criptografa mas nao autentica o servidor; o DEVICE_KEY fica exposto a quem se passar pelo dominio",
        );
      }
    }
  }
}

console.log("\n  CREDENCIAL CONTRA O BANCO");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  warn("verificacao pulada", "variaveis do Supabase ausentes em .env.local");
} else {
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const { data: device, error } = await db
    .from("devices")
    .select("id, enabled")
    .eq("device_key", deviceId ?? "")
    .maybeSingle();

  if (error) {
    check(false, "consulta ao banco", error.message);
  } else if (!device) {
    check(false, "dispositivo existe no banco", `device_key "${deviceId}" nao cadastrado`);
  } else {
    check(true, "dispositivo existe no banco");
    check(device.enabled, "dispositivo habilitado");

    const { data: credentials } = await db
      .from("device_credentials")
      .select("secret_hash")
      .eq("device_id", device.id)
      .is("revoked_at", null);

    const hash = deviceKey
      ? createHash("sha256").update(deviceKey, "utf8").digest("hex")
      : "";
    const matches = (credentials ?? []).some((row) => row.secret_hash === hash);

    check(
      matches,
      "DEVICE_KEY casa com credencial ativa",
      matches
        ? `${credentials.length} credencial(is) ativa(s)`
        : "hash nao corresponde — gere outra com provision:device --revoke-existing",
    );
  }
}

if (problems > 0) {
  console.log(`\n  ${problems} problema(s)${warnings ? ` e ${warnings} aviso(s)` : ""}.\n`);
  process.exit(1);
}

console.log(
  warnings > 0
    ? `\n  config.h pronto para gravar, com ${warnings} aviso(s).\n`
    : "\n  config.h pronto para gravar.\n",
);
