/**
 * URLs cortas. Cada entidad con página de detalle expone un `short_id` = los
 * primeros 8 caracteres de su UUID (columna generada en la DB, migración 127).
 * Los enlaces usan el short id; los loaders lo resuelven, y siguen aceptando el
 * UUID completo (enlaces viejos no se rompen).
 *
 * Colisión: 8 hex = 32 bits; como la consulta va acotada al workspace por RLS,
 * dos filas del mismo comercio con el mismo prefijo es prácticamente imposible.
 */

/** Id corto para poner en una URL. */
export function toShortId(id: string): string {
  return (id ?? '').slice(0, 8);
}

/**
 * Columna por la que resolver un parámetro de URL: si mide 8 es un short id,
 * si no (UUID completo, 36) es el id. Úsalo con `.eq(idColumn(param), param)`.
 */
export function idColumn(param: string): 'id' | 'short_id' {
  return (param ?? '').length === 8 ? 'short_id' : 'id';
}
