# FIRMWARE.md

## Hardware atual

```text
GPIO 21 → Sensor de som digital
GPIO 22 → DHT11
GPIO 23 → LED
GPIO 25 → LED da rua (via 2N2222A, alimentado pela bateria)
GPIO 34 → LDR (entrada analógica)
```

## Responsabilidades

O firmware cloud deve separar:

```text
Wi-Fi
configuração
sensores
atuadores
API
heartbeat
comandos
```

Estrutura:

```text
firmware/esp32-city-01/
├── esp32-city-01.ino     apenas o agendador
├── config.example.h      template versionado
├── config.h              credenciais reais, fora do git
├── pins.h                pinagem e chaves lógicas
├── net.h / net.cpp       Wi-Fi com backoff, NTP
├── sensors.h / .cpp      DHT11 e som com debounce
├── actuators.h / .cpp    chave lógica -> GPIO
├── lighting.h / .cpp     LDR acende o LED da rua, sem nuvem
└── cloud.h / cloud.cpp   HTTP contra /api/iot
```

O `.ino` não tem lógica, só agendamento. A razão é prática: migrar para
PlatformIO depois é adicionar um `platformio.ini` e mover os arquivos para
`src/`, sem reescrever nada.

## Arduino IDE

Placa: **ESP32 Dev Module**. A pasta do sketch precisa ter o mesmo nome do
`.ino`, e o IDE compila junto todos os `.h` e `.cpp` que estiverem nela.

Antes de compilar, copie o template:

```text
config.example.h  ->  config.h
```

Sem o `config.h`, a compilação falha com uma mensagem explícita em vez de um
erro de arquivo não encontrado.

## Dependências

Do core do ESP32, já incluídas:

```text
WiFi
WiFiClientSecure
HTTPClient
```

Do Gerenciador de Bibliotecas:

```text
ArduinoJson              7.x  — obrigatório
DHT sensor library            — Adafruit
Adafruit Unified Sensor       — dependência da anterior
```

O ArduinoJson **7** é obrigatório: a 6 usava `StaticJsonDocument` e
`DynamicJsonDocument`, removidos na 7 em favor de `JsonDocument`. O firmware
tem um `#error` que falha com essa explicação em vez de despejar erros de
template.

O Arduino IDE instala bibliotecas globalmente e não registra versão nenhuma no
repositório. Essa é a única vantagem concreta do PlatformIO aqui, e o `#error`
é o que compensa a falta dela.

## Obtendo a credencial

O segredo é gerado pelo servidor e aparece uma única vez:

```bash
cd web
node --env-file=.env.local scripts/provision-device.mjs esp32-city-01
```

Ao rotacionar, use `--revoke-existing`. Sem essa flag a credencial antiga
continua válida, o que permite trocar o segredo sem derrubar o dispositivo.

O banco guarda apenas o hash. Um segredo perdido não é recuperável: gere outro.

## config.example.h

```cpp
#pragma once

#define WIFI_SSID "SEU_WIFI"
#define WIFI_PASSWORD "SUA_SENHA"

#define API_BASE_URL "https://SEU_DOMINIO.com/api/iot"

#define DEVICE_ID "esp32-city-01"
#define DEVICE_KEY "CHAVE_DO_DISPOSITIVO"
```

O `config.h` real deve estar no `.gitignore`.

## Pinagem

```cpp
constexpr uint8_t PIN_SOUND = 21;
constexpr uint8_t PIN_DHT = 22;
constexpr uint8_t PIN_LED = 23;
constexpr uint8_t PIN_LDR = 34;
constexpr uint8_t PIN_STREET_LIGHT = 25;
```

## Loop principal

Evitar `delay()` longo.

```cpp
void loop() {
  netLoop();       // reconexao com backoff, nao bloqueia
  sensorsPoll();   // debounce do som

  if (due(lastDhtMs, DHT_INTERVAL_MS)) sensorsReadDht();

  if (!cloudReady()) return;

  if (due(lastSyncMs, cloudNextPollMs())) cloudSync();
}
```

Usar `millis()`.

Um agendador so, e o intervalo de rede nao esta no firmware:
`cloudNextPollMs()` devolve o que o servidor mandou no ultimo ciclo. A politica
de consumo muda sem regravar dispositivo.

## Ciclo de rede

Uma requisicao por ciclo, `POST /api/iot/sync`, levando leituras, estado real
dos atuadores e as confirmacoes dos comandos do ciclo anterior.

