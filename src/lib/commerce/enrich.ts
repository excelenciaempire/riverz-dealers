import type { SupabaseClient } from '@supabase/supabase-js'
import type { Contact, ShopifyCustomerSnapshot } from '@/types'
import { TiendanubeClient } from '@/lib/commerce/providers/tiendanube'
import { WooCommerceClient } from '@/lib/commerce/providers/woocommerce'
import { phonesMatch } from '@/lib/whatsapp/phone-utils'
import { resolveStoreForLookup } from './order-lookup'

/**
 * Ficha del cliente en la tienda — para Tiendanube y WooCommerce.
 *
 * Es el gemelo de `lib/contacts/enrich.ts`, que sólo sabía hablar con
 * Shopify. Un comercio de Tiendanube veía la ficha de sus contactos vacía:
 * sin dirección, sin cuánto gastaron, sin cuántas veces compraron. Eso no es
 * un detalle cosmético — es lo que el asistente usa para reconocer a un
 * cliente que vuelve, y lo que el comercio mira antes de escribirle.
 *
 * Escribe en las MISMAS columnas que el camino de Shopify
 * (`shopify_customer_data`, `shopify_data_synced_at`, `is_shopify_customer`),
 * porque todo lo que lee esa ficha —el prompt del agente, la tabla de
 * contactos, los segmentos— ya sabe leerlas. El nombre de las columnas
 * arrastra "shopify" por historia; su significado es "la tienda conectada".
 *
 * Fail-soft en todo: si la API no contesta, el contacto queda como estaba.
 * Media ficha es peor que ninguna sólo cuando miente, y acá no se escribe
 * nada hasta tener la respuesta completa.
 */

const TTL_MS = 24 * 60 * 60 * 1000

export async function enrichContactFromStore(
  db: SupabaseClient,
  contact: Contact,
  opts?: { force?: boolean },
): Promise<ShopifyCustomerSnapshot | null> {
  if (!contact.workspace_id) return null

  // Cache de 24 h, igual que Shopify: la ficha de un cliente no cambia entre
  // dos mensajes de la misma conversación, y cada consulta cuesta cupo de la
  // API del comercio.
  if (!opts?.force && contact.shopify_data_synced_at) {
    const edad = Date.now() - Date.parse(contact.shopify_data_synced_at)
    if (Number.isFinite(edad) && edad < TTL_MS) {
      return (contact.shopify_customer_data as ShopifyCustomerSnapshot) ?? null
    }
  }

  const tienda = await resolveStoreForLookup(db, contact.workspace_id)
  if (!tienda || tienda.platform === 'shopify') return null

  try {
    const snapshot =
      tienda.platform === 'tiendanube'
        ? await desdeTiendanube(tienda, contact)
        : await desdeWoo(tienda, contact)

    await db
      .from('contacts')
      .update({
        shopify_customer_data: snapshot,
        shopify_data_synced_at: new Date().toISOString(),
        // Sólo lo marcamos como cliente si de verdad apareció en la tienda:
        // marcar a todo el mundo rompería los segmentos de "ya compró".
        ...(snapshot ? { is_shopify_customer: true } : {}),
      })
      .eq('id', contact.id)

    return snapshot
  } catch {
    return null
  }
}

// ── Tiendanube ───────────────────────────────────────────────────────────

interface ClienteTn {
  id?: number
  email?: string
  phone?: string
  total_spent?: string
  last_order_id?: number
  created_at?: string
  default_address?: {
    address?: string
    floor?: string
    city?: string
    province?: string
    country?: string
    zipcode?: string
  }
  billing_address?: Record<string, string>
}

