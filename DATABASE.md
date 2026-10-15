# DATABASE.md

## Objetivo

Schema inicial preparado para múltiplos ESP32s, sensores e atuadores.

## devices

```sql
create table devices (
  id uuid primary key default gen_random_uuid(),
  device_key text unique not null,
  name text not null,
  description text,
  enabled boolean not null default true,
  last_seen_at timestamptz,
  firmware_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

`updated_at` é mantido por trigger, não pela aplicação:

```sql
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger devices_set_updated_at
  before update on public.devices
  for each row execute function public.set_updated_at();
```

O mesmo trigger é aplicado em `sensor_state`.

## device_credentials

Não armazenar segredo em texto puro.

O segredo tem 32 bytes aleatórios e é guardado como SHA-256.

Não é senha de usuário: ninguém digita e ninguém memoriza. Por isso SHA-256 e
não bcrypt. A consulta de comandos roda a cada 1 s por dispositivo; um KDF
deliberadamente lento viraria o gargalo da API sem ganho real contra força
bruta sobre 256 bits de entropia.

Várias credenciais ativas no mesmo dispositivo são aceitas de propósito: é o
que permite rotacionar o segredo sem derrubar o ESP32 que ainda usa o antigo.

```sql
create table device_credentials (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id) on delete cascade,
  secret_hash text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
```

## sensors

```sql
create table sensors (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id) on delete cascade,
  sensor_key text not null,
  name text not null,
  sensor_type text not null,
  unit text,
  gpio integer,
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(device_id, sensor_key)
);
```

## sensor_state

```sql
create table sensor_state (
  sensor_id uuid primary key references sensors(id) on delete cascade,
  value_numeric double precision,
  value_boolean boolean,
  value_text text,
  recorded_at timestamptz not null,
  updated_at timestamptz not null default now()
);
```

## telemetry

```sql
create table telemetry (
  id bigint generated always as identity primary key,
  device_id uuid not null references devices(id) on delete cascade,
  sensor_id uuid not null references sensors(id) on delete cascade,
  value_numeric double precision,
  value_boolean boolean,
  value_text text,
  recorded_at timestamptz not null default now()
);

create index telemetry_sensor_time_idx
  on telemetry(sensor_id, recorded_at desc);

create index telemetry_device_time_idx
  on telemetry(device_id, recorded_at desc);
```

## actuators

```sql
create table actuators (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id) on delete cascade,
  actuator_key text not null,
  name text not null,
  actuator_type text not null,
  gpio integer,
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(device_id, actuator_key)
);
```

## actuator_state

```sql
create table actuator_state (
  actuator_id uuid primary key references actuators(id) on delete cascade,
  desired_boolean boolean,
  reported_boolean boolean,
  desired_updated_at timestamptz,
  reported_updated_at timestamptz
);
```

## commands

```sql
create table commands (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id) on delete cascade,
  actuator_id uuid references actuators(id) on delete cascade,
  command_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  executed_at timestamptz,
  error_message text
);

create index commands_device_status_idx
  on commands(device_id, status, created_at);
```

Status previstos, garantidos por constraint:

```sql
constraint commands_status_check check (
  status in ('pending', 'delivered', 'executed', 'failed', 'expired')
)
```

```text
pending    criado pelo admin, ainda não entregue
delivered  entregue ao dispositivo
executed   confirmado pelo dispositivo
failed     o dispositivo recusou ou falhou
expired    reservado para limpeza futura
```

A entrega marca `delivered` condicionada a `status = 'pending'` e devolve ao
dispositivo apenas os comandos efetivamente marcados, para que duas consultas
simultâneas não entreguem o mesmo comando duas vezes.

## admin_users

A identidade do admin vive em `auth.users`, gerenciada pelo Supabase Auth. Esta tabela marca quem tem permissão de controle.

```sql
create table admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
```

Um usuário é admin quando existe uma linha com `revoked_at is null`.

Admin é binário por decisão de projeto. Esta tabela não tem coluna `role` e não deve ganhar uma. Não criar tabela de papéis ou permissões.

```sql
create or replace function is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from admin_users
    where user_id = uid and revoked_at is null
  );
