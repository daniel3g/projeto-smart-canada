/**
 * Marca um usuário existente do Supabase Auth como admin.
 *
 *   node --env-file=.env.local scripts/promote-admin.mjs admin@exemplo.com
 *   node --env-file=.env.local scripts/promote-admin.mjs admin@exemplo.com --revoke
 *
 * Não existe cadastro público. O usuário é criado antes, no painel do Supabase
 * (Authentication > Users) ou com --create, e só então ganha permissão aqui.
 *
 * Admin é binário: estar nesta tabela com revoked_at nulo é a permissão
 * inteira. Ver AGENTS.md "Sem níveis de acesso".
 */
import { createClient } from "@supabase/supabase-js";

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const email = process.argv[2];
const revoke = process.argv.includes("--revoke");
const create = process.argv.includes("--create");

if (!email || email.startsWith("--")) {
  fail(
    "Informe o e-mail.\n" +
      "  Exemplo: node --env-file=.env.local scripts/promote-admin.mjs admin@exemplo.com",
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

async function findUserByEmail(target) {
  // A API de admin pagina; o número de admins é pequeno, algumas páginas bastam.
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (error) {
      fail(`Erro ao listar usuários: ${error.message}`);
    }

    const found = data.users.find(
      (user) => user.email?.toLowerCase() === target.toLowerCase(),
    );

    if (found) {
      return found;
    }

    if (data.users.length < 200) {
      return null;
    }
  }

  return null;
}

let user = await findUserByEmail(email);

if (!user && create) {
  const password = process.env.ADMIN_SEED_PASSWORD;

  if (!password) {
    fail("--create exige ADMIN_SEED_PASSWORD definido no ambiente.");
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    fail(`Erro ao criar o usuário: ${error.message}`);
  }

  user = data.user;
  console.log(`  Usuário criado no Supabase Auth: ${email}`);
}

if (!user) {
  fail(
    `Usuário "${email}" não existe no Supabase Auth.\n` +
      "  Crie em Authentication > Users, ou rode novamente com --create.",
  );
}

if (revoke) {
  const { error } = await supabase
    .from("admin_users")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("revoked_at", null);

  if (error) {
    fail(`Erro ao revogar: ${error.message}`);
  }

  console.log(`
  Permissão de admin revogada: ${email}
  O histórico de comandos já emitidos é preservado.
`);
  process.exit(0);
}

// Upsert com revoked_at nulo também reativa um admin revogado antes.
const { error } = await supabase
  .from("admin_users")
  .upsert(
    { user_id: user.id, email, revoked_at: null },
    { onConflict: "user_id" },
  );

if (error) {
  fail(`Erro ao conceder permissão: ${error.message}`);
}

console.log(`
  Admin ativo: ${email}
  Entre em /login para controlar os atuadores.
`);
