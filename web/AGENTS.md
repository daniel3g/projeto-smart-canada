<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- Conteúdo fora do bloco acima é preservado quando o `next dev` o reescreve. -->

## Regras deste projeto

O bloco acima é gerado pelo Next e trata só do framework.

As regras do projeto estão em `../AGENTS.md`, na raiz, junto de
`../ARCHITECTURE.md`, `../API.md`, `../DATABASE.md` e `../FIRMWARE.md`.
Leia a raiz antes de alterar código aqui.

Resumo do que mais importa:

```text
Ver dados      → público, sem login
Controlar algo → somente admin autenticado
```

- Toda rota nova é classificada como `public`, `admin` ou `device`.
- Rota de controle começa com `requireAdmin()`.
- `service_role` só depois de uma verificação de autorização explícita.
- Resposta pública nunca inclui GPIO nem hash de credencial.
- Admin é binário: sem papéis, sem níveis.
