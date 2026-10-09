import { z } from "zod";

/**
 * Schemas de payload. API.md "Regras": validar payloads.
 * Limites de tamanho são propositais: o firmware envia pacotes pequenos.
 */

const readingValue = z.union([
  z.number().finite(),
  z.boolean(),
  z.string().max(255),
]);

/**
 * Payload único do ciclo do dispositivo.
 *
 * Tudo que o ESP32 tem a dizer cabe aqui: leituras, estado real dos atuadores
 * e confirmação dos comandos que executou. Três requisições viraram uma para
 * caber no plano gratuito da Vercel sem sustos — ver ARCHITECTURE.md
 * "Orçamento de requisições".
 */
export const syncSchema = z.object({
  firmwareVersion: z.string().max(32).optional(),
  wifiRssi: z.number().int().min(-120).max(0).optional(),
  uptimeSeconds: z.number().int().nonnegative().optional(),

  readings: z
    .array(
      z.object({
        key: z.string().min(1).max(64),
        value: readingValue,
        unit: z.string().max(32).optional(),
      }),
    )
    .max(50)
    .optional(),

  /** Estado real dos atuadores, por chave. Mantém `reported` correto. */
  actuators: z.record(z.string().max(64), z.boolean()).optional(),

  /** Confirmação dos comandos recebidos no ciclo anterior. */
  acks: z
    .array(
      z.discriminatedUnion("status", [
        z.object({
          id: z.uuid(),
          status: z.literal("executed"),
          reportedState: z.boolean().optional(),
        }),
        z.object({
          id: z.uuid(),
          status: z.literal("failed"),
          error: z.string().max(255).optional(),
        }),
      ]),
    )
    .max(20)
    .optional(),
});

export type SyncInput = z.output<typeof syncSchema>;

/** Dashboard envia apenas o valor desejado. Nunca GPIO. */
export const actuatorCommandSchema = z.object({
  value: z.boolean(),
});

export const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});
