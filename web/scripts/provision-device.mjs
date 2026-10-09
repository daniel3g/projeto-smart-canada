/**
 * Gera uma credencial para um dispositivo e grava apenas o hash.
 *
 *   node --env-file=.env.local scripts/provision-device.mjs esp32-city-01
 *
 * O segredo é impresso uma única vez, aqui no terminal. Ele não é recuperável
 * depois: o banco guarda só o SHA-256. Copie para o `config.h` do firmware,
 * que está no .gitignore.
 *
 * Use --revoke-existing ao rotacionar. Sem essa flag a credencial antiga
 * continua válida, o que permite trocar o segredo sem derrubar o dispositivo.
 */
import { createHash, randomBytes } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const deviceKey = process.argv[2];
const revokeExisting = process.argv.includes("--revoke-existing");

if (!deviceKey || deviceKey.startsWith("--")) {
  fail(
    "Informe o device_key.\n" +
      "  Exemplo: node --env-file=.env.local scripts/provision-device.mjs esp32-city-01",
  );
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  fail(
    "Variáveis ausentes. Rode com --env-file=.env.local e confira .env.example.",
  );
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: device, error: deviceError } = await supabase
  .from("devices")
  .select("id, name")
  .eq("device_key", deviceKey)
  .maybeSingle();

if (deviceError) {
  fail(`Erro ao consultar o dispositivo: ${deviceError.message}`);
}

if (!device) {
  fail(
    `Dispositivo "${deviceKey}" não existe. Aplique as migrations primeiro.`,
  );
}

if (revokeExisting) {
  const { error } = await supabase
    .from("device_credentials")
    .update({ revoked_at: new Date().toISOString() })
    .eq("device_id", device.id)
    .is("revoked_at", null);

  if (error) {
    fail(`Erro ao revogar credenciais anteriores: ${error.message}`);
  }
}

const secret = randomBytes(32).toString("base64url");
const secretHash = createHash("sha256").update(secret, "utf8").digest("hex");

const { error: insertError } = await supabase
  .from("device_credentials")
  .insert({ device_id: device.id, secret_hash: secretHash });

if (insertError) {
  fail(`Erro ao gravar a credencial: ${insertError.message}`);
}

console.log(`
  Credencial criada para ${device.name} (${deviceKey})
  ${revokeExisting ? "Credenciais anteriores foram revogadas." : "Credenciais anteriores continuam válidas."}

  Guarde em firmware/esp32-city-01/config.h:

    #define DEVICE_ID "${deviceKey}"
    #define DEVICE_KEY "${secret}"

  Este segredo não será exibido novamente.
`);
