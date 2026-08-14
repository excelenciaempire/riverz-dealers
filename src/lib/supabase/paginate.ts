/**
 * Traer TODAS las filas de una consulta, saltando el tope duro de PostgREST.
 *
 * PostgREST corta cada respuesta en 1.000 filas y no avisa: la consulta
 * devuelve `data` con 1.000 elementos y `error: null`. Cualquier lista más
 * larga —los contactos de una etiqueta, los destinatarios de una campaña, los
 * vínculos contacto↔etiqueta— se recorta en silencio, que es la peor forma de
 * perder datos: nada falla, simplemente falta gente.
 *
 * Se pagina con `.range()` hasta que una página vuelve corta. La consulta se
 * arma en el callback porque el builder de Supabase es de un solo uso.
 *
 * IMPORTANTE: la consulta debe traer un ORDEN determinista (por ejemplo
 * `.order('created_at').order('id')`), o dos páginas pueden repetir y saltear
 * filas. Con un orden ambiguo Postgres no garantiza nada entre requests.
 */
export async function fetchAllRows<T>(
  make: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
  opts: { page?: number; max?: number } = {},
): Promise<T[]> {
  const PAGE = opts.page ?? 1000;
  const MAX = opts.max ?? 200_000;
  const out: T[] = [];
  for (let from = 0; from < MAX; from += PAGE) {
    const { data, error } = await make(from, from + PAGE - 1);
    if (error) throw new Error(error.message ?? 'query failed');
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Parte una lista en trozos — para no pasarse del largo de URL con `.in()`. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
