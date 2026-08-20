import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContactPurchase, ContactPurchaseSummary } from '@/types'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'

/**
 * Historial de compras del contacto — el que se acumula y no se pisa.
 *
 * El resumen que trae la tienda (cuántos pedidos, cuánto gastó) es exacto pero
 * mudo: dice "3 pedidos" y no dice cuáles. El detalle, en cambio, Shopify sólo
 * lo entrega hasta 60 días atrás si el comercio no otorgó `read_all_orders`,
 * así que la única forma de tener el historial completo es guardarlo a medida
 * que pasa. Eso hace este módulo: cada pedido que Riverz ve —por webhook, por
 * la sincronización nocturna o por un backfill— queda escrito en
 * `contact_purchases` con su id de la plataforma como clave.
 *
 * Los dos números conviven en la ficha sin contradecirse: el resumen de la
 * tienda es el total de la vida del cliente, y las filas de acá son lo que
 * Riverz puede mostrar en detalle. Cuando el primero es mayor, la ficha lo
 * dice en vez de fingir que el cliente compró menos.
 */

/** Un pedido listo para guardar. Todo opcional salvo su identidad. */
export interface PurchaseInput {
  platform: 'shopify' | 'tiendanube' | 'woocommerce' | 'mercadolibre'
  shopDomain?: string | null
  /** Id del pedido en la plataforma. */
  externalId: string | number
  orderNumber?: string | null
  placedAt?: string | null
  currency?: string | null
  total?: string | number | null
  financialStatus?: string | null
  fulfillmentStatus?: string | null
  lineItems?: Array<{
    title?: string | null
    quantity?: number | null
    price?: string | number | null
  }>
  customerEmail?: string | null
  customerPhone?: string | null
  contactId?: string | null
}

