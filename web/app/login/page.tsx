"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type ApiErrorBody = {
  error?: { code?: string; message?: string };
};

/**
 * Login de admin. Não existe cadastro: admins são criados fora da aplicação
 * e marcados em `admin_users`. Ver AGENTS.md "Modelo de permissões".
 */
export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiErrorBody;

        // A API não distingue e-mail inexistente de senha errada de conta sem
        // permissão. A mensagem aqui acompanha essa decisão.
        setError(
          body.error?.code === "RATE_LIMITED"
            ? "Muitas tentativas. Aguarde alguns minutos."
            : "E-mail ou senha inválidos.",
        );
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("Não foi possível entrar. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Acesso do administrador</h1>

      <p className="mt-2 text-sm text-muted">
        O monitoramento é público. O login serve apenas para controlar
        atuadores.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium">
            E-mail
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-lg border border-edge bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium">
            Senha
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded-lg border border-edge bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-offline-soft px-3 py-2 text-sm text-offline"
          >
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 rounded-lg bg-accent px-3 py-2.5 text-sm font-medium text-white transition disabled:opacity-60"
        >
          {submitting ? "Entrando…" : "Entrar"}
        </button>
      </form>

      <Link href="/" className="mt-6 text-sm text-muted hover:text-foreground">
        Voltar ao monitoramento
      </Link>
    </main>
  );
}
