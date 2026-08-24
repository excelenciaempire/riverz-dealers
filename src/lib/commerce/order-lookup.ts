import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { tokenVivo, COLUMNAS_TOKEN } from '@/lib/shopify/token-vivo'
import { TiendanubeClient } from '@/lib/commerce/providers/tiendanube'
import {
  WooCommerceClient,
  extractWooTracking,
  wooFechaAIso,
} from '@/lib/commerce/providers/woocommerce'
import { resolveCarrierTrackingUrl } from '@/lib/shopify/carrier-tracking'
import type { CommercePlatform } from './types'

/**
 * "¿Dónde está mi pedido?" — para cualquier plataforma.
 *
 * Es la pregunta más frecuente que recibe un comercio, y hasta acá sólo la
 * podía contestar quien tuviera Shopify: el nodo de flujos y la herramienta
 * del asistente hablaban únicamente con la Admin API de Shopify. Un comercio
 * de Tiendanube o WooCommerce veía el nodo, lo configuraba, y su bot
 * contestaba "no encontré tu pedido" a todo el mundo.
 *
 * Devuelve el MISMO mapa de variables que el camino de Shopify
 * (`orderToVars`), para que el nodo de flujos, sus condiciones y las
 * plantillas que ya escribieron los comercios sigan funcionando sin
 * cambiarles una tecla.
 *
 * Nunca lanza: todo "no encontrado" —sin conexión, sin coincidencia, entrada
 * inservible, API caída— vuelve como `found: false`, que es lo que el runner
 * necesita para mandar al cliente por la rama de "no lo encontré".
 */

export type LookupKind = 'order_by_number' | 'order_by_email' | 'order_by_phone'

export interface LookupResult {
  found: boolean
  vars?: Record<string, string>
}

const VACIO: LookupResult = { found: false }

/**
 * La tienda activa del workspace.
 *
 * `platform` la fija. Sin ella se devuelve la más reciente que NO sea Shopify,
 * porque quien llama así ya resolvió Shopify por su cuenta y descarta el
 * resultado cuando viene de ahí: una cuenta con Shopify y Tiendanube
 * conectadas se quedaba sin respuesta —ganaba la conexión más nueva y tapaba
 * la única tienda que ese camino podía consultar—, y la clienta que preguntaba
 * "¿dónde está mi pedido?" recibía un "no lo encontré" de una tienda que nunca
 * tuvo ese pedido.
 */
export async function resolveStoreForLookup(
  db: SupabaseClient,
  workspaceId: string,
  platform?: CommercePlatform,
): Promise<{
  platform: CommercePlatform
  shopDomain: string
  externalStoreId: string | null
  storeUrl: string | null
  accessToken: string
  apiSecret: string | null
} | null> {
  interface Fila {
    id?: string
    platform?: string
    shop_domain?: string
    external_store_id?: string | null
    store_url?: string | null
    access_token?: string
    api_secret?: string | null
    token_expires_at?: string | null
    refresh_token_encrypted?: string | null
    refresh_token_expires_at?: string | null
  }

  let q = db
    .from('shopify_connections')
    .select(`platform, external_store_id, store_url, api_secret, ${COLUMNAS_TOKEN}`)
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
  if (platform) q = q.eq('platform', platform)

  // Sin `limit(1)`: reinstalar con otro usuario de la misma cuenta deja otra
  // fila activa (la constraint es (user_id, shop_domain)), así que la más
  // reciente de UNA plataforma puede tapar a las demás.
  const { data } = await q.order('installed_at', { ascending: false }).limit(10)
  const filas = (Array.isArray(data) ? data : []) as Fila[]
  const row = platform
    ? (filas[0] ?? null)
    : (filas.find((f) => (f.platform ?? 'shopify') !== 'shopify') ?? null)
  if (!row?.access_token || !row.shop_domain) return null
  try {
    return {
      platform: (row.platform ?? 'shopify') as CommercePlatform,
      shopDomain: row.shop_domain,
      externalStoreId: row.external_store_id ?? null,
      storeUrl: row.store_url ?? null,
      // Shopify: renovado si estaba por vencer (migración 194). Las otras
      // plataformas no expiran, y `tokenVivo` las deja pasar tal cual.
      accessToken: (await tokenVivo(db, row as Parameters<typeof tokenVivo>[1])).accessToken,
      apiSecret: row.api_secret ? decrypt(row.api_secret) : null,
    }
  } catch {
    // Token ilegible (se rotó ENCRYPTION_KEY): mejor "no encontrado" que
    // una excepción en medio de una conversación.
    return null
  }
}

/** Quién está preguntando, para poder decidir si el pedido es suyo. */
export interface QuienPregunta {
  email?: string | null
  phone?: string | null
}

function claveDeTelefono(valor: string | null | undefined): string | null {
  const digitos = (valor ?? '').replace(/\D/g, '')
  return digitos.length >= 8 ? digitos.slice(-8) : null
}

