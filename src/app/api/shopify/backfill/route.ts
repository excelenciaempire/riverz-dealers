import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { safeSecretEqual } from '@/lib/auth/cron'
import { decrypt } from '@/lib/whatsapp/encryption'
import { ShopifyAdminClient, nextPageInfo } from '@/lib/shopify/admin-client'
import {
  extractShopifyLegacyPhone,
  extractShopifyName,
  extractShopifyPhone,
  upsertWhatsappContact,
} from '@/lib/shopify/contact-upsert'
import {
  loadOfferConfig,
  resolveOfferFromConfig,
  type OfferConfig,
} from '@/lib/shopify/offers'
import { applyCategoryTags } from '@/lib/contacts/tags'

/**
 * Historical Shopify backfill — "extrae todos los contactos desde que abrió la
 * tienda y categorízalos".
 *
 * Walks ALL orders (newest-first) + abandoned checkouts for the connected
 * store(s), and for each:
 *   - normalizes the phone to E.164 USING THE PURCHASE COUNTRY (so AR/CO/MX…
 *     local numbers become WhatsApp-reachable),
 *   - find-or-creates the contact (is_shopify_customer=true),
 *   - persists last_offer_chosen/units (most recent order wins),
 *   - applies category tags: comprador / comprador-recurrente /
 *     carrito-abandonado + `oferta: <label>` + `unidades: <rango>`.
 *
 * It does NOT fire any automation — this is data only, so old customers are
 * never messaged by the import.
 *
 * Auth: `x-cron-secret` header or `?secret=` query == AUTOMATION_CRON_SECRET.
 * Body (all optional): { workspace_id, max_order_pages, max_checkout_pages,
 *   orders_page_info, checkouts_page_info }. When pagination is truncated the
 *   response returns `next_orders_page_info` / `next_checkouts_page_info` to
 *   resume by calling again with those cursors.
 */

const PAGE = 250
const SLEEP_MS = 600 // Shopify REST leaky bucket ~2 req/s

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface ConnRow {
  workspace_id: string
  shop_domain: string
  access_token: string
}

