import "server-only";

/**
 * Leitura preguiçosa das variáveis de ambiente.
 *
 * Nada é avaliado na importação, para que o build não quebre em uma máquina
 * sem `.env.local`. O erro aparece na primeira requisição que precisa do valor.
 */
function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `Variável de ambiente ausente: ${name}. Ver .env.example.`,
    );
  }

  return value;
}

export function supabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL");
}

export function supabaseAnonKey(): string {
  return required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

/**
 * Nunca deve alcançar o navegador nem o firmware.
 * Ver AGENTS.md, princípio 1.
 */
export function supabaseServiceRoleKey(): string {
  return required("SUPABASE_SERVICE_ROLE_KEY");
}
