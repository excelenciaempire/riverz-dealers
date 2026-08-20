/**
 * Escribir el catálogo: crear, editar y borrar un producto.
 *
 * Todo esto vivía dentro de los route handlers de `/api/products`, y alcanzaba
 * mientras el editor era el único que escribía. Dejó de alcanzar cuando el
 * Operador tuvo que poder editar un producto: la parte delicada no es el UPDATE
 * sino lo que lo rodea — recompilar `training_material` en la MISMA operación
 * que el parche, y derivar `price_min`/`price_max` de las ofertas. Una segunda
 * copia de esa secuencia que se olvidara de recompilar dejaría al agente
 * citándole a un cliente la descripción vieja, y nadie lo vería hasta leer una
 * conversación.
 *
 * Acá no hay sesión ni RLS: eso lo resuelve quien llama. La route pasa el
 * cliente del usuario, que ya viene recortado por RLS (mig 057); la capacidad
 * pasa el cliente de servicio y ADEMÁS `workspaceId`, porque ese cliente no
 * tiene recorte propio y sin el filtro explícito el id de otra cuenta se
 * editaría igual.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveWorkspaceCurrency } from './currency'
import { handleSuffix, isUuid, slugifyTitle } from './slug'
import { buildTrainingMaterial } from './training-material'

type ProductoLocale = 'es' | 'en'

/** Lo que el editor puede tocar de un producto. */
export interface CambiosDeProducto {
  title?: string
  description?: string | null
  custom_notes?: string | null
  custom_faqs?: Array<{ q: string; a: string }>
  /** Editor premium (mig 074): nombre editable, galería, fuentes, precios. */
  images?: string[]
  websites?: string[]
  currency?: string | null
  /** Contexto de venta por producto (mig 073) — se inyecta en el prompt. */
  say_guidelines?: string | null
  never_say?: string[]
  escalation_triggers?: string[]
  allowed_offers?: Array<{
    label?: string
    total?: number | string
    conditions?: string
    /** Unidades del paquete: el webhook de pedidos las usa para saber qué
     *  oferta eligió el cliente (flujos de recompra). */
    units?: number
  }>
  structured_research?: Record<string, unknown> | null
  health_sensitive?: boolean
}

/**
 * Por qué no se pudo escribir, sin texto.
 *
 * La route traduce cada motivo con el idioma del comercio y la capacidad lo
 * cuenta en español. Si acá viniera ya redactado, uno de los dos mostraría el
 * idioma del otro.
 */
export type MotivoDeFalla =
  | 'faqs_no_es_lista'
  | 'faq_mal_formada'
  | 'falta_titulo'
  | 'no_existe'
  | 'error_db'

type Falla = { ok: false; motivo: MotivoDeFalla; error?: unknown }

export type ResultadoCrear = { ok: true; id: string } | Falla
export type ResultadoActualizar =
  | { ok: true; producto: Record<string, unknown> }
  | Falla
export type ResultadoBorrar = { ok: true; imagenesBorradas: number } | Falla

// ---------------------------------------------------------------------------

/**
 * Precio numérico del `total` de una oferta ("39.900", "$ 1,299", 39900…).
 *
 * Hay otro parser de plata en `@/lib/shopify/detect-offers` (`parseMoney`) y NO
 * son intercambiables: aquel lee "39.990" como 39990 (punto de miles) y éste
 * como 39.99. Unificarlos cambiaría el precio de todos los productos donde el
 * merchant ya escribió el total a mano, así que se mueve tal cual estaba en la
 * route y la diferencia queda anotada en vez de resuelta a ciegas.
 */
function precioDeOferta(total: unknown): number | null {
  if (typeof total === 'number' && Number.isFinite(total)) return total
  if (typeof total !== 'string') return null
  const cleaned = total.replace(/[^\d.,-]/g, '')
  if (!cleaned) return null
  let norm = cleaned
  if (cleaned.includes(',') && cleaned.includes('.')) {
    // Con los dos separadores, el último es el decimal.
    norm =
      cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '')
  } else if (cleaned.includes(',')) {
    // Coma sola: decimales sólo si es ,dd al final; si no, miles.
    norm = /,\d{1,2}$/.test(cleaned) ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '')
  }
  const n = Number(norm)
  return Number.isFinite(n) ? n : null
}