async function desdeTiendanube(
  tienda: NonNullable<Awaited<ReturnType<typeof resolveStoreForLookup>>>,
  contact: Contact,
): Promise<ShopifyCustomerSnapshot | null> {
  if (!tienda.externalStoreId) return null
  const client = new TiendanubeClient(
    tienda.externalStoreId,
    tienda.accessToken,
    tienda.shopDomain,
  )

  // Se busca por correo primero: es exacto. El teléfono se compara después
  // con `phonesMatch`, que tolera prefijos y separadores — el mismo número
  // llega con formatos distintos según por dónde entró.
  const termino = contact.email || contact.phone
  if (!termino) return null
  const clientes = await client.get<ClienteTn[]>(
    `/customers?q=${encodeURIComponent(termino)}&per_page=10`,
  )
  const lista = Array.isArray(clientes) ? clientes : []
  const cliente = contact.email
    ? lista.find((c) => c.email?.toLowerCase() === contact.email?.toLowerCase())
    : lista.find((c) => c.phone && phonesMatch(c.phone, contact.phone ?? ''))
  if (!cliente?.id) return null

  const pedidos = await client
    .get<
      Array<{
        number?: number
        total?: string
        currency?: string
        created_at?: string
        products?: { name?: string | Record<string, string> }[]
      }>
    >(`/orders?customer_ids=${cliente.id}&per_page=10`)
    .catch(() => [])
  const listaPedidos = Array.isArray(pedidos) ? pedidos : []

  const dir = cliente.default_address ?? {}
  return {
    customer_id: String(cliente.id),
    total_spent: Number(cliente.total_spent ?? 0) || 0,
    currency: listaPedidos[0]?.currency ?? undefined,
    orders_count: listaPedidos.length,
    last_order_date: listaPedidos[0]?.created_at ?? null,
    tags: [],
    default_address: {
      address1: dir.address ?? null,
      address2: dir.floor ?? null,
      city: dir.city ?? null,
      province: dir.province ?? null,
      country: dir.country ?? null,
      zip: dir.zipcode ?? null,
    },
    lifetime_orders: listaPedidos.slice(0, 10).map((p) => ({
      name: p.number != null ? `#${p.number}` : '',
      total_price: p.total ?? '',
      line_items_titles: (p.products ?? [])
        .map((li) =>
          typeof li.name === 'string'
            ? li.name
            : li.name?.es || li.name?.pt || li.name?.en || '',
        )
        .filter(Boolean),
    })),
  }
}

// ── WooCommerce ──────────────────────────────────────────────────────────

interface ClienteWoo {
  id?: number
  email?: string
  billing?: {
    phone?: string
    address_1?: string
    address_2?: string
    city?: string
    state?: string
    country?: string
    postcode?: string
  }
}

async function desdeWoo(
  tienda: NonNullable<Awaited<ReturnType<typeof resolveStoreForLookup>>>,
  contact: Contact,
): Promise<ShopifyCustomerSnapshot | null> {
  if (!tienda.apiSecret) return null
  const client = new WooCommerceClient(
    tienda.shopDomain,
    tienda.accessToken,
    tienda.apiSecret,
  )

  const termino = contact.email || contact.phone
  if (!termino) return null
  const clientes = await client.get<ClienteWoo[]>('/customers', {
    search: termino,
    per_page: 10,
  })
  const lista = Array.isArray(clientes) ? clientes : []
  const cliente = contact.email
    ? lista.find((c) => c.email?.toLowerCase() === contact.email?.toLowerCase())
    : lista.find(
        (c) => c.billing?.phone && phonesMatch(c.billing.phone, contact.phone ?? ''),
      )
  if (!cliente?.id) return null

  const pedidos = await client
    .get<
      Array<{
        number?: string
        total?: string
        currency?: string
        date_created?: string
        line_items?: { name?: string }[]
      }>
    >('/orders', { customer: cliente.id, per_page: 10 })
    .catch(() => [])
  const listaPedidos = Array.isArray(pedidos) ? pedidos : []

  const b = cliente.billing ?? {}
  const gastado = listaPedidos.reduce(
    (suma, p) => suma + (Number(p.total) || 0),
    0,
  )
  return {
    customer_id: String(cliente.id),
    total_spent: gastado,
    currency: listaPedidos[0]?.currency ?? undefined,
    orders_count: listaPedidos.length,
    last_order_date: listaPedidos[0]?.date_created ?? null,
    tags: [],
    default_address: {
      address1: b.address_1 ?? null,
      address2: b.address_2 ?? null,
      city: b.city ?? null,
      province: b.state ?? null,
      country: b.country ?? null,
      zip: b.postcode ?? null,
    },
    lifetime_orders: listaPedidos.slice(0, 10).map((p) => ({
      name: p.number ? `#${p.number}` : '',
      total_price: p.total ?? '',
      line_items_titles: (p.line_items ?? [])
        .map((li) => li.name ?? '')
        .filter(Boolean),
    })),
  }
}
