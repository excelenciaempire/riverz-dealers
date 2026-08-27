import type { SupabaseClient } from '@supabase/supabase-js'
import { TiendanubeClient } from '@/lib/commerce/providers/tiendanube'
import { WooCommerceClient, wooFechaAIso } from '@/lib/commerce/providers/woocommerce'
import type { ShopifyOrder } from '@/lib/attribution/shopify'
import { resolveStoreForLookup } from './order-lookup'

/**
 * Pedidos recientes de Tiendanube o WooCommerce, con la forma que ya espera
 * la atribución.
 *
 * La pantalla de métricas cruza pedidos con campañas emparejando por correo y
 * teléfono, y ese cruce estaba escrito contra la forma de un pedido de
 * Shopify. Para no reescribir la atribución entera —que es donde vive la
 * lógica delicada de ventanas, deltas y períodos previos— acá se traduce el
 * pedido de cada plataforma a esa misma forma. La atribución no se entera de
 * qué tienda vino.
 *
 * Se devuelve `ShopifyOrder` a propósito, con todos los lugares donde puede
 * estar el teléfono llenos: emparejar sólo por la raíz deja afuera justo al
 * comprador que llegó por WhatsApp, que es el único que importa medir.
 */

export interface TiendaReciente {
  platform: 'tiendanube' | 'woocommerce' | 'mercadolibre'
  orders: ShopifyOrder[]
}

/**
 * Los pedidos de Mercado Libre, que no se leen de una API sino de casa.
 *
 * ML no se conecta como tienda: viene por el canal de mensajes y sus pedidos
 * llegan espejados a `orders` (migración 137). Como no había lector, un
 * comercio que vende sólo en ML veía el panel entero en cero — ni sus ventas
 * ni las de Riverz—, que es la peor forma de no aparecer: sin error, sin aviso.
 */
async function pedidosDeMercadoLibre(
  db: SupabaseClient,
  workspaceId: string,
  sinceIso: string,
): Promise<ShopifyOrder[]> {
  const { data } = await db
    .from('orders')
    .select(
      'shopify_order_id, order_number, total_price, currency, created_at, customer_email, customer_phone, status, created_by, conversation_id',
    )
    .eq('workspace_id', workspaceId)
    .eq('channel', 'mercadolibre')
    .gte('created_at', sinceIso)
    .limit(2000)

  return ((data ?? []) as PedidoEspejo[]).map((p) => ({
    id: Number(p.shopify_order_id) || 0,
    name: p.order_number ? `#${p.order_number}` : null,
    email: p.customer_email ?? undefined,
    phone: p.customer_phone ?? undefined,
    total_price: p.total_price != null ? String(p.total_price) : '0',
    currency: p.currency ?? undefined,
    created_at: p.created_at,
    // ML anonimiza al comprador: el correo casi nunca viene y el teléfono
    // tampoco. El emparejamiento con el contacto sale por la conversación,
    // que es donde el comprador tiene identidad.
    contact_email: p.customer_email ?? null,
    customer: {
      email: p.customer_email ?? null,
      phone: p.customer_phone ?? null,
    },
    cancelled_at: p.status === 'cancelled' ? p.created_at : null,
    financial_status: p.status === 'cancelled' ? 'refunded' : null,
  }))
}

interface PedidoEspejo {
  shopify_order_id: string | null
  order_number: string | null
  total_price: number | null
  currency: string | null
  created_at: string
  customer_email: string | null
  customer_phone: string | null
  status: string | null
}

/**
 * Devuelve null cuando el workspace no tiene una tienda no-Shopify activa —
 * el llamador ya resolvió Shopify por su cuenta y sigue su camino.
 *
 * Lanza si la API de la tienda falla, igual que `fetchRecentOrders`: la
 * atribución distingue "no hay pedidos" de "no pude preguntar", y devolver
 * una lista vacía ante una caída reportaría cero ventas como si fuera un dato.
 */
