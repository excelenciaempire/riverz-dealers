/**
 * Un producto vendido en varios lados se lista UNA vez.
 *
 * El mismo producto tiene una fila por plataforma —cada canal sincroniza la
 * suya— y una manda sobre las demás (`master_id`, migración 183). Plegarlas es
 * lo que hace que el comercio vea su catálogo y no la suma de sus integraciones.
 *
 * Vive acá y no dentro de una ruta porque lo usan DOS pantallas: la lista de
 * Productos y el selector de productos del agente. Estaban escritas por
 * separado —y la del agente ni siquiera pedía `master_id`—, así que el mismo
 * serum salía unificado en una y cuatro veces en la otra. Una sola función es
 * lo único que garantiza que sigan diciendo lo mismo.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface FilaAgrupable {
  id: string
  title?: string | null
  master_id?: string | null
  platform?: string | null
  price_min?: number | string | null
  currency?: string | null
  url?: string | null
  [k: string]: unknown
}

/** Una publicación del grupo, con el precio de SU canal. */
export interface Publicacion {
  id: string
  platform: string
  title: string | null
  price_min: number | string | null
  currency: string | null
  url: string | null
  /** La que manda el conocimiento. Hay exactamente una por grupo. */
  is_master: boolean
}

export type Agrupado<T extends FilaAgrupable> = T & { listings?: Publicacion[] }

/**
 * Pliega las publicaciones sobre su principal.
 *
 * Se pliega SÓLO si la principal está en la misma tanda. Con un filtro aplicado
 * —una búsqueda, un estado— puede no estarlo, y esconder una publicación detrás
 * de una tarjeta que no se ve la haría desaparecer: el comercio buscaría algo
 * que existe y la pantalla le diría que no hay nada.
 *
 * Los precios no se promedian ni se elige uno: el mismo serum sale 39.990 en
 * Shopify y 45.000 en Mercado Libre por las comisiones, y los dos son ciertos
 * en su canal.
 */
export function agruparPorPrincipal<T extends FilaAgrupable>(filas: T[]): Agrupado<T>[] {
  const porId = new Map(filas.map((p) => [String(p.id), p]))
  const hijosDe = new Map<string, T[]>()
  for (const p of filas) {
    const master = p.master_id ? String(p.master_id) : ''
    if (!master || !porId.has(master)) continue
    hijosDe.set(master, [...(hijosDe.get(master) ?? []), p])
  }

  return filas
    .filter((p) => !(p.master_id && porId.has(String(p.master_id))))
    .map((p) => {
      const hijos = hijosDe.get(String(p.id)) ?? []
      // Un producto de un solo canal no lleva la línea de canales: repetiría el
      // precio que ya está arriba.
      if (hijos.length === 0) return p as Agrupado<T>
      return {
        ...p,
        listings: [p, ...hijos].map((x) => ({
          id: String(x.id),
          platform: x.platform ?? 'shopify',
          title: x.title ?? null,
          price_min: x.price_min ?? null,
          currency: x.currency ?? null,
          url: x.url ?? null,
          is_master: String(x.id) === String(p.id),
        })),
      } as Agrupado<T>
    })
}

/**
 * Todos los ids de un producto: el suyo y los de sus publicaciones.
 *
 * Es la unidad con la que se asigna un producto a un agente. Asignar sólo la
 * principal dejaba al agente autorizado a hablar de la fila de Shopify y no de
 * la de Mercado Libre — el mismo producto, partido en dos por dónde le
 * escriban, que es justo lo que unificar vino a arreglar.
 */
export function idsDelGrupo(p: { id: string; listings?: Publicacion[] }): string[] {
  const ids = (p.listings ?? []).map((l) => String(l.id))
  return Array.from(new Set([String(p.id), ...ids]))
}

/**
 * Lo mismo, contra la base: los ids asignados más los de sus hermanas.
 *
 * El selector ya guarda el grupo entero, pero las asignaciones que se hicieron
 * ANTES de que existiera la unificación —o antes de que este producto se
 * unificara— apuntan a una sola fila. Sin esto, unir dos productos que ya
 * estaban asignados por separado no cambiaba nada para el agente, y asignar uno
 * y después unirlo dejaba la mitad del producto afuera. Se resuelve al leer,
 * así que agrupar y desagrupar se refleja sin tener que reescribir nada.
 *
 * Devuelve el mismo conjunto que entró si no hay nada unificado.
 */
export async function expandirGrupos(
  db: SupabaseClient,
  workspaceId: string,
  ids: string[],
): Promise<Set<string>> {
  const base = Array.from(new Set(ids.filter(Boolean)))
  if (base.length === 0) return new Set()

  // 1. La raíz de cada asignada: la principal si cuelga de una, o ella misma.
  const { data: propias } = await db
    .from('shopify_products')
    .select('id, master_id')
    .eq('workspace_id', workspaceId)
    .in('id', base)
  const raices = new Set(
    ((propias ?? []) as Array<{ id: string; master_id: string | null }>).map(
      (p) => p.master_id ?? p.id,
    ),
  )
  if (raices.size === 0) return new Set(base)

  // 2. Esas raíces y todo lo que cuelga de ellas.
  const lista = Array.from(raices)
  const { data: hermanas } = await db
    .from('shopify_products')
    .select('id')
    .eq('workspace_id', workspaceId)
    .or(`id.in.(${lista.join(',')}),master_id.in.(${lista.join(',')})`)

  const salida = new Set(base)
  for (const p of (hermanas ?? []) as Array<{ id: string }>) salida.add(p.id)
  return salida
}
