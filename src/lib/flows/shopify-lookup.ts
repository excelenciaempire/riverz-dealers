import { supabaseAdmin } from './admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { ShopifyAdminClient } from '@/lib/shopify/admin-client'
import { resolveCarrierTrackingUrl } from '@/lib/shopify/carrier-tracking'
import type { ShopifyLookupKind } from './types'

/**
 * Server-side helper invoked by the flows `shopify_lookup` node.
 *
 * Resolves the workspace's connected Shopify store + Admin API token,
 * runs the appropriate lookup, and returns a flat key/value map the
 * runner can flatten into flow_runs.vars under the node's
 * `output_prefix`.
 *
 * Returns `found: false` instead of throwing for every "not found"
 * case (missing connection, no matching order, malformed input). The
 * runner branches the customer to `not_found_next_key` in those cases,
 * which is almost always the right UX.
 */
export async function runShopifyLookup(args: {
  userId: string
  workspaceId?: string | null
  contactId: string
  kind: ShopifyLookupKind
  input: string
}): Promise<{ found: boolean; vars?: Record<string, string> }> {
  const db = supabaseAdmin()

  // Resolve the connected store + decrypted token. Prefer workspace_id
  // (migration 055); fall back to the legacy user_id lookup for callers
  // that haven't been updated yet.
  let conn: { shop_domain: string; access_token: string } | null = null
  if (args.workspaceId) {
    const { data } = await db
      .from('shopify_connections')
      .select('shop_domain, access_token')
      .eq('platform', 'shopify')
      .eq('workspace_id', args.workspaceId)
      .eq('status', 'active')
      .order('installed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    conn = data as { shop_domain: string; access_token: string } | null
  }
  if (!conn) {
    const { data } = await db
      .from('shopify_connections')
      .select('shop_domain, access_token')
      .eq('platform', 'shopify')
      .eq('user_id', args.userId)
      .eq('status', 'active')
      .order('installed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    conn = data as { shop_domain: string; access_token: string } | null
  }
  if (!conn) return { found: false }
  const client = new ShopifyAdminClient(conn.shop_domain, decrypt(conn.access_token))

  // Pull the contact's email/phone for kinds that resolve by contact.
  const { data: contact } = await db
    .from('contacts')
    .select('email, phone')
    .eq('id', args.contactId)
    .maybeSingle()
  const contactRow = contact as { email: string | null; phone: string | null } | null

  switch (args.kind) {
    case 'order_by_number':
      return lookupOrderByNumber(client, args.input)
    case 'order_by_email':
      return lookupOrderByEmail(client, args.input)
    case 'last_order': {
      const email = contactRow?.email
      if (email) {
        const r = await lookupOrderByEmail(client, email)
        if (r.found) return r
      }
      const phone = contactRow?.phone
      if (phone) return lookupOrderByPhone(client, phone)
      return { found: false }
    }
    case 'product_by_handle':
      return lookupProductByHandle(client, args.input)
    default:
      return { found: false }
  }
}

interface ShopifyOrder {
  name?: string
  order_number?: number
  email?: string
  financial_status?: string
  fulfillment_status?: string | null
  total_price?: string
  currency?: string
  created_at?: string
  order_status_url?: string
  line_items?: { title?: string; quantity?: number }[]
  fulfillments?: { tracking_number?: string; tracking_url?: string; tracking_company?: string }[]
}

interface ShopifyProduct {
  title?: string
  handle?: string
  body_html?: string
  vendor?: string
  product_type?: string
  variants?: { price?: string }[]
  image?: { src?: string }
}

async function lookupOrderByNumber(
  client: ShopifyAdminClient,
  raw: string,
): Promise<{ found: boolean; vars?: Record<string, string> }> {
  const num = raw.replace(/[^0-9]/g, '')
  if (!num) return { found: false }
  // Shopify REST: /orders.json?name=#1042 is the cheapest path to find by visible number.
  const body = await client
    .rest<{ orders: ShopifyOrder[] }>(
      `/orders.json?name=${encodeURIComponent('#' + num)}&status=any&limit=1`,
    )
    .catch(() => ({ orders: [] as ShopifyOrder[] }))
  return body.orders.length ? { found: true, vars: orderToVars(body.orders[0]) } : { found: false }
}

async function lookupOrderByEmail(
  client: ShopifyAdminClient,
  email: string,
): Promise<{ found: boolean; vars?: Record<string, string> }> {
  if (!email) return { found: false }
  const body = await client
    .rest<{ orders: ShopifyOrder[] }>(
      `/orders.json?email=${encodeURIComponent(email)}&status=any&limit=1`,
    )
    .catch(() => ({ orders: [] as ShopifyOrder[] }))
  return body.orders.length ? { found: true, vars: orderToVars(body.orders[0]) } : { found: false }
}

async function lookupOrderByPhone(
  client: ShopifyAdminClient,
  phone: string,
): Promise<{ found: boolean; vars?: Record<string, string> }> {
  // Shopify doesn't support /orders?phone= directly — search by phone on
  // customer first, then list their orders.
  const cust = await client
    .rest<{ customers: { id: number }[] }>(
      `/customers/search.json?query=${encodeURIComponent(`phone:${phone}`)}`,
    )
    .catch(() => ({ customers: [] as { id: number }[] }))
  const customerId = cust.customers[0]?.id
  if (!customerId) return { found: false }
  const body = await client
    .rest<{ orders: ShopifyOrder[] }>(
      `/customers/${customerId}/orders.json?status=any&limit=1`,
    )
    .catch(() => ({ orders: [] as ShopifyOrder[] }))
  return body.orders.length ? { found: true, vars: orderToVars(body.orders[0]) } : { found: false }
}

async function lookupProductByHandle(
  client: ShopifyAdminClient,
  handle: string,
): Promise<{ found: boolean; vars?: Record<string, string> }> {
  if (!handle) return { found: false }
  const body = await client
    .rest<{ products: ShopifyProduct[] }>(
      `/products.json?handle=${encodeURIComponent(handle)}&limit=1`,
    )
    .catch(() => ({ products: [] as ShopifyProduct[] }))
  const p = body.products[0]
  if (!p) return { found: false }
  const prices = (p.variants ?? []).map((v) => Number(v.price)).filter(Number.isFinite)
  return {
    found: true,
    vars: {
      title: String(p.title ?? ''),
      handle: String(p.handle ?? ''),
      vendor: String(p.vendor ?? ''),
      type: String(p.product_type ?? ''),
      price: prices.length ? `$${Math.min(...prices)}` : '',
      image_url: String(p.image?.src ?? ''),
    },
  }
}

function orderToVars(o: ShopifyOrder): Record<string, string> {
  const tracking = (o.fulfillments ?? []).slice(-1)[0]
  const trackingNumber = String(tracking?.tracking_number ?? '')
  const trackingCompany = String(tracking?.tracking_company ?? '')
  const trackingUrl = String(tracking?.tracking_url ?? '')
  return {
    name: String(o.name ?? ''),
    number: String(o.order_number ?? ''),
    email: String(o.email ?? ''),
    financial_status: String(o.financial_status ?? ''),
    fulfillment_status: String(o.fulfillment_status ?? 'unfulfilled'),
    total: o.total_price ? `${o.total_price} ${o.currency ?? ''}`.trim() : '',
    status_url: String(o.order_status_url ?? ''),
    tracking_number: trackingNumber,
    // Fall back to our carrier resolver for AR carriers Shopify doesn't
    // auto-fill (Andreani / Correo Argentino / OCA). Keeps existing
    // {{tracking_url}} templates working unchanged.
    tracking_url:
      trackingUrl ||
      resolveCarrierTrackingUrl(trackingCompany, trackingNumber) ||
      '',
    tracking_company: trackingCompany,
    item_count: String((o.line_items ?? []).length),
    first_item: String(o.line_items?.[0]?.title ?? ''),
  }
}