```text
30 s   repouso
 1 s   comando em aberto, ou admin ativo no ultimo minuto
```

Quem decide e o servidor. O firmware apenas limita o valor entre 500 ms e
5 minutos, para que uma resposta absurda nao o deixe mudo nem o faca martelar.

As confirmacoes viajam no ciclo seguinte, em vez de numa requisicao propria.
Isso economiza uma invocacao por comando. Se o envio falhar, elas permanecem na
fila.

## DHT11

Intervalo inicial: 5 segundos.

Chaves:

```text
temperature
humidity
```

## Sensor de som

O módulo atual possui saída digital.

Chave:

```text
sound_detected
```

Não chamar esse valor de decibéis.

Implementacao:

- leitura local a cada volta do loop;
- debounce de 50 ms, porque o comparador oscila em volta do limiar;
- trava de evento: o que vai para a nuvem e "houve som desde a ultima
  publicacao", nao o estado instantaneo.

A trava existe por causa do ciclo de 30 s. Uma palma dura milissegundos;
publicar o instantaneo perderia quase todos os eventos. Durante uma
apresentacao o servidor abre a janela de 1 s, e ai trava e instantaneo sao
praticamente a mesma coisa.

A trava e limpa somente apos uma publicacao bem-sucedida.

## LED

Chave lógica:

```text
led_main
```

Mapeamento:

```text
led_main → GPIO 23
```

Após executar um comando, o dispositivo deve confirmar o estado real para a API.

## Iluminação automática

O LDR no GPIO 34 acende o LED da rua no GPIO 25 ao escurecer. A decisão é
local: não passa pelo painel, não custa requisição e funciona sem rede. Por
isso o LED da rua não tem chave lógica nem linha no banco.

O LDR também vai para o painel como `luminosity`, de 0 (escuro) a 100
(claro), dentro do ciclo de sync que já existe: nenhuma requisição a mais.
É a faixa do ADC, não lux. A linha em `sensors` precisa existir antes do
firmware publicar, ou a API rejeita o pacote inteiro (`SENSOR_UNKNOWN`).

O estado do LED da rua vai junto, como o sensor booleano `street_lights`
("Ligada"/"Desligada" no painel). É sensor e não atuador de propósito: quem
decide é o LDR, e o painel só mostra. Chega em até 30 s, no ciclo normal.

Circuito:

```text
3,3 V ── 10k ──┬── GPIO 34          escurecer BAIXA a leitura
               └── LDR ── GND

GPIO 25 ── 1k ── base 2N2222A       face chata de frente: E B C
                 emissor  → GND
                 coletor  → LED (−)
bateria 3,7 V (+) ── resistor ── LED (+)
GND da bateria ligado ao GND do ESP32
```

O LED precisa de resistor em série. Sem ele, com a bateria de 3,7 V, o
primeiro LED queimou no teste de 2026-10-15. Vermelho/amarelo/verde: 68 a
100 Ω. Branco/azul: 10 a 22 Ω.

Calibração medida na maquete: luz da sala ~2450, LDR tapado 600 a 850 (ADC
de 0 a 4095). Acende com a leitura abaixo de ~1200 e apaga acima de ~1600; a
folga entre os dois evita piscar no crepúsculo. Uma média móvel faz a troca
levar 2 a 3 s, para uma sombra passando não acender a luz. Os valores ficam
em `lighting.cpp`; se a maquete mudar de ambiente, meça de novo pelo log
`[ldr]` no Serial.

## Wi-Fi

Implementar reconexão automática sem travar o sistema em um `while` infinito após a inicialização.

Uma tentativa de associação tem 15 segundos para terminar. Esse prazo não é
arbitrário: associar leva de 2 a 8 segundos, e a primeira versao do firmware
reiniciava a conexao a cada 1 segundo. Como `WiFi.begin()` aborta a tentativa
anterior, o dispositivo nunca chegava a conectar — o stack respondia
`sta is connecting, cannot set config`.

Depois do prazo, backoff de 5 s dobrando até 60 s.

### Diagnóstico na falha

O status do stack nao distingue SSID inexistente de senha errada: nos dois
casos costuma reportar apenas `desconectado`. Por isso, na primeira falha de
uma sequencia o firmware varre as redes e diz qual e o caso:

```text
[wifi] guarumidia esta ao alcance (rssi -94 dBm, canal 12). Se nao conecta, suspeite da senha.
[wifi] NOME NAO esta ao alcance. Redes visiveis (3):
```

