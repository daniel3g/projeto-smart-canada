/**
 * Relações 1:1 do PostgREST chegam como objeto ou como array de um item,
 * dependendo de como a inferência resolve a chave. Normalizar num só lugar
 * evita espalhar essa dúvida pelo código.
 *
 * Verificado contra o banco real: `sensor_state` e `actuator_state` chegam
 * como objeto. O tratamento de array fica como defesa.
 */
export function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}