export async function fetchRecentOrdersOtherPlatform(
  db: SupabaseClient,
  workspaceId: string,
  sinceIso: string,
): Promise<TiendaReciente | null> {
  const tienda = await resolveStoreForLookup(db, workspaceId)
  if (!tienda || tienda.platform === 'shopify') {
    // Sin tienda resuelta puede haber igual pedidos de Mercado Libre: ML no es
    // una conexión de tienda sino un canal, y sus pedidos ya están espejados.
    if (!tienda) {
      const ml = await pedidosDeMercadoLibre(db, workspaceId, sinceIso)
      return ml.length > 0 ? { platform: 'mercadolibre', orders: ml } : null
    }
    return null
  }

  if (tienda.platform === 'mercadolibre') {
    return {
      platform: 'mercadolibre',
      orders: await pedidosDeMercadoLibre(db, workspaceId, sinceIso),
    }
  }

  if (tienda.platform === 'tiendanube') {
    if (!tienda.externalStoreId) return null
    const client = new TiendanubeClient(
      tienda.externalStoreId,
      tienda.accessToken,
      tienda.shopDomain,
    )
    const crudos = await client.get<PedidoTn[]>(
      `/orders?created_at_min=${encodeURIComponent(sinceIso)}&per_page=200`,
    )
    return {
      platform: 'tiendanube',
      orders: (Array.isArray(crudos) ? crudos : []).map(deTiendanube),
    }
  }

  if (!tienda.apiSecret) return null
  const client = new WooCommerceClient(
    tienda.shopDomain,
    tienda.accessToken,
    tienda.apiSecret,
  )
  const crudos = await client.get<PedidoWoo[]>('/orders', {
    after: sinceIso,
    per_page: 100,
  })
  return {
    platform: 'woocommerce',
    orders: (Array.isArray(crudos) ? crudos : []).map(deWoo),
  }
}

interface PedidoTn {
  id?: number
  number?: number
  /** Cancelado o devuelto: existe, pero no es plata. */
  cancelled_at?: string | null
  payment_status?: string | null
  contact_email?: string
  contact_phone?: string
  total?: string
  currency?: string
  created_at?: string
  customer?: { email?: string; phone?: string }
  shipping_address?: { phone?: string }
  billing_address?: { phone?: string }
  coupon?: { code?: string }[]
}

function deTiendanube(p: PedidoTn): ShopifyOrder {
  return {
    id: p.id ?? p.number ?? 0,
    order_number: p.number ?? null,
    email: p.contact_email ?? undefined,
    phone: p.contact_phone ?? undefined,
    total_price: p.total ?? '0',
    currency: p.currency ?? undefined,
    created_at: p.created_at ?? new Date(0).toISOString(),
    discount_codes: (p.coupon ?? []).map((c) => ({ code: c.code })),
    // Sin esto la atribución no podía descartar un pedido cancelado de
    // Tiendanube y lo sumaba como venta. `refunded` es el valor que usa TN.
    cancelled_at: p.cancelled_at ?? null,
    financial_status:
      p.payment_status === 'refunded' ? 'refunded' : (p.payment_status ?? null),
    contact_email: p.contact_email ?? null,
    customer: p.customer
      ? { email: p.customer.email ?? null, phone: p.customer.phone ?? null }
      : null,
    shipping_address: p.shipping_address
      ? { phone: p.shipping_address.phone ?? null }
      : null,
    billing_address: p.billing_address
      ? { phone: p.billing_address.phone ?? null }
      : null,
  }
}

interface PedidoWoo {
  id?: number
  number?: string
  /** `cancelled`, `refunded`, `failed`… El estado del pedido, no del pago. */
  status?: string | null
  total?: string
  currency?: string
  date_created?: string
  /** El mismo instante en UTC. Es el que sirve: ver `wooFechaAIso`. */
  date_created_gmt?: string
  coupon_lines?: { code?: string }[]
  billing?: { email?: string; phone?: string }
  shipping?: { phone?: string }
}

function deWoo(p: PedidoWoo): ShopifyOrder {
  const correo = p.billing?.email ?? undefined
  const tel = p.billing?.phone ?? undefined
  return {
    id: p.id ?? 0,
    name: p.number ? `#${p.number}` : null,
    email: correo,
    phone: tel,
    total_price: p.total ?? '0',
    currency: p.currency ?? undefined,
    // WooCommerce manda `date_created` en la zona de la TIENDA y sin sufijo,
    // así que pegarle una Z lo corría por el desfase de esa tienda: un pedido
    // de Buenos Aires aparecía tres horas movido y caía en el día —o en la
    // ventana de atribución— equivocado. Al lado viene `date_created_gmt`, que
    // es el mismo instante en UTC. Se usa el mismo lector que el adaptador.
    created_at: wooFechaAIso(p.date_created, p.date_created_gmt) ?? new Date(0).toISOString(),
    discount_codes: (p.coupon_lines ?? []).map((c) => ({ code: c.code })),
    // Woo no separa pago de pedido: el estado dice las dos cosas. Se traduce
    // a la forma de Shopify para que la atribución no tenga que saberlo.
    cancelled_at:
      p.status === 'cancelled' || p.status === 'failed'
        ? (wooFechaAIso(p.date_created, p.date_created_gmt) ?? null)
        : null,
    financial_status: p.status === 'refunded' ? 'refunded' : (p.status ?? null),
    contact_email: correo ?? null,
    customer: { email: correo ?? null, phone: tel ?? null },
    shipping_address: p.shipping?.phone ? { phone: p.shipping.phone } : null,
    billing_address: tel ? { phone: tel } : null,
  }
}

