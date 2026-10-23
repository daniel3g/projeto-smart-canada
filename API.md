# API.md

## Base

Rotas iniciais:

```text
/api/iot/sync     dispositivo (ESP32), rota única
/api/devices/*    leitura pública
/api/admin/*      controle, exige admin
/api/auth/*       sessão de admin
```

## Níveis de acesso

Classificam **rotas**, não usuários. Existe um único tipo de usuário humano: admin, sem papéis nem permissões parciais.

Toda rota pertence a exatamente um nível:

| Nível | Autenticação | Exemplo |
|---|---|---|
| `public` | nenhuma | leitura de sensores e estado |
| `admin` | sessão Supabase Auth | acionar atuador |
| `device` | header de dispositivo | ciclo de sync |

Regra de ouro:

```text
GET de monitoramento        → public
qualquer escrita de usuário → admin
escrita do ESP32            → device
```

Negar por padrão. Uma rota sem nível declarado é tratada como `admin`.

Autenticação conceitual do dispositivo:

```http
X-Device-Id: esp32-city-01
X-Device-Key: <segredo>
```

O segredo nunca deve ser retornado por uma response.

Autenticação de admin usa sessão Supabase Auth (cookie). A verificação ocorre sempre no servidor.

```text
Nunca autorizar com base em campo enviado pelo cliente.
Nunca aceitar algo como { "isAdmin": true } no body.
```

## POST /api/iot/sync

Nível: `device`. É a **única** rota do dispositivo.

Substituiu `/telemetry`, `/heartbeat`, `/commands` e `/commands/:id/ack`. Essas
quatro rotas somavam cerca de 3,4 milhões de invocações por mês para um único
ESP32, o que não cabe em plano gratuito. Ver ARCHITECTURE.md
"Orçamento de requisições".

Um ciclo faz tudo:

```text
request  → leituras, estado real dos atuadores, confirmações do ciclo anterior
response → comandos novos, estado desejado, ritmo do próximo ciclo
```

Request:

```json
{
  "firmwareVersion": "0.2.0",
  "wifiRssi": -58,
  "uptimeSeconds": 5421,
  "readings": [
    { "key": "temperature", "value": 26.4, "unit": "celsius" },
    { "key": "humidity", "value": 58, "unit": "percent" },
    { "key": "sound_detected", "value": false, "unit": "boolean" }
  ],
  "actuators": {
    "led_main": false
  },
  "acks": [
    { "id": "uuid", "status": "executed", "reportedState": true }
  ]
}
```

Response:

```json
{
  "ok": true,
  "serverTime": "2026-10-09T11:00:00.000Z",
  "nextPollMs": 30000,
  "commands": [
    {
      "id": "uuid",
      "actuator": "led_main",
      "type": "set_boolean",
      "value": true
    }
  ],
  "actuators": {
    "led_main": true
  }
}
```

Todos os campos do request são opcionais. Um ciclo vazio (`{}`) ainda serve
como heartbeat: `last_seen_at` é atualizado por qualquer chamada autenticada.

### nextPollMs

Quem decide o ritmo é o servidor, não o firmware. Mudar a política de consumo
não exige regravar dispositivo.

```text
30000   repouso
 1000   comando em aberto, ou atividade do admin no último minuto
```

O firmware limita o valor recebido entre 500 ms e 5 minutos, para que um valor
absurdo não o deixe mudo nem o faça martelar.

Consequência prática: o **primeiro** clique espera até um ciclo de repouso.
A partir dele a janela rápida está aberta e os cliques seguintes são imediatos.

### Leituras

Uma chave desconhecida rejeita o pacote inteiro com `SENSOR_UNKNOWN` e a lista
em `details`. Aceitar parcialmente esconderia um sensor mal cadastrado atrás de
uma resposta de sucesso.

Chave repetida no mesmo pacote: vence a última leitura.

`sound_detected` não é o estado instantâneo, e sim "houve som desde a última
publicação". Com ciclo de 30 s, publicar o instantâneo perderia quase todo
evento curto. Ver FIRMWARE.md "Sensor de som".

### Estado dos atuadores

O mapa `actuators` do request é a verdade completa sobre o que o dispositivo
está aplicando, e vira `reported`. É o que mantém o painel honesto sem depender
de ACK, e o que cura um reboot: o dispositivo sobe desligado, informa isso, e
recebe de volta o estado desejado.