export async function POST(request: Request) {
  const url = new URL(request.url)
  const expected = process.env.AUTOMATION_CRON_SECRET
  const supplied =
    request.headers.get('x-cron-secret') ?? url.searchParams.get('secret') ?? ''
  if (!expected) {
    return NextResponse.json({ error: 'not configured' }, { status: 503 })
  }
  if (!safeSecretEqual(supplied, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    workspace_id?: string
    max_order_pages?: number
    max_checkout_pages?: number
    orders_page_info?: string
    checkouts_page_info?: string
    page_size?: number
  }
  // Treat an explicit 0 as "skip this phase" (don't fall back to the default
  // via `0 || default`, which would silently run the full phase).
  const intParam = (v: unknown, def: number): number => {
    if (v == null) return def
    const n = Math.floor(Number(v))
    return Number.isFinite(n) && n >= 0 ? n : def
  }
  const maxOrderPages = Math.min(intParam(body.max_order_pages, 60), 200)
  const maxCheckoutPages = Math.min(intParam(body.max_checkout_pages, 20), 200)
  // Smaller Shopify pages = fewer per-call DB ops = stays well under proxy
  // timeouts on a small Render instance. Default 250; drive it lower.
  const pageSize = Math.min(Math.max(Number(body.page_size) || PAGE, 1), 250)

  const admin = supabaseAdmin()

  // Resolve the active connection(s) to backfill (with decrypted token).
  let q = admin
    .from('shopify_connections')
    .select('workspace_id, shop_domain, access_token, status')
    .eq('status', 'active')
    .order('installed_at', { ascending: false })
  if (body.workspace_id) q = q.eq('workspace_id', body.workspace_id)
  const { data: conns, error: connErr } = await q
  if (connErr) {
    return NextResponse.json({ error: connErr.message }, { status: 500 })
  }
  if (!conns || conns.length === 0) {
    return NextResponse.json(
      { error: 'no active Shopify connection found' },
      { status: 404 },
    )
  }

  const results: unknown[] = []
  for (const c of conns) {
    const conn: ConnRow = {
      workspace_id: (c as Record<string, unknown>).workspace_id as string,
      shop_domain: (c as Record<string, unknown>).shop_domain as string,
      access_token: decrypt(
        (c as Record<string, unknown>).access_token as string,
      ),
    }
    try {
      const r = await backfillStore(admin, conn, {
        maxOrderPages,
        maxCheckoutPages,
        pageSize,
        ordersPageInfo: body.orders_page_info,
        checkoutsPageInfo: body.checkouts_page_info,
      })
      results.push({ shop: conn.shop_domain, ...r })
    } catch (e) {
      results.push({
        shop: conn.shop_domain,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return NextResponse.json({ ok: true, stores: results })
}

async function backfillStore(
  admin: ReturnType<typeof supabaseAdmin>,
  conn: ConnRow,
  opts: {
    maxOrderPages: number
    maxCheckoutPages: number
    pageSize: number
    ordersPageInfo?: string
    checkoutsPageInfo?: string
  },
) {
  const client = new ShopifyAdminClient(conn.shop_domain, conn.access_token)
  // Load the offer config ONCE (productId → offers + checkout offers) so we
  // resolve each order's offer in memory instead of querying per order.
  const offerConfig: OfferConfig = await loadOfferConfig(admin, conn.workspace_id)
  const tagCache = new Map<string, string>()
  // Most-recent order's created_at per phone, so last_offer reflects the
  // newest purchase regardless of page order.
  const lastOfferAt = new Map<string, string>()
  const buyers = new Set<string>()

  // ---- Orders (buyers) ----
  let orderPages = 0
  let ordersSeen = 0
  let ordersContacts = 0
  let pageInfo = opts.ordersPageInfo ?? null
  let path = pageInfo
    ? `/orders.json?limit=${opts.pageSize}&page_info=${encodeURIComponent(pageInfo)}`
    : `/orders.json?status=any&limit=${opts.pageSize}&order=${encodeURIComponent('created_at desc')}`

  while (orderPages < opts.maxOrderPages) {
    const { data, link } = await client.restPaged<{
      orders?: Record<string, unknown>[]
    }>(path)
    const orders = data.orders ?? []
    for (const order of orders) {
      ordersSeen++
      const phone = extractShopifyPhone(order)
      if (!phone) continue
      const contactId = await upsertWhatsappContact(admin, {
        workspaceId: conn.workspace_id,
        phone,
        name: extractShopifyName(order),
        email: (order.email as string) || undefined,
        legacyExternalId: extractShopifyLegacyPhone(order),
      })
      if (!contactId) continue
      ordersContacts++
      buyers.add(phone)

      const offer = resolveOfferFromConfig(order, offerConfig)
      const at = String(order.created_at ?? order.processed_at ?? '')
      if (offer.label && at > (lastOfferAt.get(phone) ?? '')) {
        lastOfferAt.set(phone, at)
        await admin
          .from('contacts')
          .update({
            last_offer_chosen: offer.label,
            last_offer_units: offer.units,
            last_offer_at: at || new Date().toISOString(),
          })
          .eq('id', contactId)
      }

      const ordersCount = Number(
        (order.customer as Record<string, unknown> | undefined)?.orders_count ??
          1,
      )
      await applyCategoryTags(
        admin,
        conn.workspace_id,
        contactId,
        {
          ordersCount: ordersCount > 0 ? ordersCount : 1,
          isAbandoned: false,
          offerLabel: offer.label,
          units: offer.units,
        },
        tagCache,
      )
    }
    orderPages++
    pageInfo = nextPageInfo(link)
    if (!pageInfo) break
    path = `/orders.json?limit=${opts.pageSize}&page_info=${encodeURIComponent(pageInfo)}`
    await sleep(SLEEP_MS)
  }

  // ---- Abandoned checkouts (non-buyers) ----
  let checkoutPages = 0
  let checkoutsSeen = 0
  let abandonedContacts = 0
  let ckPageInfo = opts.checkoutsPageInfo ?? null
  let ckPath = ckPageInfo
    ? `/checkouts.json?limit=${opts.pageSize}&page_info=${encodeURIComponent(ckPageInfo)}`
    : `/checkouts.json?limit=${opts.pageSize}`

  while (checkoutPages < opts.maxCheckoutPages) {
    const { data, link } = await client.restPaged<{
      checkouts?: Record<string, unknown>[]
    }>(ckPath)
    const checkouts = data.checkouts ?? []
    for (const ck of checkouts) {
      checkoutsSeen++
      if (ck.completed_at) continue // converted — handled as a buyer
      const phone = extractShopifyPhone(ck)
      if (!phone) continue
      if (buyers.has(phone)) continue // already a buyer; don't tag abandoned
      const contactId = await upsertWhatsappContact(admin, {
        workspaceId: conn.workspace_id,
        phone,
        name: extractShopifyName(ck),
        email: (ck.email as string) || undefined,
        legacyExternalId: extractShopifyLegacyPhone(ck),
      })
      if (!contactId) continue
      abandonedContacts++

      const items = Array.isArray(ck.line_items)
        ? (ck.line_items as Record<string, unknown>[])
        : []
      const units = items.reduce((s, li) => s + (Number(li.quantity) || 0), 0)
      await applyCategoryTags(
        admin,
        conn.workspace_id,
        contactId,
        { ordersCount: 0, isAbandoned: true, units },
        tagCache,
      )
    }
    checkoutPages++
    ckPageInfo = nextPageInfo(link)
    if (!ckPageInfo) break
    ckPath = `/checkouts.json?limit=${opts.pageSize}&page_info=${encodeURIComponent(ckPageInfo)}`
    await sleep(SLEEP_MS)
  }

  return {
    orders: { pages: orderPages, seen: ordersSeen, contacts: ordersContacts },
    abandoned: {
      pages: checkoutPages,
      seen: checkoutsSeen,
      contacts: abandonedContacts,
    },
    next_orders_page_info: pageInfo,
    next_checkouts_page_info: ckPageInfo,
  }
}