$$;
```

Revogar acesso não apaga o histórico de comandos já emitidos:

```sql
update admin_users set revoked_at = now() where email = 'admin@exemplo.com';
```

Não existe cadastro público. O primeiro admin é criado manualmente no painel do Supabase e inserido aqui.

## Dados iniciais

### Dispositivo

```text
esp32-city-01
```

### Sensores

```text
temperature    | DHT11        | celsius | GPIO 22
humidity       | DHT11        | percent | GPIO 22
sound_detected | sound_module | boolean | GPIO 21
luminosity     | LDR          | percent | GPIO 34
street_lights  | street_lights| boolean | GPIO 25
```

### Atuador

```text
led_main | led | GPIO 23
```

## Admin inicial

```text
admin@exemplo.com
```

Criado via Supabase Auth, depois inserido em `admin_users`.

## RLS e segurança

Regra de negócio aplicada no banco:

```text
leitura de monitoramento → liberada
qualquer escrita         → somente pela API
```

Habilitar RLS em todas as tabelas:

```sql
alter table devices            enable row level security;
alter table device_credentials enable row level security;
alter table sensors            enable row level security;
alter table sensor_state       enable row level security;
alter table telemetry          enable row level security;
alter table actuators          enable row level security;
alter table actuator_state     enable row level security;
alter table commands           enable row level security;
alter table admin_users        enable row level security;
```

### Leitura pública

```sql
create policy public_read_devices on devices
  for select to anon, authenticated using (true);

create policy public_read_sensors on sensors
  for select to anon, authenticated using (enabled);

create policy public_read_sensor_state on sensor_state
  for select to anon, authenticated using (true);

create policy public_read_telemetry on telemetry
  for select to anon, authenticated using (true);

create policy public_read_actuators on actuators
  for select to anon, authenticated using (enabled);

create policy public_read_actuator_state on actuator_state
  for select to anon, authenticated using (true);
```

### Sem leitura pública

`device_credentials`, `commands` e `admin_users` ficam com RLS habilitado e **sem policy** para `anon` e `authenticated`. Ninguém os alcança pelo cliente.

```text
device_credentials → nunca sai do servidor
admin_users        → nunca sai do servidor
commands           → somente via API
```

### Escrita

Nenhuma policy de `insert`, `update` ou `delete` é concedida a `anon` ou `authenticated`.

Toda escrita acontece na API, com `service_role`, depois de:

- validar a sessão de admin, nas rotas de controle;
- validar `X-Device-Id` e `X-Device-Key`, nas rotas de dispositivo.

Isso mantém um único ponto de decisão de autorização.

### Consequência do grant de coluna

Verificado contra o banco real, com a chave pública:

```text
select=sensor_key  → 200
select=gpio        → 401, 42501 permission denied for table sensors
select=*           → 401, 42501 permission denied for table sensors
```

`select *` é negado por inteiro, não filtrado. O Postgres expande o `*` para
todas as colunas, `gpio` está entre elas, e a query inteira cai. A mensagem que
chega é "permission denied for table sensors", que soa como se a tabela toda
fosse privada — ela não é.

Portanto, quem consultar `sensors` ou `actuators` direto do navegador, com a
chave pública ou por Realtime, precisa nomear as colunas:

```ts
supabase.from("sensors").select("sensor_key, name, unit")
```

Hoje isso não afeta a aplicação: o dashboard lê pela API, que usa
`service_role`. Se a leitura direta do navegador passar a ser usada, a saída
limpa é uma view pública sem `gpio`, com grant na view em vez da tabela.

### Cuidados

- `gpio` não deve ser enviado para o cliente público; selecionar colunas explicitamente em vez de `select *`.
- `service_role` nunca vai para o navegador nem para o firmware.
- O ESP32 não deve receber uma `service_role` do Supabase. Preferir API intermediária com autenticação própria do dispositivo.
- `is_admin()` é `security definer` e por isso deve ter `search_path` fixo.
- Realtime no dashboard público deve assinar apenas tabelas com leitura pública.
