# ESP32 IoT Cloud Dashboard

Plataforma IoT para monitoramento e controle de uma maquete de cidade inteligente usando ESP32.

## Estado atual

Hardware funcional em rede local:

- ESP32
- LED — GPIO 23
- DHT11 — GPIO 22
- Sensor de som digital — GPIO 21
- LDR — GPIO 34, acende o LED da rua no GPIO 25 ao escurecer

A interface local já possui temperatura, umidade, detecção de som, controle do LED e atualização assíncrona.

## Objetivo da próxima etapa

Mover o dashboard para um domínio público sem expor diretamente o ESP32 à internet.

```text
ESP32 ⇄ API Next.js ⇄ Supabase ⇄ Dashboard
```

Hospedagem prevista:

- Web/API: Vercel
- Banco: Supabase
- Domínio: domínio ou subdomínio próprio

## Como rodar

### 1. Banco

Crie um projeto no Supabase. As migrations seguem o formato de versão da CLI
e são aplicadas em ordem de nome:

```text
supabase/migrations/20261009090000_schema.sql
supabase/migrations/20261009090100_rls.sql
supabase/migrations/20261009090200_seed.sql
```

Pela CLI, com a string de conexão que o painel mostra no botão **Connect**:

```bash
supabase db push --db-url "postgresql://postgres:SENHA@HOST:5432/postgres"
```

Ou linkando o projeto uma vez:

```bash
supabase login
supabase link --project-ref SEU_REF
supabase db push
```

Pelo SQL Editor, cole o conteúdo dos três arquivos, um por vez, nessa ordem.

O seed é uma migration de propósito: `supabase db push` aplica migrations, mas
não aplica `seed.sql`. Ele é idempotente, então repetir não duplica nada.

### 2. Variáveis

```bash
cp .env.example web/.env.local
```

Preencha com a URL do projeto, a chave `anon` e a `service_role`
(Project Settings > API). A `service_role` fica apenas no servidor.

### 3. Aplicação

```bash
cd web
npm install
npm run dev
```

O monitoramento já abre em `http://localhost:3000`, sem login.

Confira o estado do banco a qualquer momento:

```bash
cd web
npm run db:check
```

Além do schema e do seed, esse comando testa o modelo de permissões contra o
banco real: confirma que a leitura pública funciona, que GPIO não sai, que
`commands`, `admin_users` e `device_credentials` são inalcançáveis pelo cliente
e que escrita anônima é recusada.

### 4. Primeiro admin

Crie o usuário em Authentication > Users no painel do Supabase, depois conceda
a permissão:

```bash
cd web
npm run admin:promote -- admin@exemplo.com
```

Para criar o usuário e conceder de uma vez, defina `ADMIN_SEED_PASSWORD` no
`.env.local` e use `-- admin@exemplo.com --create`.

Revogar: `npm run admin:promote -- admin@exemplo.com --revoke`.

### 5. Credencial do ESP32

```bash
cd web
npm run provision:device -- esp32-city-01
```

O segredo aparece uma única vez. Copie para o `config.h` do firmware, que não
é versionado.

## Simulador do dispositivo

Antes de o firmware existir, é possível exercitar todo o caminho de nuvem:

```bash
cd web
# PowerShell
$env:DEVICE_SECRET="o-segredo-do-provision"
npm run simulate:device -- --watch
```

O simulador faz o que o ESP32 fará: um `POST /api/iot/sync` por ciclo, com as
leituras, o estado real dos atuadores e as confirmações do ciclo anterior. Usa
só a credencial do dispositivo, nunca a `service_role`, e respeita o
`nextPollMs` que o servidor devolve — 30 s em repouso, 1 s quando há comando em
aberto.

Com `--watch` ele mantém o painel online, com valores variando, e responde aos
botões de controle.

É a forma de testar o dashboard e a reconciliação de estado sem hardware.

## Autoteste das rotas de dispositivo

```bash
cd web
npm run selftest
```

Exercita o ciclo de sync por HTTP — leituras, estado real, entrega de comando,
confirmação, reconciliação e a abertura da janela rápida — sem precisar do
segredo do ESP32: cria uma credencial temporária, usa, e apaga no final,
inclusive se falhar. A credencial real não é tocada, e o que o teste escreve é
revertido.

Exige o servidor rodando. Para apontar para outro host:

```bash
npm run selftest -- --url https://seu-dominio
```

## Antes de gravar o firmware

```bash
cd web
npm run check:firmware
```

Confere preenchimento do `config.h`, coerência da URL com o ambiente e — o que
mais importa — se o `DEVICE_KEY` do arquivo casa com uma credencial ativa no
banco. Nenhum segredo é impresso.

A maquete alterna de rede: hotspot do celular na bancada, Wi-Fi da instituição
na apresentação. Cada troca muda o IP do servidor, e o `config.h` fica obsoleto
sem ninguém notar. Para corrigir automaticamente:

```bash
npm run check:firmware -- --fix-ip
```

Só reescreve host que seja IP privado. Domínio público é decisão de deploy e
não é sobrescrito por IP de bancada.

## Verificação

```bash
cd web
npm run typecheck
npm run lint
npm run build
npm run db:check
npm run selftest
```

## Leia nesta ordem

1. `AGENTS.md`
2. `ARCHITECTURE.md`
3. `DATABASE.md`
4. `API.md`
5. `FIRMWARE.md`

## Modelo de permissões

```text
Ver dados      → público, sem login
Controlar algo → somente admin autenticado
```

Monitoramento é aberto: sensores, histórico, status e última comunicação ficam visíveis para qualquer visitante.

Controle é fechado: acender LED, ligar irrigação, acionar alarme ou cadastrar dispositivo exige login de admin com e-mail e senha.

Detalhes em `AGENTS.md` e `DATABASE.md`.

## Primeira entrega cloud

- dispositivo online/offline;
- última comunicação;
- temperatura atual;
- umidade atual;
- estado do sensor de som;
- monitoramento público sem login;
- login de admin por e-mail e senha;
- controle remoto do LED restrito a admin;
- histórico preparado para gráficos;
- arquitetura pronta para novos sensores e atuadores.

## Painel 3D da Mostra

Em `/maquete` (https://projeto-smart-canada.vercel.app/maquete) fica o painel 3D feito pelo aluno
Samuel (repositório `dashboard-mostra-internacional`, branch `integracao-professor`), publicado
junto com este site.

- É um **build estático** em `web/public/maquete/`. Não tem rota de API própria, segredo nem login.
- Lê só a leitura pública `GET /api/devices/esp32-city-01`, a cada 10 s e só com a aba visível,
  como qualquer visitante.
- Mostra só o que este painel já tem: temperatura, umidade, LED principal, iluminação da rua,
  luminosidade, som e se a placa está online (com a hora da última leitura). Não comanda nada:
  o LED continua só aqui, com login de admin.
- `/maquete?modo=cartoes` abre sem o 3D (para computador fraco). Celular abre os cartões sozinho.

Para atualizar, no projeto do aluno:

```bash
npm run build:nuvem          # gera entrega/maquete com base /maquete/
```

Depois troque o conteúdo de `web/public/maquete/` pelo de `entrega/maquete/` e faça push.
O `rewrite` de `/maquete` está em `web/next.config.ts`.

## Segurança

Não fazer port forwarding para o ESP32.

Nenhuma rota de controle sem verificação de sessão de admin no servidor.

Nunca versionar:

```text
.env
.env.local
config.h
secrets.h
```