/** Las preguntas frecuentes se revisan ANTES de tocar la base. */
export function validarFaqs(faqs: unknown): MotivoDeFalla | null {
  if (!Array.isArray(faqs)) return 'faqs_no_es_lista'
  for (const f of faqs) {
    const fila = f as { q?: unknown; a?: unknown } | null
    if (typeof fila?.q !== 'string' || typeof fila?.a !== 'string') return 'faq_mal_formada'
  }
  return null
}

/**
 * Los cambios traducidos a columnas.
 *
 * Sólo viajan las claves presentes: `undefined` significa "no lo toques" y
 * `null` significa "vacialo". Sin esa distinción, editar una nota borraría la
 * descripción de todo lo que el que llama no mandó.
 */
export function armarParche(cambios: CambiosDeProducto): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (cambios.title !== undefined && cambios.title.trim()) patch.title = cambios.title.trim()
  if (cambios.description !== undefined) patch.description = cambios.description
  if (cambios.custom_notes !== undefined) patch.custom_notes = cambios.custom_notes
  if (cambios.custom_faqs !== undefined) patch.custom_faqs = cambios.custom_faqs
  if (cambios.currency !== undefined) patch.currency = cambios.currency || null

  // Galería: sólo strings con contenido, y la primera se espeja en image_url
  // para que la miniatura del catálogo siga a la galería.
  if (cambios.images !== undefined) {
    const imgs = (Array.isArray(cambios.images) ? cambios.images : [])
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean)
      .slice(0, 12)
    patch.images = imgs
    patch.image_url = imgs[0] ?? null
  }

  // Fuentes (máx. 5) — la primera se espeja en `url`, que es de donde lee el
  // scraper que ya existía.
  if (cambios.websites !== undefined) {
    const sites = (Array.isArray(cambios.websites) ? cambios.websites : [])
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean)
      .slice(0, 5)
    patch.websites = sites
    patch.url = sites[0] ?? null
  }

  if (cambios.say_guidelines !== undefined) patch.say_guidelines = cambios.say_guidelines
  if (cambios.never_say !== undefined)
    patch.never_say = Array.isArray(cambios.never_say) ? cambios.never_say : []
  if (cambios.escalation_triggers !== undefined)
    patch.escalation_triggers = Array.isArray(cambios.escalation_triggers)
      ? cambios.escalation_triggers
      : []

  if (cambios.allowed_offers !== undefined) {
    const offers = Array.isArray(cambios.allowed_offers) ? cambios.allowed_offers : []
    patch.allowed_offers = offers
    // El merchant tocó las ofertas a mano → la fila pasa a ser suya y el
    // autodetector (scrape/backfill) no vuelve a pisarla.
    patch.offers_auto_detected = false
    // "Precios de venta" vive acá: price_min/max se derivan de los totales
    // para el catálogo y para lo que cotiza el agente.
    const prices = offers
      .map((o) => (o && typeof o === 'object' ? precioDeOferta(o.total) : null))
      .filter((n): n is number => n != null)
    if (prices.length > 0) {
      patch.price_min = Math.min(...prices)
      patch.price_max = Math.max(...prices)
    }
  }

  if (cambios.structured_research !== undefined)
    patch.structured_research = cambios.structured_research
  if (cambios.health_sensitive !== undefined)
    patch.health_sensitive = !!cambios.health_sensitive

  return patch
}

// ---------------------------------------------------------------------------

/** El id de la URL puede ser el uuid real o el handle legible. */
function porIdOHandle(
  db: SupabaseClient,
  columnas: string,
  id: string,
  workspaceId?: string,
) {
  const q = db
    .from('shopify_products')
    .select(columnas)
    .eq(isUuid(id) ? 'id' : 'handle', id)
  return workspaceId ? q.eq('workspace_id', workspaceId) : q
}

export interface ActualizarProductoArgs {
  /** uuid real o handle. */
  id: string
  cambios: CambiosDeProducto
  /** Idioma de los encabezados del material compilado. */
  locale: ProductoLocale
  /** Recorte por cuenta. Obligatorio con un cliente de servicio. */
  workspaceId?: string
}

