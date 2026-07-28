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

/**
 * Resuelve un parámetro de URL (short id o UUID) al UUID COMPLETO. Para rutas
 * de API donde el id se reusa en varias consultas/sub-recursos (steps, etc.):
 * resolvés una vez arriba y el resto usa el id completo. Si no encuentra fila,
 * devuelve el parámetro tal cual (la consulta siguiente dará 404).
 *
 * `db` es un SupabaseClient (import type — se borra en build, no rompe el uso
 * client-side de este archivo).
 */
export async function resolveShortId(
  db: import('@supabase/supabase-js').SupabaseClient,
  table: string,
  rawId: string,
): Promise<string> {
  if (!rawId || rawId.length !== 8) return rawId;
  const { data } = await db
    .from(table)
    .select('id')
    .eq('short_id', rawId)
    .maybeSingle();
  return (data as { id?: string } | null)?.id ?? rawId;
}
