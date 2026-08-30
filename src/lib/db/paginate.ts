import type { SupabaseClient } from '@supabase/supabase-js'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('db.paginate')

/** PostgREST devuelve como mucho esto por consulta, sin avisar. */
export const TOPE_POSTGREST = 1000

/** Cuántas páginas se traen como mucho. 50 × 1000 = 50 000 filas. */
const MAX_PAGINAS = 50

/**
 * Todas las filas que matchea una consulta, sin el corte silencioso.
 *
 * PostgREST trunca en 1000 filas y no lo dice en ningún lado: la respuesta es
 * un array de 1000 elementos, indistinguible de "hay exactamente 1000". Por eso
 * el modo de falla es tan malo — el enrutador del webhook, por ejemplo, dejaba
 * de encontrar la conexión número 1001 y su entrega quedaba registrada como
 * "no coincide ninguna cuenta", que se lee como un `page_id` mal configurado y
 * no como lo que era.
 *
 * Se ordena por `id` para que dos páginas no se pisen ni se salteen si alguien
 * inserta mientras tanto. Al llegar al tope se avisa fuerte en vez de cortar
 * callado: truncar en silencio es exactamente el problema que esto resuelve.
 */
/**
 * El constructor de filtros de PostgREST. Sus tipos dependen del esquema
 * generado y acá la tabla llega como string, así que se describe por lo único
 * que este módulo usa: encadenar filtros, ordenar y pedir un rango.
 */
interface Filtrable {
  eq(col: string, val: unknown): Filtrable
  in(col: string, vals: readonly unknown[]): Filtrable
  order(col: string, opts: { ascending: boolean }): Filtrable
  range(desde: number, hasta: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
}

export async function selectAll<T>(
  db: SupabaseClient,
  table: string,
  build: (q: Filtrable) => Filtrable,
  opts?: { select?: string; pageSize?: number; orderBy?: string; maxPages?: number },
): Promise<T[]> {
  const pageSize = Math.min(opts?.pageSize ?? TOPE_POSTGREST, TOPE_POSTGREST)
  const orderBy = opts?.orderBy ?? 'id'
  const maxPaginas = opts?.maxPages ?? MAX_PAGINAS
  const out: T[] = []

  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    const desde = pagina * pageSize
    const base = db.from(table).select(opts?.select ?? '*') as unknown as Filtrable
    const { data, error } = await build(base)
      .order(orderBy, { ascending: true })
      .range(desde, desde + pageSize - 1)
    if (error) {
      log.warn('lectura paginada falló', { table, pagina, error: error.message })
      break
    }
    const filas = (data ?? []) as T[]
    out.push(...filas)
    if (filas.length < pageSize) return out
  }

  log.warn(
    'lectura paginada llegó al tope de páginas: puede haber filas sin leer',
    { table, leidas: out.length, maxPaginas },
  )
  return out
}
