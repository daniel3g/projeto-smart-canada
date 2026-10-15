-- 20261009090200_seed.sql
-- Dados iniciais da maquete. Ver DATABASE.md "Dados iniciais".
-- Idempotente: pode rodar novamente sem duplicar.
--
-- Não cria credencial de dispositivo. O segredo é gerado fora daqui, por
-- scripts/provision-device.mjs, para nunca existir em arquivo versionado.

insert into public.devices (device_key, name, description)
values (
  'esp32-city-01',
  'Maquete Cidade Inteligente',
  'ESP32 com DHT11, sensor de som digital e LED'
)
on conflict (device_key) do nothing;

insert into public.sensors (device_id, sensor_key, name, sensor_type, unit, gpio)
select d.id, v.sensor_key, v.name, v.sensor_type, v.unit, v.gpio
from public.devices d
cross join (values
  ('temperature',    'Temperatura',      'DHT11',        'celsius', 22),
  ('humidity',       'Umidade',          'DHT11',        'percent', 22),
  ('sound_detected', 'Detecção de som',  'sound_module', 'boolean', 21)
) as v(sensor_key, name, sensor_type, unit, gpio)
where d.device_key = 'esp32-city-01'
on conflict (device_id, sensor_key) do nothing;

insert into public.actuators (device_id, actuator_key, name, actuator_type, gpio)
select d.id, 'led_main', 'LED principal', 'led', 23
from public.devices d
where d.device_key = 'esp32-city-01'
on conflict (device_id, actuator_key) do nothing;

-- Estado inicial do atuador: desligado, ainda não confirmado pelo dispositivo.
insert into public.actuator_state (actuator_id, desired_boolean)
select a.id, false
from public.actuators a
join public.devices d on d.id = a.device_id
where d.device_key = 'esp32-city-01' and a.actuator_key = 'led_main'
on conflict (actuator_id) do nothing;
