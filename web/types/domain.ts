/**
 * Tipos de domínio compartilhados entre API e dashboard.
 *
 * As chaves de sensor e atuador são estáveis e em inglês, conforme
 * AGENTS.md "Convenções". A interface traduz na exibição.
 */

export type SensorValue = number | boolean | string | null;

export type SensorReadout = {
  key: string;
  name: string;
  type: string;
  unit: string | null;
  value: SensorValue;
  recordedAt: string | null;
};

export type ActuatorReadout = {
  key: string;
  name: string;
  type: string;
  /** O que o painel pediu. */
  desired: boolean | null;
  /** O que o dispositivo confirmou de fato. */
  reported: boolean | null;
  desiredUpdatedAt: string | null;
  reportedUpdatedAt: string | null;
};

/**
 * Projeção pública de um dispositivo. Nenhum campo aqui é secreto:
 * sem GPIO, sem hash de credencial. Ver AGENTS.md, princípio 20.
 */
export type DeviceSnapshot = {
  deviceKey: string;
  name: string;
  description: string | null;
  /** Dispositivo desabilitado aparece no painel, marcado, em vez de sumir. */
  enabled: boolean;
  online: boolean;
  lastSeenAt: string | null;
  firmwareVersion: string | null;
  serverTime: string;
  sensors: Record<string, SensorReadout>;
  actuators: Record<string, ActuatorReadout>;
};

export type HistoryPoint = {
  recordedAt: string;
  value: SensorValue;
};

export type SensorHistory = {
  deviceKey: string;
  sensorKey: string;
  unit: string | null;
  points: HistoryPoint[];
};

export type SessionInfo = {
  authenticated: boolean;
  isAdmin: boolean;
  email?: string;
};
