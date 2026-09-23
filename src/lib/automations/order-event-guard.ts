import type { SupabaseClient } from '@supabase/supabase-js'

type OrderLine = {
  title?: unknown
  quantity?: unknown
}

type MirroredOrder = {
  shopify_order_id?: string | null
  shop_domain?: string | null
  created_at?: string | null
  total_price?: number | string | null
  currency?: string | null
  status?: string | null
  fulfillment_status?: string | null
  tracking_number?: string | null
  line_items?: OrderLine[] | null
}

const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000
const TERMINAL_STATUSES = new Set(['cancelled', 'failed', 'refunded'])

function itemFingerprint(lines: OrderLine[] | null | undefined): string {
  const quantities = new Map<string, number>()
  for (const line of lines ?? []) {
    const title = String(line.title ?? '').trim().toLocaleLowerCase('es')
    const quantity = Number(line.quantity ?? 0)
    if (!title || !Number.isFinite(quantity) || quantity <= 0) continue
    quantities.set(title, (quantities.get(title) ?? 0) + quantity)
  }
  return [...quantities.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([title, quantity]) => `${title}:${quantity}`)
    .join('|')
}

function samePurchase(a: MirroredOrder, b: MirroredOrder): boolean {
  const aCreated = Date.parse(String(a.created_at ?? ''))
  const bCreated = Date.parse(String(b.created_at ?? ''))
  if (
    !Number.isFinite(aCreated) ||
    !Number.isFinite(bCreated) ||
    Math.abs(aCreated - bCreated) > DUPLICATE_WINDOW_MS
  ) {
    return false
  }

  const aTotal = Number(a.total_price)
  const bTotal = Number(b.total_price)
  if (!Number.isFinite(aTotal) || !Number.isFinite(bTotal) || aTotal !== bTotal) {
    return false
  }
  if (String(a.currency ?? '') !== String(b.currency ?? '')) return false

  const aItems = itemFingerprint(a.line_items)
  const bItems = itemFingerprint(b.line_items)
  return Boolean(aItems) && aItems === bItems
}

/**
 * Shopify can contain an administrative duplicate that is cancelled after the
 * real order has already continued. Announcing that cancellation makes the
 * customer believe the fulfilled purchase was stopped. Suppress only a
 * high-confidence duplicate: same contact, store, amount, product quantities
 * and a 24-hour window, while the sibling order remains active.
 */
export async function supersededCancellationReason(
  db: SupabaseClient,
  input: {
    workspaceId: string
    contactId: string | null | undefined
    orderId: string | null | undefined
  },
): Promise<string | null> {
  const contactId = input.contactId?.trim()
  const orderId = input.orderId?.trim()
  if (!contactId || !orderId) return null

  const { data, error } = await db
    .from('orders')
    .select(
      'shopify_order_id, shop_domain, created_at, total_price, currency, status, fulfillment_status, tracking_number, line_items',
    )
    .eq('workspace_id', input.workspaceId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error || !data?.length) return null
  const orders = data as MirroredOrder[]
  const cancelled = orders.find(
    (order) => String(order.shopify_order_id ?? '') === orderId,
  )
  if (!cancelled || String(cancelled.status ?? '').toLowerCase() !== 'cancelled') {
    return null
  }

  const replacement = orders.find((order) => {
    if (String(order.shopify_order_id ?? '') === orderId) return false
    if (order.shop_domain !== cancelled.shop_domain) return false
    if (TERMINAL_STATUSES.has(String(order.status ?? '').toLowerCase())) {
      return false
    }
    return samePurchase(cancelled, order)
  })

  return replacement ? 'cancelled_duplicate_has_active_order' : null
}

