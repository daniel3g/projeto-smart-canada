-- 20261009090000_schema.sql
-- Schema inicial. Ver DATABASE.md.
-- Modelo genérico: um sensor ou atuador novo não exige tabela nova.

create extension if not exists "pgcrypto";

-- Mantém updated_at coerente sem depender da aplicação.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- devices

create table public.devices (
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

create trigger devices_set_updated_at
  before update on public.devices
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------ device_credentials
-- Segredo nunca em texto puro. Ver FIRMWARE.md e AGENTS.md.

create table public.device_credentials (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  secret_hash text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index device_credentials_device_idx
  on public.device_credentials(device_id)
  where revoked_at is null;

-- ---------------------------------------------------------------- sensors

create table public.sensors (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
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

-- ----------------------------------------------------------- sensor_state

create table public.sensor_state (
  sensor_id uuid primary key references public.sensors(id) on delete cascade,
  value_numeric double precision,
  value_boolean boolean,
  value_text text,
  recorded_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create trigger sensor_state_set_updated_at
  before update on public.sensor_state
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------- telemetry

create table public.telemetry (
  id bigint generated always as identity primary key,
  device_id uuid not null references public.devices(id) on delete cascade,
  sensor_id uuid not null references public.sensors(id) on delete cascade,
  value_numeric double precision,
  value_boolean boolean,
  value_text text,
  recorded_at timestamptz not null default now()
);

create index telemetry_sensor_time_idx
  on public.telemetry(sensor_id, recorded_at desc);

create index telemetry_device_time_idx
  on public.telemetry(device_id, recorded_at desc);

-- -------------------------------------------------------------- actuators

create table public.actuators (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  actuator_key text not null,
  name text not null,
  actuator_type text not null,
  gpio integer,
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(device_id, actuator_key)
);

-- --------------------------------------------------------- actuator_state

create table public.actuator_state (
  actuator_id uuid primary key references public.actuators(id) on delete cascade,
  desired_boolean boolean,
  reported_boolean boolean,
  desired_updated_at timestamptz,
  reported_updated_at timestamptz
);

-- ------------------------------------------------------------- admin_users
-- A identidade vive em auth.users. Esta tabela diz quem pode controlar.
-- Admin é binário por decisão de projeto: sem coluna role, sem papéis.

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = uid and revoked_at is null
  );
$$;

-- --------------------------------------------------------------- commands

create table public.commands (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  actuator_id uuid references public.actuators(id) on delete cascade,
  command_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  executed_at timestamptz,
  error_message text,
  constraint commands_status_check check (
    status in ('pending', 'delivered', 'executed', 'failed', 'expired')
  )
);

create index commands_device_status_idx
  on public.commands(device_id, status, created_at);
