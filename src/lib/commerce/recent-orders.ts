import type { SupabaseClient } from '@supabase/supabase-js'
import { TiendanubeClient } from '@/lib/commerce/providers/tiendanube'
import { WooCommerceClient } from '@/lib/commerce/providers/woocommerce'
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
  platform: 'tiendanube' | 'woocommerce'
  orders: ShopifyOrder[]
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
  if (!tienda || tienda.platform === 'shopify') return null

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
    email: p.contact_email ?? undefined,
    phone: p.contact_phone ?? undefined,
    total_price: p.total ?? '0',
    currency: p.currency ?? undefined,
    created_at: p.created_at ?? new Date(0).toISOString(),
    discount_codes: (p.coupon ?? []).map((c) => ({ code: c.code })),
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
  total?: string
  currency?: string
  date_created?: string
  coupon_lines?: { code?: string }[]
  billing?: { email?: string; phone?: string }
  shipping?: { phone?: string }
}

function deWoo(p: PedidoWoo): ShopifyOrder {
  const correo = p.billing?.email ?? undefined
  const tel = p.billing?.phone ?? undefined
  return {
    id: p.id ?? 0,
    email: correo,
    phone: tel,
    total_price: p.total ?? '0',
    currency: p.currency ?? undefined,
    // WooCommerce manda la fecha en la zona de la tienda y sin sufijo. Se
    // asume UTC: sin esto, `Date.parse` la interpreta en la zona del servidor
    // y un pedido puede caer en la ventana equivocada.
    created_at: normalizarFecha(p.date_created),
    discount_codes: (p.coupon_lines ?? []).map((c) => ({ code: c.code })),
    contact_email: correo ?? null,
    customer: { email: correo ?? null, phone: tel ?? null },
    shipping_address: p.shipping?.phone ? { phone: p.shipping.phone } : null,
    billing_address: tel ? { phone: tel } : null,
  }
}

function normalizarFecha(v: string | undefined): string {
  if (!v) return new Date(0).toISOString()
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v}Z`
}
