-- 20261009090100_rls.sql
-- Regra de negócio no banco. Ver AGENTS.md "Modelo de permissões".
--
--   leitura de monitoramento → liberada
--   qualquer escrita         → somente pela API, com service_role
--
-- Nenhuma policy de insert/update/delete é concedida a anon ou authenticated.
-- Isso mantém um único ponto de decisão de autorização: a API.

alter table public.devices            enable row level security;
alter table public.device_credentials enable row level security;
alter table public.sensors            enable row level security;
alter table public.sensor_state       enable row level security;
alter table public.telemetry          enable row level security;
alter table public.actuators          enable row level security;
alter table public.actuator_state     enable row level security;
alter table public.commands           enable row level security;
alter table public.admin_users        enable row level security;

-- ------------------------------------------------------- leitura pública
-- Monitoramento é aberto: qualquer visitante vê sensores, estado e histórico.

create policy public_read_devices on public.devices
  for select to anon, authenticated using (true);

create policy public_read_sensors on public.sensors
  for select to anon, authenticated using (enabled);

create policy public_read_sensor_state on public.sensor_state
  for select to anon, authenticated using (true);

create policy public_read_telemetry on public.telemetry
  for select to anon, authenticated using (true);

create policy public_read_actuators on public.actuators
  for select to anon, authenticated using (enabled);

create policy public_read_actuator_state on public.actuator_state
  for select to anon, authenticated using (true);

-- --------------------------------------------------- sem leitura pública
-- RLS habilitado e nenhuma policy: inalcançáveis pelo cliente.
--   device_credentials → nunca sai do servidor
--   admin_users        → nunca sai do servidor
--   commands           → somente via API
-- O revoke abaixo é redundante com RLS, e proposital: defesa em camadas.

revoke all on public.device_credentials from anon, authenticated;
revoke all on public.admin_users        from anon, authenticated;
revoke all on public.commands           from anon, authenticated;

-- ---------------------------------------------------------------- colunas
-- AGENTS.md, princípio 20: leitura pública nunca retorna GPIO.
--
-- RLS filtra linhas, não colunas. A restrição de coluna vem do grant.
-- Um grant de SELECT na tabela inteira cobre todas as colunas e não pode ser
-- reduzido por "revoke select (coluna)": é preciso revogar a tabela e então
-- conceder apenas as colunas públicas.

revoke select on public.sensors   from anon, authenticated;
revoke select on public.actuators from anon, authenticated;

grant select (
  id, device_id, sensor_key, name, sensor_type, unit, enabled, metadata, created_at
) on public.sensors to anon, authenticated;

grant select (
  id, device_id, actuator_key, name, actuator_type, enabled, metadata, created_at
) on public.actuators to anon, authenticated;

-- --------------------------------------------------------------- escrita
-- Explicitamente negado no cliente. A API usa service_role, que ignora RLS,
-- depois de validar sessão de admin ou credencial de dispositivo.

revoke insert, update, delete on all tables in schema public
  from anon, authenticated;
