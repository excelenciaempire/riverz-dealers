import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * El mismo producto, vendido en varios lados.
 *
 * Quien vende en Shopify y en Mercado Libre tiene el mismo producto dos veces
 * en la base: cada plataforma sincroniza su fila. Para el comercio es UN
 * producto; para Riverz eran dos, con dos conocimientos separados —y en la
 * práctica uno lleno y el otro vacío, porque nadie carga la misma información
 * dos veces—. El agente terminaba contestando distinto según por dónde le
 * escribieran.
 *
 * **No se fusionan las filas.** Cada plataforma tiene datos que son suyos: su
 * precio (el mismo serum sale 39.990 en Shopify y 45.000 en Mercado Libre por
 * las comisiones), su URL, su id externo, su stock. Borrar una rompería la
 * consulta de pedidos y el próximo sync la recrearía igual.
 *
 * Lo que se unifica es el CONOCIMIENTO: una fila manda y las demás cuelgan.
 *
 * **Por qué se detecta solo.** Pedirle al comercio que empareje su catálogo a
 * mano es pedirle el trabajo que la computadora tiene que hacer: con cincuenta
 * productos en tres plataformas son ciento cincuenta filas para revisar, y no
 * lo va a hacer nadie. Se propone y él confirma.
 */

/** Palabras que no distinguen un producto de otro: unidades, presentación,
 *  relleno de título de marketplace. Sin sacarlas, "30 ml todo tipo de piel"
 *  emparejaba dos cremas distintas de la misma marca. */
const RUIDO = new Set([
  'ml',
  'gr',
  'grs',
  'kg',
  'cm',
  'mm',
  'lt',
  'lts',
  'unidad',
  'unidades',
  'pack',
  'combo',
  'promo',
  'oferta',
  'nuevo',
  'nueva',
  'original',
  'importado',
  'envio',
  'gratis',
  'para',
  'con',
  'sin',
  'todo',
  'todos',
  'toda',
  'todas',
  'tipo',
  'tipos',
  'del',
  'las',
  'los',
  'una',
  'uno',
  'por',
  'the',
  'and',
  'for',
  'with',
])

