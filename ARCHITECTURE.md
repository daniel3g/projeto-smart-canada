# ARCHITECTURE.md

## Visão geral

A aplicação é dividida em quatro responsabilidades:

```text
Dashboard → API → Supabase ← ESP32
```

## Permissões

A aplicação tem duas metades com regras opostas:

```text
Monitoramento → público
Controle      → admin autenticado
```

```text
Visitante ──── leitura ─────▶ API ──▶ Supabase
Admin ──────── leitura ─────▶ API ──▶ Supabase
Admin ──────── escrita ─────▶ API ──▶ comando ──▶ ESP32
ESP32 ──── telemetria/ACK ──▶ API ──▶ Supabase
```

Visitante não escreve nada. Dispositivo escreve apenas sobre si mesmo. Somente o admin cria comandos.

Admin é binário: não há papéis, níveis nem permissão por dispositivo.

A autorização é decidida no servidor. A interface pode ocultar controles de quem não é admin, mas isso é conveniência visual, não segurança.

## Dashboard

Responsável por apresentar sensores, status dos dispositivos, histórico e enviar comandos.

O dashboard possui duas áreas:

- área pública de monitoramento, acessível sem login;
- área de controle, visível e utilizável somente por admin autenticado.

Um visitante anônimo vê o estado atual de um atuador, mas não recebe nenhum controle capaz de alterá-lo.

Há um segundo front-end só de leitura: o painel 3D da Mostra, em `/maquete`. É um build estático
(`web/public/maquete/`, gerado no projeto do aluno) que consome `GET /api/devices/:deviceKey` como um
visitante: não ganha rota, segredo nem permissão nova. Ver README "Painel 3D da Mostra".

O dashboard não deve conhecer GPIOs. Ele trabalha com chaves semânticas:

```text
temperature
humidity
sound_detected
led_main
```

## API

A API é a fronteira entre dispositivos, usuários e banco.

Responsabilidades:

- autenticar ESP32;
- validar payloads;
- registrar telemetria;
- atualizar heartbeat;
- entregar comandos;
- confirmar execução;
- autenticar admin;
- distinguir rota pública de rota de controle;
- recusar comando sem sessão de admin;
- registrar o autor de cada comando;
- impedir acesso indevido.

Rotas podem ser implementadas inicialmente em Next.js Route Handlers.

## Banco

O Supabase armazena:

- dispositivos;
- sensores;
- atuadores;
- estado atual;
- histórico de telemetria;
- comandos;
- heartbeat.

Supabase Realtime pode ser usado pelo dashboard, desde que assine apenas
tabelas com leitura pública e nomeie as colunas: `sensors` e `actuators` negam
`select *` para a chave pública, porque `gpio` não é concedido. Ver DATABASE.md
"Consequência do grant de coluna".

## Firmware

Responsável por:

- conexão e reconexão Wi-Fi;
- leitura física dos sensores;
- acionamento físico de atuadores;
- envio de telemetria;
- busca de comandos;
- confirmação do estado real.

O firmware não deve hospedar o dashboard cloud.

## Fluxo de telemetria

```text
DHT11 / Som → ESP32 → POST /api/iot/sync → Supabase → Dashboard
```

## Fluxo de comando

```text
Admin autenticado → Dashboard → API → verificação de sessão
    → comando pendente → ESP32 → GPIO → ACK
```

Se a sessão não existir ou não pertencer a um admin, o fluxo termina na API e nenhum comando é criado.

## Escalabilidade

Um novo sensor não deve exigir uma nova tabela.

Exemplos:

```text
temperature
humidity
sound_detected
light_level
air_quality
soil_moisture
water_level
rain_detected
```

Atuadores:

```text
led_main
street_lights
irrigation_pump
alarm
fan
gate
```

## Novos atuadores

Um atuador novo herda o modelo de permissão existente: seu estado é público, seu acionamento é de admin.

Nenhum atuador deve ganhar uma rota própria de controle sem a mesma verificação de sessão.

## Online / Offline

Cada dispositivo possui `last_seen_at`.

Regra inicial:

```text
online = last_seen_at < 30 segundos
```

## Frequências iniciais

| Evento | Intervalo | Custa invocação |
|---|---:|:---:|
| ciclo do dispositivo, em repouso | 30 s | sim |
| ciclo do dispositivo, janela rápida | 1 s | sim |
| leitura do DHT11 | 5 s | não |
| leitura do sensor de som | cada volta do loop | não |
| atualização do dashboard | 5 s, pausado em aba oculta | sim |

## Orçamento de requisições

A conta que define o desenho. Um ESP32 roda sozinho, para sempre, e multiplica
qualquer descuido por 86.400 segundos por dia.

O desenho inicial tinha quatro rotas de dispositivo, cada uma no seu ritmo:

```text
comandos    1 s   →  86.400/dia
telemetria  5 s   →  17.280/dia
heartbeat  10 s   →   8.640/dia
ack              →  1 por comando
                     ─────────
                     112.320/dia  ≈  3,4 milhões/mês
```

Isso não cabe em plano gratuito. Três decisões resolveram:

1. **Uma rota só.** `POST /api/iot/sync` carrega leituras, estado, acks,
   comandos e estado desejado. Quatro requisições viraram uma.
2. **Ritmo decidido pelo servidor.** `nextPollMs` manda dormir 30 s em repouso
   e 1 s quando há trabalho em aberto. Mudar a política não exige regravar
   firmware.
3. **Economia no painel.** Aba oculta não atualiza, e a projeção pública tem
   `s-maxage=3`, então vários visitantes compartilham uma invocação.

```text
2.880/dia  ≈  86 mil/mês     redução de 97%
```

O custo é a latência do primeiro clique: até um ciclo de repouso. Depois dele a
janela rápida está aberta e os cliques seguintes são imediatos.

O painel 3D da Mostra (`/maquete`) lê a rota pública a cada 10 s, só com a aba visível:
360 leituras por hora por tela aberta, divididas pelo cache de 3 s da CDN quando há várias.
Um dia de evento de 8 horas com uma TV dá ~2.900, o mesmo que a placa gasta por dia.

## Reconciliação de estado

Comandos são consumidos uma vez. Isso basta para o caminho normal e falha em
dois casos: reboot do dispositivo e comando perdido na entrega.

```text
comando    caminho rápido      entregue no ciclo, confirmado no seguinte
sync       rede de segurança   estado real ⇄ estado desejado, todo ciclo
```

Cada ciclo envia o estado real e recebe o desejado. Divergência é aplicada pelo
firmware. Nenhum estado precisa sobreviver a um reboot do ESP32: a meta vive no
banco.

## Resiliência

O ESP32 deve tentar reconectar automaticamente, tolerar falhas temporárias da API, manter atuadores no último estado conhecido e evitar chamadas bloqueantes longas.

## Futuro: MQTT

MQTT pode ser adotado quando houver muitos ESP32s, mais atuadores, maior frequência de eventos ou necessidade de menor latência.
