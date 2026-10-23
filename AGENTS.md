# AGENTS.md — ESP32 IoT Cloud Dashboard

## Objetivo

Transformar o protótipo local baseado em ESP32 em uma plataforma IoT acessível por domínio público, mantendo uma arquitetura simples no início e preparada para crescer com novos sensores, atuadores e múltiplos dispositivos.

Hardware atual:

- ESP32
- LED no GPIO 23
- DHT11 no GPIO 22
- Sensor de som digital no GPIO 21
- LDR no GPIO 34 acendendo o LED da rua no GPIO 25 (local, sem nuvem)
- Interface web local já validada

A evolução deve mover a interface para a nuvem e deixar o ESP32 responsável por leitura de sensores, acionamento de atuadores, envio de telemetria, recebimento de comandos e heartbeat.

## Arquitetura alvo

```text
Navegador / Celular
        │ HTTPS
        ▼
Next.js + Vercel
Dashboard + API
        │
        ▼
Supabase PostgreSQL / Realtime
        ▲
        │ HTTPS
        │
      ESP32
sensores + atuadores
```

O ESP32 NÃO deve ficar exposto diretamente à internet por port forwarding.

## Modelo de permissões

Regra de negócio central da plataforma:

```text
Ver dados      → público, sem login
Controlar algo → exclusivo de admin autenticado
```

A cidade é uma vitrine pública de monitoramento e um painel privado de controle, na mesma aplicação.

### Leitura pública

Qualquer visitante, sem login, pode ver:

- lista de dispositivos;
- status online/offline;
- última comunicação;
- valor atual de qualquer sensor;
- histórico e gráficos;
- nome e estado atual dos atuadores.

Ver o estado de um atuador é leitura. Mudar esse estado não é.

### Controle restrito a admin

Somente um admin autenticado por e-mail e senha pode:

- acender/apagar LEDs e iluminação;
- ligar/desligar irrigação;
- acionar ou silenciar alarmes;
- acionar qualquer atuador presente ou futuro;
- cadastrar, editar ou desabilitar dispositivos;
- cadastrar sensores e atuadores;
- emitir ou cancelar comandos;
- revogar credencial de dispositivo.

### Sem níveis de acesso

Decisão tomada: **não existem níveis, papéis ou hierarquia de usuário.**

```text
Visitante → lê
Admin     → lê e controla tudo
```

Admin é binário. Quem é admin pode acionar qualquer atuador e cadastrar qualquer dispositivo. Não há admin parcial, operador, editor nem permissão por dispositivo.

Consequências para quem implementa:

- `admin_users` não tem coluna `role` e não deve ganhar uma;
- não criar tabela de papéis, permissões ou grupos;
- não condicionar um controle a nada além de "é admin";
- a verificação em toda rota de controle é a mesma: há sessão e ela é de um admin ativo.

Não introduzir níveis de acesso sem solicitação explícita.

### Três identidades distintas

| Identidade | Autenticação | Pode ler | Pode escrever |
|---|---|---|---|
| Visitante | nenhuma | dados públicos | nada |
| Admin | Supabase Auth (e-mail + senha) | tudo | comandos e cadastro |
| Dispositivo | `X-Device-Id` + `X-Device-Key` | apenas os próprios comandos | apenas o próprio ciclo de sync |

Essas identidades nunca se misturam. Credencial de dispositivo não concede poderes de admin, e sessão de admin não substitui credencial de dispositivo.

### Decisões

- Autenticação de admin usa Supabase Auth com e-mail e senha.
- Não existe cadastro público. Admins são criados manualmente e podem ser revogados.
- Toda escrita passa pela API, nunca direto do navegador para o banco.
- Todo comando registra qual admin o emitiu.
- A ausência de sessão válida resulta em `401`; sessão válida sem permissão de admin resulta em `403`.
- Negar por padrão: uma rota nova é restrita até ser explicitamente classificada como pública.

## Princípios obrigatórios