A varredura exige parar a tentativa em curso antes. Com `setAutoReconnect`
ligado o radio fica ocupado associando e a varredura volta vazia, reportando
"nenhuma rede" numa sala cheia delas.

Ela bloqueia por 2 a 3 segundos, e so no caminho de falha.

## HTTP

Usar timeout e verificar status code.

```cpp
http.setTimeout(5000);
```

Tratar 2xx, 401, 403, 404, 429, 5xx e timeout.

## TLS

`API_BASE_URL` usa HTTPS (AGENTS.md, princípio 7). O `config.example.h` obriga
uma escolha consciente:

```text
API_INSECURE_TLS 1   criptografa, NÃO autentica o servidor
API_INSECURE_TLS 0   valida o certificado contra API_ROOT_CA
```

Com `1`, o ESP32 aceita qualquer certificado. Alguém na mesma rede consegue se
passar pelo domínio e capturar o `DEVICE_KEY`, que viaja em header. Serve para
o primeiro teste em rede doméstica controlada, não para uso real.

Com `0`, é preciso o certificado raiz da autoridade do domínio **e** relógio
sincronizado, porque validar certificado é comparar datas. O firmware cuida do
NTP e só fala com a API depois que o relógio responde — sem isso, o ESP32
acordaria em 1970 e todo certificado pareceria expirado.

O esquema da URL decide o transporte: `http` usa cliente comum, `https` usa
cliente TLS. Não misture. Um cliente TLS contra servidor em texto claro falha
com `connection refused`, que parece erro de rede e é de protocolo.

### Qual raiz fixar

Verificado em 2026-10-09 contra `projeto-smart-canada.vercel.app`: quem assina
`*.vercel.app` é o **Google Trust Services**, raiz **GTS Root R1**, não
Let's Encrypt.

```text
CN=*.vercel.app
  <- Google Trust Services, CN=WR1
      <- GTS Root R1
```

A GTS Root R1 autoassinada vale até junho de 2036 e já está no
`config.example.h`. A versão cross-signed que o servidor envia na cadeia expira
em janeiro de 2028 — prefira a autoassinada, conferindo que a chave pública
coincide com a da cadeia.

Com domínio próprio a autoridade pode ser outra. Para descobrir:

```bash
openssl s_client -showcerts -connect SEU_DOMINIO:443 -servername SEU_DOMINIO
```

Fixar a raiz errada derruba toda a comunicação.

## Keep-alive

Um handshake TLS no ESP32 custa 1 a 2 segundos. Na janela rapida de 1 segundo,
abrir conexao nova a cada ciclo nao fecha a conta.

O cliente HTTP e unico e reaproveitado, com `setReuse(true)`.

## Reconciliação de estado

Comandos são consumidos uma vez. Depois de um reboot, o ESP32 sobe com os
atuadores desligados e não tem como saber o que o painel pediu.

O ciclo de sync resolve: envia o estado real e recebe o desejado. O que
divergir e aplicado.

```text
comando    caminho rapido     pedido explicito, vence em caso de conflito
sync       rede de seguranca  estado real x desejado, todo ciclo
```

Ao conectar, o firmware sincroniza antes de qualquer outra coisa. Nenhum estado
precisa sobreviver a um reboot: a meta vive no banco.

## Segurança

A credencial do dispositivo deve:

- identificar somente aquele ESP32;
- ser revogável;
- não oferecer acesso administrativo;
- não servir como login de admin do dashboard;
- nunca ser a `service_role` do Supabase.

## Autorização

O firmware não decide quem pode comandá-lo. Ele executa o que a API entregar.

A autorização do admin acontece antes, na API, no momento em que o comando é criado.

```text
Admin autenticado → API valida sessão → comando pendente → ESP32 executa
```

O ESP32 não deve aceitar comando de nenhuma outra origem, e a interface local de diagnóstico não deve ficar acessível pela internet.

## Estado offline

Se a nuvem ficar indisponível:

- sensores continuam sendo lidos;
- atuadores permanecem no último estado;
- firmware continua tentando reconectar;
- não reiniciar em loop;
- telemetria perdida pode ser descartada inicialmente.

## Migração do firmware atual

1. Manter sensores e LED funcionando.
2. Adicionar o cliente HTTP e fazer um ciclo de sync vazio subir.
3. Incluir as leituras no ciclo.
4. Aplicar comandos e confirmar no ciclo seguinte.
5. Remover dependencia do dashboard HTML hospedado no ESP32.

A interface local pode ser mantida apenas como diagnóstico.
