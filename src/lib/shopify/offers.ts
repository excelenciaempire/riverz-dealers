import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Derives WHICH offer the customer chose in this order/checkout, by NUMBER OF
 * UNITS. Matches the order's total units against the offers configured (with
 * `units`) on the products in the order — `shopify_products.allowed_offers`,
 * editable in the Productos section. Falls back to
 * `workspace_checkout_config.offers` (field `qty`) for workspaces that use the
 * assistant checkout.
 *
 * Returns the offer label + total units. If no offer matches the units,
 * `label` is empty (but `units` is still reported, e.g. for stores without
 * fixed offers). Shared by the live orders webhook and the historical backfill.
 */
export async function resolveOfferChosen(
  admin: SupabaseClient,
  workspaceId: string,
  order: Record<string, unknown>,
): Promise<{ label: string; units: number; entitledUnits?: number }> {
  const lineItems = Array.isArray(order.line_items)
    ? (order.line_items as Record<string, unknown>[])
    : []
  const totalUnits = lineItems.reduce(
    (sum, li) => sum + unitsActivas(li),
    0,
  )
  if (totalUnits <= 0) return { label: '', units: 0 }

  const candidates: { label: string; units: number; total?: number }[] = []

  // 1) Per-product offers (allowed_offers with `units`) for the products in
  //    the order. external_id = Shopify product_id.
  const productIds = [
    ...new Set(
      lineItems
        .map((li) => (li.product_id != null ? String(li.product_id) : ''))
        .filter(Boolean),
    ),
  ]
  if (productIds.length > 0) {
    const { data } = await admin
      .from('shopify_products')
      .select('allowed_offers')
      .eq('workspace_id', workspaceId)
      .in('external_id', productIds)
    for (const row of data ?? []) {
      const offers = Array.isArray(
        (row as Record<string, unknown>).allowed_offers,
      )
        ? ((row as Record<string, unknown>)
            .allowed_offers as Record<string, unknown>[])
        : []
      for (const o of offers) {
        const units = Number(o?.units)
        if (Number.isFinite(units) && units > 0)
          candidates.push({
            label: String(o?.label ?? ''),
            units,
            total: precioOferta(o?.total),
          })
      }
    }
  }

  // 2) Fallback: assistant-checkout offers (field `qty`).
  if (!candidates.some((c) => c.units === totalUnits)) {
    const { data: cfg } = await admin
      .from('workspace_checkout_config')
      .select('offers')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    const offers = Array.isArray(
      (cfg as Record<string, unknown> | null)?.offers,
    )
      ? ((cfg as Record<string, unknown>).offers as Record<string, unknown>[])
      : []
    for (const o of offers) {
      const units = Number(o?.qty)
      if (Number.isFinite(units) && units > 0)
        candidates.push({
          label: String(o?.label ?? ''),
          units,
          total: precioOferta(o?.total),
        })
    }
  }

  const orderTotal = precioOferta(order.current_total_price ?? order.total_price)
  const entitlement =
    orderTotal == null
      ? null
      : candidates
          .filter(
            (candidate) =>
              candidate.label &&
              candidate.total != null &&
              Math.abs(candidate.total - orderTotal) < 0.01,
          )
          .sort((a, b) => b.units - a.units)[0] ?? null
  const match = entitlement ?? candidates.find((c) => c.units === totalUnits && c.label)
  return {
    label: match?.label ?? '',
    units: totalUnits,
    ...(entitlement && entitlement.units > totalUnits
      ? { entitledUnits: entitlement.units }
      : {}),
  }
}

/**
 * Offer configuration loaded ONCE per workspace (productId → offers + the
 * assistant-checkout offers), so the historical backfill resolves each
 * order's offer in memory instead of querying the DB per order. The live
 * webhook keeps using `resolveOfferChosen` (single order, fine to query).
 */
export interface OfferConfig {
  productOffers: Map<string, { label: string; units: number }[]>
  checkoutOffers: { label: string; units: number }[]
}

export async function loadOfferConfig(
  admin: SupabaseClient,
  workspaceId: string,
): Promise<OfferConfig> {
  const productOffers = new Map<string, { label: string; units: number }[]>()
  const { data: prods } = await admin
    .from('shopify_products')
    .select('external_id, allowed_offers')
    .eq('workspace_id', workspaceId)
  for (const row of prods ?? []) {
    const r = row as Record<string, unknown>
    const offers = Array.isArray(r.allowed_offers)
      ? (r.allowed_offers as Record<string, unknown>[])
      : []
    const list = offers
      .map((o) => ({ label: String(o?.label ?? ''), units: Number(o?.units) }))
      .filter((o) => Number.isFinite(o.units) && o.units > 0)
    if (r.external_id != null) productOffers.set(String(r.external_id), list)
  }

  const { data: cfg } = await admin
    .from('workspace_checkout_config')
    .select('offers')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const rawOffers = Array.isArray((cfg as Record<string, unknown> | null)?.offers)
    ? ((cfg as Record<string, unknown>).offers as Record<string, unknown>[])
    : []
  const checkoutOffers = rawOffers
    .map((o) => ({ label: String(o?.label ?? ''), units: Number(o?.qty) }))
    .filter((o) => Number.isFinite(o.units) && o.units > 0)

  return { productOffers, checkoutOffers }
}

/** Pure, in-memory equivalent of `resolveOfferChosen` using a preloaded config. */
export function resolveOfferFromConfig(
  order: Record<string, unknown>,
  config: OfferConfig,
): { label: string; units: number } {
  const lineItems = Array.isArray(order.line_items)
    ? (order.line_items as Record<string, unknown>[])
    : []
  const totalUnits = lineItems.reduce(
    (sum, li) => sum + unitsActivas(li),
    0,
  )
  if (totalUnits <= 0) return { label: '', units: 0 }

  const candidates: { label: string; units: number }[] = []
  const productIds = [
    ...new Set(
      lineItems
        .map((li) => (li.product_id != null ? String(li.product_id) : ''))
        .filter(Boolean),
    ),
  ]
  for (const pid of productIds) {
    for (const o of config.productOffers.get(pid) ?? []) candidates.push(o)
  }
  if (!candidates.some((c) => c.units === totalUnits)) {
    for (const o of config.checkoutOffers) candidates.push(o)
  }
  const match = candidates.find((c) => c.units === totalUnits && c.label)
  return { label: match?.label ?? '', units: totalUnits }
}

/** Shopify conserva las líneas eliminadas después de editar un pedido. */
function unitsActivas(lineItem: Record<string, unknown>): number {
  const raw = lineItem.current_quantity ?? lineItem.quantity
  const units = Number(raw)
  return Number.isFinite(units) && units > 0 ? units : 0
}

function precioOferta(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : undefined
  if (typeof raw !== 'string') return undefined
  const normalized = raw.trim().replace(/[^\d.,-]/g, '')
  if (!normalized) return undefined
  let value = normalized
  if (value.includes(',') && value.includes('.')) {
    value =
      value.lastIndexOf(',') > value.lastIndexOf('.')
        ? value.replace(/\./g, '').replace(',', '.')
        : value.replace(/,/g, '')
  } else if (value.includes(',')) {
    value = /,\d{1,2}$/.test(value) ? value.replace(',', '.') : value.replace(/,/g, '')
  } else if ((value.match(/\./g) ?? []).length > 1 || /\.\d{3}$/.test(value)) {
    value = value.replace(/\./g, '')
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}