1. Não expor `service_role` do Supabase no navegador ou no firmware.
2. Nunca versionar segredos reais.
3. Usar variáveis de ambiente para credenciais web.
4. Cada ESP32 deve ter um `device_id` único.
5. Cada ESP32 deve possuir credencial própria e revogável.
6. A API deve validar a identidade do dispositivo.
7. Toda comunicação externa deve usar HTTPS.
8. O dashboard deve ser desacoplado do firmware.
9. Novos sensores devem ser adicionados sem reestruturação global.
10. Novos atuadores devem seguir um modelo genérico de comandos.
11. Manter tipagem estrita no frontend/backend.
12. Não alterar pinagem atual sem documentar.
13. Firmware deve continuar funcional quando a nuvem estiver temporariamente indisponível.
14. Evitar `delay()` longos no firmware; usar `millis()`.
15. Toda mudança estrutural deve atualizar a documentação.
16. Leitura de dados é pública; qualquer escrita exige admin autenticado.
17. Nenhuma rota de controle pode existir sem verificação de sessão de admin.
18. Não expor rota de cadastro público de usuário.
19. Nunca confiar em verificação de permissão feita apenas no cliente.
20. Leitura pública nunca deve retornar segredo de dispositivo, hash de credencial ou GPIO.
21. Todo comando deve ser rastreável até o admin que o emitiu.
22. Não criar níveis, papéis ou permissões parciais de usuário.

## Stack alvo

### Web
- Next.js
- TypeScript
- App Router
- Vercel

### Banco
- Supabase PostgreSQL
- Supabase Realtime quando útil

### Firmware
- ESP32 / Arduino Framework
- `WiFi.h`
- `HTTPClient.h`
- `ArduinoJson`
- `DHT.h`

## Hardware atual

| Componente | GPIO | Tipo |
|---|---:|---|
| LED | 23 | saída digital |
| DHT11 | 22 | sensor digital |
| Sensor de som | 21 | entrada digital |
| LDR | 34 | entrada analógica |
| LED da rua (2N2222A) | 25 | saída digital |

O sensor de som atual é binário. Ele indica apenas se o limiar ajustado no potenciômetro foi ultrapassado; não mede decibéis.

## Convenções

### Dispositivos

```text
esp32-city-01
esp32-city-02
esp32-residential-01
```

### Sensores

Usar chaves estáveis em inglês no código e banco:

```text
temperature
humidity
sound_detected
light_level
air_quality
soil_moisture
water_level
```

### Atuadores

```text
led_main
street_lights
residential_lights
irrigation_pump
alarm
fan
```

A interface pode exibir nomes em português, mas banco/API usam as chaves estáveis acima.

## Estrutura

```text
/
├── AGENTS.md            regras do projeto
├── README.md
├── ARCHITECTURE.md
├── API.md
├── DATABASE.md
├── FIRMWARE.md
├── .env.example
│
├── supabase/
│   ├── config.toml                      CLI do Supabase
│   └── migrations/
│       ├── 20261009090000_schema.sql    tabelas, is_admin(), triggers
│       ├── 20261009090100_rls.sql       leitura pública, escrita só pela API
│       └── 20261009090200_seed.sql      maquete inicial, idempotente
│
├── web/
│   ├── app/
│   │   ├── page.tsx                 monitoramento público
│   │   ├── login/                   acesso do admin
│   │   └── api/
│   │       ├── iot/sync/            nível device, rota única
│   │       ├── devices/             nível public
│   │       ├── admin/               nível admin
│   │       └── auth/                sessão
│   ├── components/
│   ├── public/maquete/  painel 3D da Mostra (build estático do projeto do aluno, só leitura)
│   ├── lib/
│   │   ├── api/        envelope de erro, validação, limite de tentativas
│   │   ├── auth/       requireAdmin
│   │   ├── devices/    autenticação, segredo e ciclo de sync
│   │   ├── data/       projeções de leitura
│   │   ├── supabase/   clientes service_role e de sessão
│   │   └── validation/
│   ├── types/
│   └── scripts/
│       ├── check-setup.mjs         schema, seed e permissões
│       ├── promote-admin.mjs       cria/concede/revoga admin
│       ├── provision-device.mjs    gera credencial do ESP32
│       ├── selftest-device-api.mjs ciclo de sync de ponta a ponta
│       └── simulate-device.mjs     ESP32 falso, para testar sem hardware
│
└── firmware/
    └── esp32-city-01/
        ├── esp32-city-01.ino     apenas o agendador
        ├── config.example.h      template versionado
        ├── pins.h                pinagem e chaves lógicas
        ├── net.*                 Wi-Fi com backoff, NTP
        ├── sensors.*             DHT11 e som com debounce
        ├── actuators.*           chave lógica -> GPIO
        └── cloud.*               HTTP contra /api/iot
```