export async function actualizarProducto(
  db: SupabaseClient,
  { id, cambios, locale, workspaceId }: ActualizarProductoArgs,
): Promise<ResultadoActualizar> {
  if (cambios.custom_faqs !== undefined) {
    const mal = validarFaqs(cambios.custom_faqs)
    if (mal) return { ok: false, motivo: mal }
  }

  const patch = armarParche(cambios)

  // La fila actual se lee ANTES para armar el material en la misma operación
  // que el parche. Con dos updates separados quedaba una ventana en la que el
  // material describía un producto que ya había cambiado.
  const { data: current, error: readErr } = await porIdOHandle(
    db,
    '*',
    id,
    workspaceId,
  ).maybeSingle()
  if (readErr) return { ok: false, motivo: 'error_db', error: readErr }
  if (!current) return { ok: false, motivo: 'no_existe' }
  // `select()` con columnas dinámicas pierde el tipado de PostgREST: se vuelve
  // a poner a mano en vez de escribir el select tres veces.
  const actual = current as unknown as Record<string, unknown>

  // El handle es el segmento legible de la URL del editor. En los productos
  // MANUALES se regenera al renombrar (conservando el sufijo estable) para que
  // /productos/<handle> siga al nombre. Los de Shopify NO se tocan: su handle
  // es el slug real de la tienda y el routing de IA lo usa para emparejar los
  // links que pega el cliente.
  if (patch.title && actual.shop_domain === 'manual' && patch.title !== actual.title) {
    patch.handle = `${slugifyTitle(patch.title as string)}-${handleSuffix(
      actual.external_id as number,
    )}`
  }

  const training = buildTrainingMaterial({ ...actual, ...patch }, locale)

  const { data: updated, error } = await db
    .from('shopify_products')
    .update({ ...patch, training_material: training })
    .eq('id', actual.id as string)
    .select('*')
    .maybeSingle()
  if (error) return { ok: false, motivo: 'error_db', error }
  if (!updated) return { ok: false, motivo: 'no_existe' }

  return { ok: true, producto: updated as Record<string, unknown> }
}

// ---------------------------------------------------------------------------

/**
 * El nombre, ya recortado. Está aparte porque la route lo necesita ANTES de
 * resolver la cuenta: al revés, a quien manda el formulario vacío le
 * contestaría "no se pudo resolver el negocio" en vez de "falta el nombre".
 */
export function tituloDeProducto(datos: Record<string, unknown>): string {
  return String(datos?.title ?? '').trim()
}

export interface CrearProductoArgs {
  userId: string
  workspaceId: string
  /** Cuerpo suelto, como llega del formulario. */
  datos: Record<string, unknown>
}

/**
 * Un producto desde cero, sin tienda conectada.
 *
 * Va a la misma tabla que los sincronizados para que caiga en el catálogo, en
 * el selector de "Productos asignados" del agente y en el detalle: idéntico a
 * uno de Shopify, sólo que con `shop_domain='manual'`.
 */
