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
): Promise<{ label: string; units: number }> {
  const lineItems = Array.isArray(order.line_items)
    ? (order.line_items as Record<string, unknown>[])
    : []
  const totalUnits = lineItems.reduce(
    (sum, li) => sum + (Number(li.quantity) || 0),
    0,
  )
  if (totalUnits <= 0) return { label: '', units: 0 }

  const candidates: { label: string; units: number }[] = []

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
          candidates.push({ label: String(o?.label ?? ''), units })
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
        candidates.push({ label: String(o?.label ?? ''), units })
    }
  }

  const match = candidates.find((c) => c.units === totalUnits && c.label)
  return { label: match?.label ?? '', units: totalUnits }
}