O diretório `web/AGENTS.md` é gerado pelo Next e trata só do framework. As
regras do projeto são as deste arquivo.

## Modelo de telemetria

```json
{
  "deviceId": "esp32-city-01",
  "readings": [
    { "key": "temperature", "value": 26.4, "unit": "celsius" },
    { "key": "humidity", "value": 58, "unit": "percent" },
    { "key": "sound_detected", "value": true, "unit": "boolean" }
  ]
}
```

## Modelo de comando

```json
{
  "actuator": "led_main",
  "type": "set_boolean",
  "value": true
}
```

Fluxo:

```text
Dashboard → API → banco/comando desejado → ESP32 → GPIO → confirmação
```

## Estratégia inicial

Na primeira versão cloud, usar HTTP polling, com uma rota só para o
dispositivo: `POST /api/iot/sync`.

- ciclo do dispositivo: 30 s em repouso, 1 s com comando em aberto;
- o ritmo vem do servidor, no campo `nextPollMs`;
- DHT11: leitura local a cada 5 s, sem custo de requisição;
- sensor de som: leitura local a cada volta do loop, com trava de evento;
- dashboard: 5 s, pausado quando a aba está oculta.

Evitar chamadas ao banco/API a cada ciclo do `loop()`.

### Orçamento de requisições

Um ESP32 roda sozinho, para sempre. Quatro rotas separadas somavam 3,4 milhões
de invocações por mês e não cabiam em plano gratuito; o ciclo único em repouso
de 30 s custa cerca de 86 mil.

Antes de criar uma rota nova de dispositivo, calcule o custo por dia.
Ver ARCHITECTURE.md, seção de orçamento.

## Evolução futura

A arquitetura deve permitir migração para MQTT sem alterar os conceitos de dispositivo, sensor, telemetria, atuador e comando.

Não implementar MQTT agora, salvo solicitação explícita.

## Regras para agentes de IA

Ao modificar código:

1. Leia `AGENTS.md`, `ARCHITECTURE.md`, `DATABASE.md`, `API.md` e `FIRMWARE.md`.
2. Explique mudanças estruturais antes de aplicá-las.
3. Não invente credenciais.
4. Não coloque chaves reais em exemplos.
5. Gere migrations quando alterar schema.
6. Preserve compatibilidade com a pinagem atual.
7. Prefira módulos pequenos e reutilizáveis.
8. Não exponha segredo de dispositivo no frontend.
9. Considere reconexão Wi-Fi e falha de API.
10. Novos sensores devem ser módulos independentes.
11. Novos atuadores devem usar uma interface comum.
12. Não colocar lógica de negócio crítica diretamente em componentes React.
13. Classifique toda rota nova como pública ou de admin antes de implementá-la.
14. Ao criar um atuador, implemente a verificação de admin junto; não deixe para depois.
15. Não esconda um controle apenas na interface. Esconder botão não é autorização.
16. Não use `service_role` para atender requisição sem antes validar a sessão do admin.

## Critério de conclusão da primeira etapa

- dashboard publicado em domínio público;
- ESP32 pode estar em qualquer Wi-Fi com internet;
- temperatura e umidade visíveis;
- estado do sensor de som visível;
- LED controlável remotamente;
- dashboard mostra online/offline;
- última comunicação visível;
- nenhuma porta do roteador aberta;
- nenhum segredo sensível exposto no frontend;
- monitoramento visível sem login;
- controle do LED indisponível para visitante anônimo;
- login de admin funcional em produção;
- tentativa de comando sem sessão rejeitada com `401`;
- comando registrado com o admin autor.