/**
 * ¿El pedido es de quien está hablando?
 *
 * El número de pedido no prueba nada: en Tiendanube y en WooCommerce son
 * correlativos y chicos (1, 2, 3…), así que cualquiera podía escribirle al chat
 * de la tienda "¿dónde está el pedido 118?" y recibir el correo de la
 * compradora, lo que compró, el total y el número de seguimiento — y después
 * 119, y 120. El camino de Shopify ya comparaba contra el contacto; estos dos
 * devolvían el pedido sin mirar de quién era.
 *
 * Sin correo ni teléfono del contacto no hay con qué comparar, y se rechaza.
 * El caso legítimo que eso deja afuera —quien acaba de comprar por el chat web
 * y todavía no se identificó— lo cubre la fila espejo, que está atada a la
 * conversación.
 */
export function esDeQuienPregunta(
  pedido: { correos?: Array<string | null | undefined>; telefonos?: Array<string | null | undefined> },
  quien: QuienPregunta | undefined,
): boolean {
  const correo = quien?.email?.trim().toLowerCase()
  if (correo) {
    for (const c of pedido.correos ?? []) {
      if ((c ?? '').trim().toLowerCase() === correo) return true
    }
  }
  const tel = claveDeTelefono(quien?.phone)
  if (tel) {
    for (const t of pedido.telefonos ?? []) {
      if (claveDeTelefono(t) === tel) return true
    }
  }
  return false
}

function esSuyo(vars: Record<string, string>, quien: QuienPregunta | undefined): boolean {
  return esDeQuienPregunta(
    { correos: [vars.email], telefonos: [vars.phone, vars.customer_phone, vars.shipping_phone] },
    quien,
  )
}

/**
 * Busca un pedido en Tiendanube o WooCommerce. Shopify NO pasa por acá: su
 * camino ya existe y está probado, y moverlo no aporta nada.
 *
 * `quien` es obligatorio en la práctica para buscar POR NÚMERO: sin él la
 * búsqueda se rechaza. Es a propósito que el parámetro sea opcional en el tipo
 * y estricto en la ejecución — quien agregue un llamador nuevo y se olvide de
 * pasarlo obtiene "no encontrado", no el pedido de un tercero.
 */
export async function lookupOrderNonShopify(
  store: NonNullable<Awaited<ReturnType<typeof resolveStoreForLookup>>>,
  kind: LookupKind,
  input: string,
  quien?: QuienPregunta,
): Promise<LookupResult> {
  const termino = input.trim()
  if (!termino) return VACIO
  try {
    let r: LookupResult = VACIO
    if (store.platform === 'tiendanube') {
      r = await buscarEnTiendanube(store, kind, termino)
    } else if (store.platform === 'woocommerce') {
      r = await buscarEnWoo(store, kind, termino)
    }
    // Buscar por correo o por teléfono ya usa un dato que sólo el dueño del
    // pedido tiene; el número, no.
    if (r.found && kind === 'order_by_number' && !esSuyo(r.vars ?? {}, quien)) return VACIO
    return r
  } catch {
    return VACIO
  }
}

// ── Tiendanube ───────────────────────────────────────────────────────────

interface PedidoTn {
  number?: number
  contact_email?: string
  contact_phone?: string
  payment_status?: string
  shipping_status?: string
  status?: string
  total?: string
  currency?: string
  created_at?: string
  shipping_tracking_number?: string | null
  shipping_tracking_url?: string | null
  shipping_option?: string | null
  products?: { name?: string | Record<string, string>; quantity?: number }[]
}

async function buscarEnTiendanube(
  store: NonNullable<Awaited<ReturnType<typeof resolveStoreForLookup>>>,
  kind: LookupKind,
  termino: string,
): Promise<LookupResult> {
  if (!store.externalStoreId) return VACIO
  const client = new TiendanubeClient(
    store.externalStoreId,
    store.accessToken,
    store.shopDomain,
  )

  // `q` busca por número, nombre, correo y teléfono a la vez. Es un solo
  // pedido a la API para los tres casos, en vez de tres caminos distintos.
  const q =
    kind === 'order_by_number' ? termino.replace(/[^0-9]/g, '') : termino
  if (!q) return VACIO

  const pedidos = await client.get<PedidoTn[]>(
    `/orders?q=${encodeURIComponent(q)}&per_page=5`,
  )
  const lista = Array.isArray(pedidos) ? pedidos : []
  if (lista.length === 0) return VACIO

  // Con número exigimos coincidencia exacta: `q` es difuso y devolver el
  // pedido de otro cliente porque comparte dígitos sería peor que no
  // encontrar nada.
  const elegido =
    kind === 'order_by_number'
      ? lista.find((p) => String(p.number ?? '') === q)
      : lista[0]
  if (!elegido) return VACIO

  return { found: true, vars: pedidoTnAVars(elegido, store.storeUrl) }
}