Chave desconhecida no request é ignorada, ao contrário das leituras. Recusar o
ciclo por causa de um atuador removido do banco deixaria o dispositivo
aparecendo como offline — pior do que a divergência que se quer evitar. O mapa
da resposta já informa quais chaves o servidor reconhece.

Na resposta, só entram atuadores com desejo registrado. Um atuador nunca
comandado não tem meta, e o firmware deve deixá-lo como está em vez de
adivinhar.

### Confirmações

`acks` confirma comandos recebidos no ciclo anterior. Viajar junto do ciclo
seguinte, em vez de numa requisição própria, elimina uma invocação por comando.

```json
{ "id": "uuid", "status": "executed", "reportedState": true }
{ "id": "uuid", "status": "failed", "error": "GPIO unavailable" }
```

Um id que não pertence ao dispositivo autenticado não atualiza nada, e o ciclo
segue normalmente: derrubar a requisição por causa de um id inválido tiraria o
dispositivo do ar por um erro inofensivo.

Comando entregue e não confirmado em 2 minutos vira `expired`
(`SYNC_DELIVERED_TIMEOUT_MS`). A entrega é marcada antes de a resposta chegar
ao ESP32; se ela se perde (timeout logo depois de reconectar), sem esse prazo o
comando ficava em aberto para sempre e prendia a janela rápida de 1 s. O estado
do atuador não depende disso: a reconciliação abaixo corrige.

### Reconciliação

Comandos são consumidos uma vez: entregues, viram `delivered`. Isso falha em
dois casos, e o par estado real / estado desejado é o que cobre os dois:

- **reboot** — o dispositivo sobe sem saber o que o painel pediu;
- **comando perdido** — a entrega falhou na rede depois de ser marcada.

```text
comando    caminho rápido      1 s, quando a janela está aberta
sync       rede de segurança  todo ciclo
```


## GET /api/devices/:deviceKey

Nível: `public`. Sem login.

Responde com `s-maxage=3`: o painel atualiza a cada 5 s, então 3 s de cache na
CDN não atrasa nada perceptível e faz vários visitantes simultâneos
compartilharem uma única invocação. Seguro porque a projeção é pública e não
varia por sessão.

Cada sensor carrega o próprio rótulo e unidade. Sem isso o dashboard teria de
embutir o catálogo em código, e um sensor novo exigiria mudança no frontend —
o oposto de "novos sensores sem reestruturação".

`serverTime` existe para que a interface calcule "há quantos segundos" pelo
relógio do servidor. O relógio do navegador pode estar errado.

```json
{
  "deviceKey": "esp32-city-01",
  "name": "Maquete Cidade Inteligente",
  "description": "ESP32 com DHT11, sensor de som digital e LED",
  "enabled": true,
  "online": true,
  "lastSeenAt": "2026-10-08T11:00:00.000Z",
  "firmwareVersion": "0.1.0",
  "serverTime": "2026-10-08T11:00:04.000Z",
  "sensors": {
    "temperature": {
      "key": "temperature",
      "name": "Temperatura",
      "type": "DHT11",
      "unit": "celsius",
      "value": 26.4,
      "recordedAt": "2026-10-08T11:00:00.000Z"
    },
    "sound_detected": {
      "key": "sound_detected",
      "name": "Detecção de som",
      "type": "sound_module",
      "unit": "boolean",
      "value": false,
      "recordedAt": "2026-10-08T11:00:00.000Z"
    }
  },
  "actuators": {
    "led_main": {
      "key": "led_main",
      "name": "LED principal",
      "type": "led",
      "desired": true,
      "reported": true,
      "desiredUpdatedAt": "2026-10-08T10:59:58.000Z",
      "reportedUpdatedAt": "2026-10-08T10:59:59.000Z"
    }
  }
}
```

Nenhum campo aqui é secreto: sem GPIO, sem hash de credencial.

## GET /api/devices/:deviceKey/history

Nível: `public`. Alimenta os gráficos.

```text
?sensorKey=temperature   obrigatório
&minutes=60              padrão 60, máximo 1440
&limit=500               padrão 500, máximo 5000
```

```json
{
  "deviceKey": "esp32-city-01",
  "sensorKey": "temperature",
  "unit": "celsius",
  "points": [
    { "recordedAt": "2026-10-08T10:00:00.000Z", "value": 25.9 },
    { "recordedAt": "2026-10-08T10:00:05.000Z", "value": 26.1 }
  ]
}
```

Os pontos vêm em ordem cronológica.