export function normalizarTitulo(t: string): string {
  return (t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Las palabras que de verdad nombran al producto.
 *
 * Se sacan los números sueltos junto con el ruido: `x2`, `30`, `2021` son la
 * presentación o el año, no el producto. Es lo que hace que las tres
 * publicaciones de Mercado Libre —x1, x2 y x3 del mismo serum— caigan en el
 * mismo grupo en vez de parecer tres productos distintos.
 */
export function tokensSignificativos(titulo: string): Set<string> {
  return new Set(
    normalizarTitulo(titulo)
      .split(' ')
      .filter((w) => w.length >= 3 && !RUIDO.has(w) && !/^\d+$/.test(w) && !/^x\d+$/.test(w)),
  )
}

/**
 * Cuánto se parecen dos títulos, de 0 a 1.
 *
 * Se mide cuántas palabras del título CORTO aparecen en el largo, no la
 * intersección sobre la unión. Los marketplaces rellenan el título con
 * palabras clave —"Pilar Serum Reafirmante Antiedad Regeneracion 30 Ml Todo
 * Tipo De Piel Día/noche"— así que comparando de forma simétrica contra
 * "Serum Pilar" el parecido daba 0,2 y no emparejaba nunca.
 */
export function parecido(a: string, b: string): number {
  const ta = tokensSignificativos(a)
  const tb = tokensSignificativos(b)
  const [corto, largo] = ta.size <= tb.size ? [ta, tb] : [tb, ta]
  // Con una sola palabra no alcanza: "serum" emparejaría todos los serums del
  // catálogo, que es exactamente el error que no se puede cometer.
  if (corto.size < 2) return 0
  let comunes = 0
  for (const w of corto) if (largo.has(w)) comunes += 1
  return comunes / corto.size
}

/**
 * Cuántas unidades vende esta publicación.
 *
 * En un marketplace la cantidad es una publicación aparte: el serum x2 y el x3
 * son dos avisos distintos del mismo producto. El número está en el título
 * ("… 30 Ml X2 …") porque no hay otro lado donde ponerlo.
 *
 * Importa para cotizar: sin esto el agente ve tres precios del mismo producto
 * —45.000, 75.000 y 105.000— y no tiene forma de saber que el segundo son dos
 * frascos. Diría que "cuesta entre 45.000 y 105.000", que no es un precio.
 */
export function unidadesDelTitulo(titulo: string): number {
  const t = normalizarTitulo(titulo)
  // "x2", "x 2", "2 unidades", "pack 3". Se toma el primero que aparezca.
  //
  // Con límite de palabra: sin él, "Crema Max 20 Horas" y "Box 6 Cuotas" se
  // leían como cantidad, y una publicación de UNA unidad quedaba cotizada
  // como si fueran veinte.
  const m =
    /\bx\s?(\d{1,2})\b/.exec(t) ??
    /\b(\d{1,2})\s+unidades?\b/.exec(t) ??
    /\bpack\s+(\d{1,2})\b/.exec(t)
  const n = m ? Number(m[1]) : 1
  return Number.isFinite(n) && n >= 1 && n <= 24 ? n : 1
}

/** Desde acá se propone. Debajo, ni se menciona. */
export const UMBRAL = 0.8

export interface FilaProducto {
  id: string
  title: string | null
  platform: string | null
  shop_domain: string | null
  price_min: number | string | null
  url: string | null
  master_id: string | null
  training_material: string | null
  raw?: unknown
}

/** El SKU de la fila, mire donde mire cada plataforma. */
export function skuDe(p: FilaProducto): string | null {
  const raw = (p.raw ?? null) as Record<string, unknown> | null
  const variantes = (raw?.variants ?? null) as Array<Record<string, unknown>> | null
  const candidatos = [
    variantes?.[0]?.sku,
    raw?.sku,
    raw?.seller_custom_field,
    variantes?.[0]?.barcode,
    raw?.barcode,
  ]
  for (const c of candidatos) {
    const s = typeof c === 'string' ? c.trim().toUpperCase() : ''
    // Un SKU de dos caracteres no identifica nada y aparece repetido.
    if (s.length >= 4) return s
  }
  return null
}

export interface Grupo {
  /** La fila que debería mandar. */
  masterId: string
  masterTitle: string
  /** Las que colgarían de ella. */
  hijos: Array<{ id: string; title: string; platform: string; price: number | null }>
  /** Por qué se propone. El SKU es exacto; el título, un parecido. */
  motivo: 'sku' | 'titulo'
  confianza: number
}

/**
 * Cuál de todas debería mandar.
 *
 * La que más conocimiento tiene, porque es la que alguien ya se tomó el trabajo
 * de llenar. Con empate gana la tienda propia sobre el marketplace: ahí el
 * comercio controla la ficha, la página se puede leer, y el precio no tiene
 * comisiones encima.
 */
export function elegirPrincipal(filas: FilaProducto[]): FilaProducto {
  const peso = (p: FilaProducto) => {
    const plat = (p.platform ?? 'shopify').toLowerCase()
    return plat === 'mercadolibre' ? 0 : 1
  }
  return [...filas].sort((a, b) => {
    const ma = (a.training_material ?? '').length
    const mb = (b.training_material ?? '').length
    if (ma !== mb) return mb - ma
    return peso(b) - peso(a)
  })[0]
}

/**
 * Qué productos del catálogo son en realidad el mismo.
 *
 * Devuelve grupos, nunca los aplica. El SKU se puede unir solo; el parecido de
 * título se propone, porque pegar dos productos distintos hace que el agente
 * cotice el precio equivocado — un error peor que el que esto resuelve.
 */
export async function proponerUnificaciones(
  db: SupabaseClient,
  workspaceId: string,
): Promise<Grupo[]> {
  const { data } = await db
    .from('shopify_products')
    .select('id, title, platform, shop_domain, price_min, url, master_id, training_material, raw')
    .eq('workspace_id', workspaceId)
    .limit(500)

  const filas = ((data ?? []) as FilaProducto[]).filter((p) => (p.title ?? '').trim())
  // Las que ya cuelgan de otra están resueltas.
  const sueltas = filas.filter((p) => !p.master_id)
  if (sueltas.length < 2) return []

  const usadas = new Set<string>()
  const grupos: Grupo[] = []

  // 1. Por SKU. Es exacto y no admite discusión: dos filas con el mismo código
  //    interno son el mismo producto.
  const porSku = new Map<string, FilaProducto[]>()
  for (const p of sueltas) {
    const sku = skuDe(p)
    if (!sku) continue
    porSku.set(sku, [...(porSku.get(sku) ?? []), p])
  }
  for (const [, iguales] of porSku) {
    if (iguales.length < 2) continue
    grupos.push(armarGrupo(iguales, 'sku', 1))
    for (const p of iguales) usadas.add(p.id)
  }

  // 2. Por título. Se agrupa de forma transitiva: si A se parece a B y B a C,
  //    los tres son el mismo producto — es el caso de x1/x2/x3.
  const restantes = sueltas.filter((p) => !usadas.has(p.id))
  for (let i = 0; i < restantes.length; i++) {
    const base = restantes[i]
    if (usadas.has(base.id)) continue
    const grupo = [base]
    let confianza = 1
    for (let j = i + 1; j < restantes.length; j++) {
      const otro = restantes[j]
      if (usadas.has(otro.id)) continue
      const score = Math.max(...grupo.map((g) => parecido(g.title ?? '', otro.title ?? '')))
      if (score >= UMBRAL) {
        grupo.push(otro)
        confianza = Math.min(confianza, score)
      }
    }
    if (grupo.length < 2) continue
    // Sólo vale si están en plataformas distintas. Dos filas de la MISMA
    // tienda con títulos parecidos son dos productos parecidos —dos aromas,
    // dos tamaños— y unirlos sería inventar que son el mismo.
    const plataformas = new Set(grupo.map((p) => p.platform ?? 'shopify'))
    if (plataformas.size < 2) continue
    for (const p of grupo) usadas.add(p.id)
    grupos.push(armarGrupo(grupo, 'titulo', confianza))
  }

  return grupos
}

function armarGrupo(filas: FilaProducto[], motivo: 'sku' | 'titulo', confianza: number): Grupo {
  const principal = elegirPrincipal(filas)
  return {
    masterId: principal.id,
    masterTitle: principal.title ?? '',
    motivo,
    confianza,
    hijos: filas
      .filter((p) => p.id !== principal.id)
      .map((p) => ({
        id: p.id,
        title: p.title ?? '',
        platform: p.platform ?? 'shopify',
        price: p.price_min == null ? null : Number(p.price_min),
      })),
  }
}

export type ResultadoUnificar =
  | { ok: true; unidos: number }
  | { ok: false; motivo: 'no_existe' | 'cadena' | 'error_db' }

/**
 * Cuelga las publicaciones de la principal.
 *
 * Prohíbe la cadena a propósito: si la principal elegida ya cuelga de otra, el
 * conocimiento quedaría a dos saltos y quien lo resuelve mira uno solo.
 */
export async function unificarProductos(
  db: SupabaseClient,
  args: { workspaceId: string; masterId: string; hijos: string[] },
): Promise<ResultadoUnificar> {
  const hijos = [...new Set(args.hijos)].filter((id) => id && id !== args.masterId)
  if (hijos.length === 0) return { ok: false, motivo: 'no_existe' }

  const { data: master } = await db
    .from('shopify_products')
    .select('id, master_id')
    .eq('id', args.masterId)
    .eq('workspace_id', args.workspaceId)
    .maybeSingle()
  if (!master) return { ok: false, motivo: 'no_existe' }
  if ((master as { master_id: string | null }).master_id) return { ok: false, motivo: 'cadena' }

  // Y si alguna de las que se van a colgar era principal de otras, esas otras
  // pasan a colgar de la nueva principal en vez de quedar apuntando a una fila
  // que ya no manda.
  const { error: reencadenar } = await db
    .from('shopify_products')
    .update({ master_id: args.masterId })
    .eq('workspace_id', args.workspaceId)
    .in('master_id', hijos)
  if (reencadenar) return { ok: false, motivo: 'error_db' }

  const { error } = await db
    .from('shopify_products')
    .update({ master_id: args.masterId })
    .eq('workspace_id', args.workspaceId)
    .in('id', hijos)
  if (error) return { ok: false, motivo: 'error_db' }

  return { ok: true, unidos: hijos.length }
}

/** Vuelve a ser un producto por su cuenta. */
export async function separarProducto(
  db: SupabaseClient,
  args: { workspaceId: string; productId: string },
): Promise<{ ok: boolean }> {
  const { error } = await db
    .from('shopify_products')
    .update({ master_id: null })
    .eq('workspace_id', args.workspaceId)
    .eq('id', args.productId)
  return { ok: !error }
}

/**
 * Une sola lo que no admite duda.
 *
 * Corre después de cada sincronización de catálogo. Sólo el SKU: es un código
 * que el propio comercio puso en las dos plataformas, así que no hay nada que
 * confirmar. El parecido de título queda como propuesta — unir dos productos
 * distintos hace que el agente cotice el precio equivocado, y eso es peor que
 * el problema que esto resuelve.
 */
export async function unificarLoObvio(
  db: SupabaseClient,
  workspaceId: string,
): Promise<{ grupos: number; unidos: number }> {
  const grupos = (await proponerUnificaciones(db, workspaceId)).filter((g) => g.motivo === 'sku')
  let unidos = 0
  for (const g of grupos) {
    const r = await unificarProductos(db, {
      workspaceId,
      masterId: g.masterId,
      hijos: g.hijos.map((h) => h.id),
    })
    if (r.ok) unidos += r.unidos
  }
  return { grupos: grupos.length, unidos }
}
