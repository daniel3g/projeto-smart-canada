-- 20261015120000_lighting.sql
-- LDR da maquete, que também acende a iluminação externa da cidade.
-- Ver FIRMWARE.md "Iluminação automática".
--
-- Precisa existir antes do firmware publicar a leitura: chave desconhecida faz
-- a API rejeitar o pacote inteiro (SENSOR_UNKNOWN). Idempotente.

insert into public.sensors (device_id, sensor_key, name, sensor_type, unit, gpio)
select d.id, 'luminosity', 'Luminosidade', 'LDR', 'percent', 34
from public.devices d
where d.device_key = 'esp32-city-01'
on conflict (device_id, sensor_key) do nothing;

-- Estado da iluminação externa, decidido pelo próprio ESP32 a partir do LDR.
-- Publicado como sensor, não atuador: o painel só mostra, não comanda.
insert into public.sensors (device_id, sensor_key, name, sensor_type, unit, gpio)
select d.id, 'street_lights', 'Iluminação da cidade', 'street_lights', 'boolean', 25
from public.devices d
where d.device_key = 'esp32-city-01'
on conflict (device_id, sensor_key) do nothing;
