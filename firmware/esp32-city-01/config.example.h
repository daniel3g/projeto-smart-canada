#pragma once

// Copie este arquivo para config.h e preencha.
// config.h está no .gitignore e nunca deve ser versionado.

// ---------------------------------------------------------------------- Wi-Fi

#define WIFI_SSID "SEU_WIFI"
#define WIFI_PASSWORD "SUA_SENHA"

// ------------------------------------------------------------------------ API

// Sem barra no final. Precisa apontar para o prefixo /api/iot.
//
//   bancada   http://192.168.0.10:3000/api/iot      (IP da sua maquina)
//   producao  https://SEU_DOMINIO/api/iot
//
// O firmware escolhe o transporte pelo esquema: http usa cliente comum, https
// usa cliente TLS. Não misture — TLS contra servidor em texto claro falha com
// "connection refused", que parece erro de rede e é de protocolo.
#define API_BASE_URL "https://SEU_DOMINIO/api/iot"

// ---------------------------------------------------------------- Dispositivo

// device_key cadastrado em devices.
#define DEVICE_ID "esp32-city-01"

// Segredo gerado por: npm run provision:device -- esp32-city-01
// O banco guarda apenas o hash. Um segredo perdido não é recuperável.
#define DEVICE_KEY "CHAVE_DO_DISPOSITIVO"

// ------------------------------------------------------------------------ TLS
//
// Só tem efeito quando API_BASE_URL usa https. Escolha deliberada:
//
// 1 → conexão criptografada, mas SEM autenticar o servidor.
//     O ESP32 aceita qualquer certificado. Alguém na mesma rede consegue se
//     passar pelo seu domínio e capturar o DEVICE_KEY acima.
//
// 0 → valida o certificado do servidor contra API_ROOT_CA.
//     É o modo correto. Exige a raiz certa e relógio sincronizado por NTP, que
//     o firmware já trata, porque validar certificado é comparar datas.

#define API_INSECURE_TLS 0

// Certificado raiz, usado quando API_INSECURE_TLS é 0.
//
// A raiz abaixo é a GTS Root R1, do Google Trust Services, que é quem assina
// os certificados de *.vercel.app — verificado em 2026-10-09 contra
// projeto-smart-canada.vercel.app. Autoassinada, válida até junho de 2036.
//
// Atenção: isto depende do SEU domínio. Com domínio próprio, a autoridade pode
// ser outra, e fixar a raiz errada derruba toda a comunicação. Para confirmar:
//
//   openssl s_client -showcerts -connect SEU_DOMINIO:443 -servername SEU_DOMINIO
//
// O último "i:" da cadeia é a raiz que você precisa.
//
// Se a comunicação quebrar de repente com certificado, suspeite de troca de
// autoridade: API_INSECURE_TLS=1 serve de contorno temporário até você fixar a
// raiz nova.

#define API_ROOT_CA R"CERT(
-----BEGIN CERTIFICATE-----
MIIFVzCCAz+gAwIBAgINAgPlk28xsBNJiGuiFzANBgkqhkiG9w0BAQwFADBHMQsw
CQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEU
MBIGA1UEAxMLR1RTIFJvb3QgUjEwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAw
MDAwWjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZp
Y2VzIExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjEwggIiMA0GCSqGSIb3DQEBAQUA
A4ICDwAwggIKAoICAQC2EQKLHuOhd5s73L+UPreVp0A8of2C+X0yBoJx9vaMf/vo
27xqLpeXo4xL+Sv2sfnOhB2x+cWX3u+58qPpvBKJXqeqUqv4IyfLpLGcY9vXmX7w
Cl7raKb0xlpHDU0QM+NOsROjyBhsS+z8CZDfnWQpJSMHobTSPS5g4M/SCYe7zUjw
TcLCeoiKu7rPWRnWr4+wB7CeMfGCwcDfLqZtbBkOtdh+JhpFAz2weaSUKK0Pfybl
qAj+lug8aJRT7oM6iCsVlgmy4HqMLnXWnOunVmSPlk9orj2XwoSPwLxAwAtcvfaH
szVsrBhQf4TgTM2S0yDpM7xSma8ytSmzJSq0SPly4cpk9+aCEI3oncKKiPo4Zor8
Y/kB+Xj9e1x3+naH+uzfsQ55lVe0vSbv1gHR6xYKu44LtcXFilWr06zqkUspzBmk
MiVOKvFlRNACzqrOSbTqn3yDsEB750Orp2yjj32JgfpMpf/VjsPOS+C12LOORc92
wO1AK/1TD7Cn1TsNsYqiA94xrcx36m97PtbfkSIS5r762DL8EGMUUXLeXdYWk70p
aDPvOmbsB4om3xPXV2V4J95eSRQAogB/mqghtqmxlbCluQ0WEdrHbEg8QOB+DVrN
VjzRlwW5y0vtOUucxD/SVRNuJLDWcfr0wbrM7Rv1/oFB2ACYPTrIrnqYNxgFlQID
AQABo0IwQDAOBgNVHQ8BAf8EBAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4E
FgQU5K8rJnEaK0gnhS9SZizv8IkTcT4wDQYJKoZIhvcNAQEMBQADggIBAJ+qQibb
C5u+/x6Wki4+omVKapi6Ist9wTrYggoGxval3sBOh2Z5ofmmWJyq+bXmYOfg6LEe
QkEzCzc9zolwFcq1JKjPa7XSQCGYzyI0zzvFIoTgxQ6KfF2I5DUkzps+GlQebtuy
h6f88/qBVRRiClmpIgUxPoLW7ttXNLwzldMXG+gnoot7TiYaelpkttGsN/H9oPM4
7HLwEXWdyzRSjeZ2axfG34arJ45JK3VmgRAhpuo+9K4l/3wV3s6MJT/KYnAK9y8J
ZgfIPxz88NtFMN9iiMG1D53Dn0reWVlHxYciNuaCp+0KueIHoI17eko8cdLiA6Ef
MgfdG+RCzgwARWGAtQsgWSl4vflVy2PFPEz0tv/bal8xa5meLMFrUKTX5hgUvYU/
Z6tGn6D/Qqc6f1zLXbBwHSs09dR2CQzreExZBfMzQsNhFRAbd03OIozUhfJFfbdT
6u9AWpQKXCBfTkBdYiJ23//OYb2MI3jSNwLgjt7RETeJ9r/tSQdirpLsQBqvFAnZ
0E6yove+7u7Y/9waLd64NnHi/Hm3lCXRSHNboTXns5lndcEZOitHTtNCjv0xyBZm
2tIMPNuzjsmhDYAPexZ3FL//2wmUspO8IFgV6dtxQ/PeEMMA3KgqlbbC1j+Qa3bb
bP6MvPJwNQzcmRk13NfIRmPVNnGuV/u3gm3c
-----END CERTIFICATE-----
)CERT"

// ----------------------------------------------------------------- Diagnóstico

// 1 imprime cada requisição e resposta no Serial. Desligue em produção: o log
// mostra o corpo das respostas, embora nunca o DEVICE_KEY.
#define DEBUG_HTTP 1