export async function crearProducto(
  db: SupabaseClient,
  { userId, workspaceId, datos }: CrearProductoArgs,
): Promise<ResultadoCrear> {
  const title = tituloDeProducto(datos)
  if (!title) return { ok: false, motivo: 'falta_titulo' }

  const num = (v: unknown): number | null => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  const str = (v: unknown): string | null => {
    const s = String(v ?? '').trim()
    return s ? s : null
  }

  // external_id es un bigint (el id numérico de Shopify). Para los manuales se
  // usa uno NEGATIVO derivado del reloj, así nunca choca con un id real de
  // Shopify (siempre positivo) ni con otro manual. La clave única es
  // (shop_domain, external_id) y acá shop_domain es 'manual'.
  const externalId = -(Date.now() * 1000 + Math.floor(Math.random() * 1000))
  const handle = `${slugifyTitle(title)}-${handleSuffix(externalId)}`
  const priceMin = num(datos?.price_min)
  const priceMax = num(datos?.price_max) ?? priceMin
  // Divisa: la que venga, o la del negocio (tienda / config / catálogo) en vez
  // de un 'COP' escrito a mano.
  const currency = str(datos?.currency) ?? (await resolveWorkspaceCurrency(db, workspaceId))

  const { data, error } = await db
    .from('shopify_products')
    .insert({
      user_id: userId,
      workspace_id: workspaceId,
      shop_domain: 'manual',
      external_id: externalId,
      handle,
      title,
      description: str(datos?.description),
      product_type: str(datos?.product_type),
      price_min: priceMin,
      price_max: priceMax,
      currency,
      image_url: str(datos?.image_url),
      custom_notes: str(datos?.custom_notes),
      scrape_status: 'done',
      synced_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) return { ok: false, motivo: 'error_db', error }
  return { ok: true, id: (data as { id: string }).id }
}

// ---------------------------------------------------------------------------

/** Ruta dentro del bucket `product-media` de una URL pública de Supabase
 *  Storage, o null si la URL es externa (Shopify, ML, un CDN…). */
function rutaEnStorage(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const marker = '/storage/v1/object/public/product-media/'
  const at = url.indexOf(marker)
  if (at === -1) return null
  const path = decodeURIComponent(url.slice(at + marker.length).split('?')[0])
  return path || null
}

/** Todas las imágenes de una fila (galería + miniatura). */
function imagenesDeFila(row: { images?: unknown; image_url?: unknown }): string[] {
  const gallery = Array.isArray(row.images) ? row.images : []
  return [...gallery, row.image_url].filter(
    (u): u is string => typeof u === 'string' && !!u,
  )
}

export interface BorrarProductoArgs {
  id: string
  /** Cliente de servicio: hace falta para el Storage y para mirar las demás
   *  filas del workspace, que el cliente del usuario no siempre ve. */
  admin: SupabaseClient
  workspaceId?: string
}

/**
 * Borra el producto y todo lo que cuelga de él: las asignaciones a agentes
 * (`ai_agent_products`, ON DELETE CASCADE de la mig 025), su investigación y su
 * contexto de venta (columnas de la misma fila) y las imágenes que el merchant
 * subió y que ningún otro producto de la cuenta esté usando.
 *
 * Es irreversible. Si el producto está sincronizado, la próxima sincronización
 * lo vuelve a traer si sigue en la tienda.
 */
export async function borrarProducto(
  db: SupabaseClient,
  { id, admin, workspaceId }: BorrarProductoArgs,
): Promise<ResultadoBorrar> {
  const { data: product, error: readErr } = await porIdOHandle(
    db,
    'id, workspace_id, title, images, image_url',
    id,
    workspaceId,
  ).maybeSingle()
  if (readErr) return { ok: false, motivo: 'error_db', error: readErr }
  if (!product) return { ok: false, motivo: 'no_existe' }
  const fila = product as unknown as {
    id: string
    workspace_id: string
    images?: unknown
    image_url?: unknown
  }

  // 1. Imágenes propias en Storage. Antes de borrarlas se descartan las que
  //    otro producto de la cuenta siga referenciando: una galería puede reusar
  //    una URL si el merchant copió y pegó.
  const ownPaths = [
    ...new Set(imagenesDeFila(fila).map(rutaEnStorage).filter(Boolean)),
  ] as string[]
  if (ownPaths.length > 0) {
    const { data: others } = await admin
      .from('shopify_products')
      .select('images, image_url')
      .eq('workspace_id', fila.workspace_id)
      .neq('id', fila.id)
    const stillUsed = new Set(
      ((others ?? []) as Array<{ images?: unknown; image_url?: unknown }>)
        .flatMap(imagenesDeFila)
        .map(rutaEnStorage)
        .filter(Boolean) as string[],
    )
    const removable = ownPaths.filter((p) => !stillUsed.has(p))
    if (removable.length > 0) {
      const { error: storageErr } = await admin.storage
        .from('product-media')
        .remove(removable)
      // Fail-open: un archivo huérfano no puede impedir borrar el producto.
      if (storageErr) {
        console.error('[products] no se pudieron borrar las imágenes:', storageErr)
      }
    }
  }

  // 2. La fila.
  const { error } = await db.from('shopify_products').delete().eq('id', fila.id)
  if (error) return { ok: false, motivo: 'error_db', error }

  return { ok: true, imagenesBorradas: ownPaths.length }
}