/** Tiendanube devuelve los nombres como {es: "...", pt: "..."} o como texto. */
function textoLocalizado(v: string | Record<string, string> | undefined): string {
  if (!v) return ''
  if (typeof v === 'string') return v
  return v.es || v.pt || v.en || Object.values(v)[0] || ''
}

function pedidoTnAVars(p: PedidoTn, storeUrl: string | null): Record<string, string> {
  const items = (p.products ?? [])
    .map((li) => `${li.quantity ?? 1}× ${textoLocalizado(li.name)}`)
    .filter((s) => s.trim() !== '1× ')
    .join(', ')
  const tracking = p.shipping_tracking_number ?? ''
  return limpiar({
    order_number: p.number != null ? String(p.number) : '',
    order_name: p.number != null ? `#${p.number}` : '',
    email: p.contact_email ?? '',
    // El teléfono viaja porque es con lo que se comprueba que el pedido sea de
    // quien pregunta: en WhatsApp el contacto no tiene correo, sólo número.
    phone: p.contact_phone ?? '',
    financial_status: p.payment_status ?? '',
    fulfillment_status: p.shipping_status ?? '',
    total_price: p.total ?? '',
    currency: p.currency ?? '',
    created_at: p.created_at ?? '',
    order_status_url: storeUrl ? `${storeUrl}/account/orders` : '',
    items,
    tracking_number: tracking,
    tracking_company: p.shipping_option ?? '',
    tracking_url:
      p.shipping_tracking_url ||
      resolveCarrierTrackingUrl(p.shipping_option ?? '', tracking) ||
      '',
  })
}

// ── WooCommerce ──────────────────────────────────────────────────────────

interface PedidoWoo {
  id?: number
  number?: string
  status?: string
  total?: string
  currency?: string
  date_created?: string
  date_created_gmt?: string
  billing?: { email?: string; phone?: string }
  line_items?: { name?: string; quantity?: number }[]
  meta_data?: { key?: string; value?: unknown }[]
}

async function buscarEnWoo(
  store: NonNullable<Awaited<ReturnType<typeof resolveStoreForLookup>>>,
  kind: LookupKind,
  termino: string,
): Promise<LookupResult> {
  // La credencial de WooCommerce es un PAR: consumer_key vive en
  // access_token y consumer_secret en api_secret (migración 126).
  if (!store.apiSecret) return VACIO
  const client = new WooCommerceClient(
    store.shopDomain,
    store.accessToken,
    store.apiSecret,
  )

  const q =
    kind === 'order_by_number' ? termino.replace(/[^0-9]/g, '') : termino
  if (!q) return VACIO

  const pedidos = await client.get<PedidoWoo[]>('/orders', {
    search: q,
    per_page: 5,
  })
  const lista = Array.isArray(pedidos) ? pedidos : []
  if (lista.length === 0) return VACIO

  const elegido =
    kind === 'order_by_number'
      ? lista.find((p) => String(p.number ?? p.id ?? '') === q)
      : lista[0]
  if (!elegido) return VACIO

  return { found: true, vars: pedidoWooAVars(elegido) }
}

function pedidoWooAVars(p: PedidoWoo): Record<string, string> {
  const items = (p.line_items ?? [])
    .map((li) => `${li.quantity ?? 1}× ${li.name ?? ''}`)
    .join(', ')
  // El seguimiento sale del adaptador y no de una segunda lista de claves acá:
  // cada plugin de WooCommerce guarda las suyas, y tener dos lecturas distintas
  // hacía que el mismo pedido tuviera número de seguimiento por un camino y no
  // por el otro.
  const tracking = extractWooTracking(p.meta_data)
  return limpiar({
    order_number: String(p.number ?? p.id ?? ''),
    order_name: p.number ? `#${p.number}` : '',
    email: p.billing?.email ?? '',
    // Igual que en Tiendanube: con esto se comprueba de quién es el pedido.
    phone: p.billing?.phone ?? '',
    financial_status: p.status ?? '',
    fulfillment_status: p.status === 'completed' ? 'fulfilled' : '',
    total_price: p.total ?? '',
    currency: p.currency ?? '',
    created_at: wooFechaAIso(p.date_created, p.date_created_gmt) ?? '',
    order_status_url: '',
    items,
    tracking_number: tracking.number,
    tracking_company: tracking.company,
    tracking_url:
      tracking.url ||
      resolveCarrierTrackingUrl(tracking.company, tracking.number) ||
      '',
  })
}

/** Fuera las claves vacías: una variable vacía en una plantilla se ve peor
 *  que la variable ausente, que el runner reemplaza por su valor por defecto. */
function limpiar(v: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v)) {
    if (val && val.trim()) out[k] = val.trim()
  }
  return out
}
