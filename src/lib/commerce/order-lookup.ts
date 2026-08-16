import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { TiendanubeClient } from '@/lib/commerce/providers/tiendanube'
import { WooCommerceClient } from '@/lib/commerce/providers/woocommerce'
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

/** Conexión activa del workspace, sea de la plataforma que sea. */
export async function resolveStoreForLookup(
  db: SupabaseClient,
  workspaceId: string,
): Promise<{
  platform: CommercePlatform
  shopDomain: string
  externalStoreId: string | null
  storeUrl: string | null
  accessToken: string
  apiSecret: string | null
} | null> {
  const { data } = await db
    .from('shopify_connections')
    .select('platform, shop_domain, external_store_id, store_url, access_token, api_secret')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .order('installed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const row = data as {
    platform?: string
    shop_domain?: string
    external_store_id?: string | null
    store_url?: string | null
    access_token?: string
    api_secret?: string | null
  } | null
  if (!row?.access_token || !row.shop_domain) return null
  try {
    return {
      platform: (row.platform ?? 'shopify') as CommercePlatform,
      shopDomain: row.shop_domain,
      externalStoreId: row.external_store_id ?? null,
      storeUrl: row.store_url ?? null,
      accessToken: decrypt(row.access_token),
      apiSecret: row.api_secret ? decrypt(row.api_secret) : null,
    }
  } catch {
    // Token ilegible (se rotó ENCRYPTION_KEY): mejor "no encontrado" que
    // una excepción en medio de una conversación.
    return null
  }
}

/**
 * Busca un pedido en Tiendanube o WooCommerce. Shopify NO pasa por acá: su
 * camino ya existe y está probado, y moverlo no aporta nada.
 */
export async function lookupOrderNonShopify(
  store: NonNullable<Awaited<ReturnType<typeof resolveStoreForLookup>>>,
  kind: LookupKind,
  input: string,
): Promise<LookupResult> {
  const termino = input.trim()
  if (!termino) return VACIO
  try {
    if (store.platform === 'tiendanube') {
      return await buscarEnTiendanube(store, kind, termino)
    }
    if (store.platform === 'woocommerce') {
      return await buscarEnWoo(store, kind, termino)
    }
  } catch {
    return VACIO
  }
  return VACIO
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
  // WooCommerce guarda el seguimiento en meta_data y la clave depende del
  // plugin que use el comercio; se buscan las dos más comunes.
  const meta = p.meta_data ?? []
  const buscarMeta = (claves: string[]): string => {
    for (const m of meta) {
      if (m.key && claves.includes(m.key) && typeof m.value === 'string') {
        return m.value
      }
    }
    return ''
  }
  return limpiar({
    order_number: String(p.number ?? p.id ?? ''),
    order_name: p.number ? `#${p.number}` : '',
    email: p.billing?.email ?? '',
    financial_status: p.status ?? '',
    fulfillment_status: p.status === 'completed' ? 'fulfilled' : '',
    total_price: p.total ?? '',
    currency: p.currency ?? '',
    created_at: p.date_created ?? '',
    order_status_url: '',
    items,
    tracking_number: buscarMeta(['_tracking_number', '_wc_shipment_tracking_items']),
    tracking_company: buscarMeta(['_tracking_provider', '_shipping_provider']),
    tracking_url: buscarMeta(['_tracking_url']),
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
