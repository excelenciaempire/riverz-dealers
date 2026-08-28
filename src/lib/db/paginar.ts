/**
 * Traer TODAS las filas de una consulta, no las primeras mil.
 *
 * PostgREST corta en 1000 filas y NO avisa: `.limit(5000)` devuelve 1000 y el
 * código sigue como si eso fuera todo. Medido en este proyecto el 2026-08-28:
 * un workspace tenía 1893 conversaciones con contacto y la lectura devolvía
 * exactamente 1000, sin error. Lo que quedaba afuera eran justo las más
 * nuevas, o sea las de la gente que compró esta semana.
 *
 * Es peor que fallar. Un tope no se nota en una cuenta chica, y en una grande
 * hace que el panel muestre un número seguro y equivocado: un comercio con más
 * movimiento ve menos que uno con menos, y nadie se entera.
 *
 * El llamador TIENE que ordenar por una columna estable (`id`, `created_at`)
 * o dos tramos pueden traer la misma fila y saltearse otra. El `tope` existe
 * sólo para que un filtro mal escrito no barra una tabla entera.
 *
 * @example
 * const filas = await traerTodo<{ id: string }>((desde, hasta) =>
 *   db.from('messages').select('id')
 *     .eq('workspace_id', ws)
 *     .order('id', { ascending: true })
 *     .range(desde, hasta),
 * )
 */
export async function traerTodo<T>(
  consulta: (
    desde: number,
    hasta: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
  tope = 100_000,
): Promise<T[]> {
  const TRAMO = 1000
  const filas: T[] = []
  for (let desde = 0; desde < tope; desde += TRAMO) {
    const { data, error } = await consulta(desde, desde + TRAMO - 1)
    if (error) {
      console.error('[paginar] no se pudo traer un tramo:', error)
      break
    }
    const lote = data ?? []
    filas.push(...lote)
    if (lote.length < TRAMO) break
  }
  return filas
}