## POST /api/admin/devices/:deviceKey/actuators/:actuatorKey

Nível: `admin`. Exige sessão autenticada de admin.

Esta é a rota que acende LED, liga irrigação e dispara alarme. Ela nunca pode ser pública.

Request:

```json
{ "value": true }
```

Response:

```json
{
  "ok": true,
  "commandId": "uuid"
}
```

Sem sessão:

```json
{
  "ok": false,
  "error": {
    "code": "UNAUTHENTICATED",
    "message": "Authentication required"
  }
}
```

Sessão válida que não é admin:

```json
{
  "ok": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Admin privileges required"
  }
}
```

## Sessão de admin

```text
POST /api/auth/login     público, consome e-mail e senha
POST /api/auth/logout    admin
GET  /api/auth/session   público, responde quem é o usuário atual
```

`GET /api/auth/session` para um visitante:

```json
{ "authenticated": false, "isAdmin": false }
```

Para um admin:

```json
{
  "authenticated": true,
  "isAdmin": true,
  "email": "admin@exemplo.com"
}
```

Não existe rota de cadastro público. Admins são criados fora da aplicação.

Login inválido responde `401` com `INVALID_CREDENTIALS` e nunca revela se o e-mail existe.

## Demais rotas de admin

Mesmo nível `admin`, mesmo tratamento de erro:

```text
POST   /api/admin/devices
PATCH  /api/admin/devices/:deviceKey
POST   /api/admin/devices/:deviceKey/sensors
POST   /api/admin/devices/:deviceKey/actuators
POST   /api/admin/devices/:deviceKey/credentials/rotate
DELETE /api/admin/commands/:id
```

## Formato de erro

```json
{
  "ok": false,
  "error": {
    "code": "DEVICE_UNAUTHORIZED",
    "message": "Device authentication failed"
  }
}
```

Códigos iniciais:

```text
INVALID_PAYLOAD
UNAUTHENTICATED
FORBIDDEN
INVALID_CREDENTIALS
RATE_LIMITED
DEVICE_UNAUTHORIZED
DEVICE_DISABLED
DEVICE_NOT_FOUND
SENSOR_UNKNOWN
ACTUATOR_UNKNOWN
COMMAND_NOT_FOUND
INTERNAL_ERROR
```

Status HTTP correspondente:

| Código | HTTP |
|---|---:|
| `INVALID_PAYLOAD` | 400 |
| `UNAUTHENTICATED` | 401 |
| `INVALID_CREDENTIALS` | 401 |
| `DEVICE_UNAUTHORIZED` | 401 |
| `FORBIDDEN` | 403 |
| `DEVICE_DISABLED` | 403 |
| `DEVICE_NOT_FOUND` | 404 |
| `SENSOR_UNKNOWN` | 404 |
| `ACTUATOR_UNKNOWN` | 404 |
| `COMMAND_NOT_FOUND` | 404 |
| `RATE_LIMITED` | 429 |
| `INTERNAL_ERROR` | 500 |

Mensagem de erro de autenticação não deve revelar se o e-mail, o dispositivo ou a chave é que estava errada.

Falha de infraestrutura não é falha de credencial. Supabase indisponível
responde `INTERNAL_ERROR`, nunca `INVALID_CREDENTIALS`: tratar os dois como a
mesma coisa faz o admin duvidar da própria senha durante um incidente e esconde
o problema real de quem opera.

`details` acompanha apenas `INVALID_PAYLOAD`, com a lista de campos recusados.
Nenhum outro erro expõe detalhe interno.

## Regras

- Validar payloads.
- Atualizar `last_seen_at` em chamadas autenticadas. A escrita é limitada a uma
  a cada 5 s por dispositivo, para não gravar à toa quando a janela rápida
  estiver aberta.
- Nunca aceitar GPIO vindo do dashboard.
- Dashboard trabalha por `actuator_key`.
- Firmware é responsável por mapear `actuator_key` para GPIO.
- Declarar o nível de acesso de toda rota nova.
- Verificar a sessão de admin no servidor, em toda rota `admin`.
- Não misturar leitura pública e escrita de admin na mesma rota.
- Resposta pública não deve conter `secret_hash`, `device_key` secreto nem `gpio`.
- Registrar o admin autor em todo comando criado.
- Aplicar limite de tentativas no login.
- Pensar no custo por invocação antes de criar rota nova de dispositivo: o
  ciclo do ESP32 roda sozinho, para sempre, e multiplica qualquer descuido.