function toNumber(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function row(workspaceId: string, p: PurchaseInput): Record<string, unknown> {
  return {
    workspace_id: workspaceId,
    contact_id: p.contactId ?? null,
    platform: p.platform,
    shop_domain: p.shopDomain ?? null,
    external_id: String(p.externalId),
    order_number: p.orderNumber ?? null,
    placed_at: p.placedAt ?? null,
    currency: p.currency ?? null,
    total: toNumber(p.total),
    financial_status: p.financialStatus ?? null,
    fulfillment_status: p.fulfillmentStatus ?? null,
    line_items: (p.lineItems ?? [])
      .map((li) => ({
        title: (li.title ?? '').trim(),
        quantity: Number(li.quantity) || 1,
        price: toNumber(li.price ?? null),
      }))
      .filter((li) => li.title),
    customer_email: p.customerEmail?.trim().toLowerCase() || null,
    customer_phone: p.customerPhone ? normalizePhone(p.customerPhone) || null : null,
    updated_at: new Date().toISOString(),
  }
}

/**
 * Guarda (o actualiza) pedidos del historial. Corre con la clave de servicio.
 *
 * El upsert por (workspace, plataforma, id externo) es lo que permite que los
 * tres caminos de escritura pisen la misma fila en vez de multiplicar el
 * historial. Nunca borra: un pedido que la tienda ya no deja leer sigue acá.
 *
 * `contact_id` no se pisa con null — un pedido de invitado guardado antes de
 * conocer al contacto conserva el vínculo cuando después se lo enganche.
 */
export async function recordPurchases(
  admin: SupabaseClient,
  workspaceId: string,
  purchases: PurchaseInput[],
): Promise<number> {
  const rows = purchases
    .filter((p) => p.externalId != null && String(p.externalId).trim() !== '')
    .map((p) => row(workspaceId, p))
  if (rows.length === 0) return 0

  // Sin contacto conocido no se toca la columna, para no desvincular un pedido
  // que otro camino ya emparejó.
  const withContact = rows.filter((r) => r.contact_id)
  const withoutContact = rows
    .filter((r) => !r.contact_id)
    .map((r) => {
      const rest = { ...r }
      delete rest.contact_id
      return rest
    })

  let saved = 0
  for (const batch of [withContact, withoutContact]) {
    if (batch.length === 0) continue
    const { error } = await admin
      .from('contact_purchases')
      .upsert(batch, { onConflict: 'workspace_id,platform,external_id' })
    if (error) {
      console.error('[contacts/purchases] upsert falló:', error.message)
      continue
    }
    saved += batch.length
  }
  return saved
}

/**
 * Engancha al contacto los pedidos de invitado que quedaron sueltos.
 *
 * Quien compra sin cuenta no genera cliente en la tienda: su pedido llega con
 * email y teléfono y nada más. Cuando esa persona después escribe —y se le
 * crea el contacto— este llamado le devuelve su historial.
 */
export async function linkOrphanPurchases(
  admin: SupabaseClient,
  workspaceId: string,
  contact: { id: string; email?: string | null; phone?: string | null },
): Promise<number> {
  const email = contact.email?.trim().toLowerCase() || null
  const phone = contact.phone ? normalizePhone(contact.phone) : ''
  const claims: Array<[string, string]> = []
  if (email) claims.push(['customer_email', email])
  if (phone.length >= 8) claims.push(['customer_phone', phone])
  if (claims.length === 0) return 0

  let linked = 0
  for (const [column, value] of claims) {
    const { data, error } = await admin
      .from('contact_purchases')
      .update({ contact_id: contact.id, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .is('contact_id', null)
      .eq(column, value)
      .select('id')
    if (error) {
      console.error('[contacts/purchases] enganche falló:', error.message)
      continue
    }
    linked += (data ?? []).length
  }
  return linked
}

/**
 * Un pedido crudo de Shopify (el cuerpo del webhook) traducido al historial.
 *
 * Se guarda aunque no sepamos todavía a qué contacto pertenece: el email y el
 * teléfono viajan en la fila y `linkOrphanPurchases` los engancha después.
 * Perder el pedido porque el comprador aún no es contacto sería perderlo para
 * siempre — Shopify no lo vuelve a mandar.
 */
export function shopifyOrderToPurchase(
  shopDomain: string,
  order: Record<string, unknown>,
  contactId?: string | null,
): PurchaseInput | null {
  const externalId = String(order.id ?? '').trim()
  if (!externalId) return null
  const customer = (order.customer ?? {}) as Record<string, unknown>
  const shipping = (order.shipping_address ?? {}) as Record<string, unknown>
  const lineItems = Array.isArray(order.line_items)
    ? (order.line_items as Array<Record<string, unknown>>)
    : []
  return {
    platform: 'shopify',
    shopDomain,
    externalId,
    orderNumber: (order.name as string) ?? null,
    placedAt: (order.created_at as string) ?? null,
    currency: (order.currency as string) ?? null,
    total: (order.total_price as string) ?? null,
    financialStatus: (order.financial_status as string) ?? null,
    fulfillmentStatus: (order.fulfillment_status as string) ?? null,
    lineItems: lineItems.map((li) => ({
      title: (li.title as string) ?? '',
      quantity: Number(li.quantity) || 1,
      price: (li.price as string) ?? null,
    })),
    customerEmail:
      (order.email as string) ?? (customer.email as string) ?? null,
    customerPhone:
      (order.phone as string) ??
      (customer.phone as string) ??
      (shipping.phone as string) ??
      null,
    contactId: contactId ?? null,
  }
}

/** Historial del contacto, del más nuevo al más viejo. */
export async function loadContactPurchases(
  db: SupabaseClient,
  contactId: string,
  limit = 50,
): Promise<ContactPurchase[]> {
  const { data, error } = await db
    .from('contact_purchases')
    .select('*')
    .eq('contact_id', contactId)
    .order('placed_at', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (error) {
    console.error('[contacts/purchases] lectura falló:', error.message)
    return []
  }
  return (data ?? []) as ContactPurchase[]
}

/**
 * Las cuentas de la ficha.
 *
 * `storeOrdersCount` / `storeTotalSpent` son lo que informa la tienda sobre
 * toda la vida del cliente; el resto sale de los pedidos guardados. Se
 * devuelven los dos porque decir sólo uno miente en algún caso: el de la
 * tienda no tiene detalle, y el guardado empieza el día de la conexión.
 */
export function summarizePurchases(
  purchases: ContactPurchase[],
  store?: { ordersCount?: number | null; totalSpent?: number | null; currency?: string | null },
): ContactPurchaseSummary {
  const dated = purchases
    .filter((p) => p.placed_at)
    .map((p) => new Date(p.placed_at as string).getTime())
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b)

  const totals = purchases
    .map((p) => Number(p.total))
    .filter((n) => Number.isFinite(n) && n > 0)
  const recordedSpent = totals.reduce((sum, n) => sum + n, 0)

  const storeOrders = Number(store?.ordersCount)
  const storeSpent = Number(store?.totalSpent)
  const ordersCount = Number.isFinite(storeOrders)
    ? Math.max(storeOrders, purchases.length)
    : purchases.length
  const totalSpent = Number.isFinite(storeSpent) && storeSpent > 0 ? storeSpent : recordedSpent

  const units = new Map<string, number>()
  for (const p of purchases) {
    for (const li of p.line_items ?? []) {
      const title = (li.title ?? '').trim()
      if (!title) continue
      units.set(title, (units.get(title) ?? 0) + (Number(li.quantity) || 1))
    }
  }

  const lastAt = dated.length > 0 ? new Date(dated[dated.length - 1]).toISOString() : null

  return {
    ordersCount,
    recordedCount: purchases.length,
    /** Pedidos que la tienda cuenta y Riverz no puede detallar todavía. */
    missingDetail: Math.max(0, ordersCount - purchases.length),
    totalSpent,
    currency:
      purchases.find((p) => p.currency)?.currency ?? store?.currency ?? null,
    averageOrder: ordersCount > 0 && totalSpent > 0 ? totalSpent / ordersCount : null,
    firstPurchaseAt: dated.length > 0 ? new Date(dated[0]).toISOString() : null,
    lastPurchaseAt: lastAt,
    daysSinceLast:
      lastAt == null
        ? null
        : Math.max(
            0,
            Math.floor((Date.now() - new Date(lastAt).getTime()) / (24 * 60 * 60 * 1000)),
          ),
    isRepeat: ordersCount >= 2,
    topProducts: [...units.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([title, quantity]) => ({ title, quantity })),
  }
}
