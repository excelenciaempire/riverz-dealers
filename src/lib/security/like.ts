/**
 * Escapa los metacaracteres de LIKE/ILIKE de PostgREST (`%`, `_`, `\`) para
 * que el término de búsqueda provisto por el usuario se trate como literal y
 * no como comodín. No es SQL injection (supabase-js liga el valor en
 * `.ilike(col, pattern)`), pero sin escapar, un `%` o `_` del usuario actúa
 * como comodín (p.ej. `%` matchea todo). Coherente con el saneo de contactos.
 *
 * Uso: `q.ilike('col', `%${escapeLike(term)}%`)`.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
