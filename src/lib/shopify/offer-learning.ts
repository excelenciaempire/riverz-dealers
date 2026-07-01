import type { SupabaseClient } from '@supabase/supabase-js'
import { ShopifyAdminClient, nextPageInfo } from './admin-client'
import {
  offersByProductFromOrder,
  detectOffers,
  normalizeDetectedOffers,
  mergeOffers,
} from './detect-offers'

/**
 * Learn a brand's offer tiers from REAL order history and write them onto the
 * matching `shopify_products.allowed_offers`.
 *
 * Purchase-confirmed and free (no LLM): bundle apps like Kaching stamp every
 * bundle line item with a `__kaching_bundles` property whose `deal` code
 * groups the lines of one offer. Summing a deal's quantities gives the TOTAL
 * units the buyer received (the value `resolveOfferChosen` matches on), and it
 * handles "buy 3 get 1 free" natively because the free $0.00 unit is a real
 * line item. We attribute each learned tier to the product(s) in that deal.
 *
 * Shared by the connect-time learner (bounded, runs on OAuth) and the
 * historical backfill (full walk, accumulates inline). Idempotent: writes only
 * when the row was auto-detected or has no offers — never clobbers offers the
 * merchant edited by hand (they hold offers_auto_detected=false).
 */

type Learned = Map<string, Set<number>>

interface OfferRow {
  id: string
  allowed_offers?: unknown
  offers_auto_detected?: unknown
  bundle_metadata?: unknown
}

/**
 * Detect offer tiers from a product's scraped page text and write them to
 * `allowed_offers`, idempotently. Shared by every scrape path (the dedicated
 * /scrape route and the ai-research route's inline scrape) so "detect the
 * offers on the page" behaves identically everywhere. Only writes when the
 * row was auto-detected or has no offers — never clobbers manual edits.
 * Returns the number of tiers written (0 when none found or skipped).
 */
export async function detectOffersFromScrapedContent(
  db: SupabaseClient,
  product: OfferRow,
  content: { markdown: string; html?: string | null } | string,
  locale: 'es' | 'en' = 'es',
): Promise<number> {
  const markdown = typeof content === 'string' ? content : content.markdown
  const html = typeof content === 'string' ? null : content.html ?? null
  const detected = detectOffers(markdown, html, locale)
  if (detected.length === 0) return 0
  const existing = Array.isArray(product.allowed_offers) ? product.allowed_offers : []
  if (!(product.offers_auto_detected === true || existing.length === 0)) return 0

  const update: Record<string, unknown> = {
    allowed_offers: detected,
    offers_auto_detected: true,
    bundle_metadata: {
      ...(product.bundle_metadata && typeof product.bundle_metadata === 'object'
        ? (product.bundle_metadata as Record<string, unknown>)
        : {}),
      detected_offers_source: 'page_scrape',
      detected_offers_count: detected.length,
    },
  }
  const prices = detected
    .map((o) => o.total)
    .filter((n): n is number => typeof n === 'number')
  if (prices.length > 0) {
    update.price_min = Math.min(...prices)
    update.price_max = Math.max(...prices)
  }
  await db.from('shopify_products').update(update).eq('id', product.id)
  return detected.length
}

/** Fold one order's per-product tiers into the running accumulator. */
export function accumulateOrderOffers(order: unknown, into: Learned): void {
  for (const { productId, units } of offersByProductFromOrder(order)) {
    const set = into.get(productId) ?? new Set<number>()
    set.add(units)
    into.set(productId, set)
  }
}

/**
 * Persist accumulated tiers to the products they belong to. Returns how many
 * product rows were updated. `learned` maps a Shopify product id (external_id)
 * to the set of distinct total-unit counts seen for it.
 */
export async function writeLearnedOffers(
  admin: SupabaseClient,
  args: {
    shopDomain: string
    learned: Learned
    locale?: 'es' | 'en'
  },
): Promise<number> {
  if (args.learned.size === 0) return 0
  const extIdNums = [...args.learned.keys()]
    .map(Number)
    .filter((n) => Number.isFinite(n))
  if (extIdNums.length === 0) return 0

  const { data: prods } = await admin
    .from('shopify_products')
    .select('id, external_id, allowed_offers, offers_auto_detected, bundle_metadata')
    .eq('shop_domain', args.shopDomain)
    .in('external_id', extIdNums)

  let updated = 0
  for (const p of (prods ?? []) as Array<Record<string, unknown>>) {
    const set = args.learned.get(String(p.external_id))
    if (!set || set.size === 0) continue
    const existing = Array.isArray(p.allowed_offers) ? p.allowed_offers : []
    const isAuto = p.offers_auto_detected === true
    // Respect merchant-owned offers: skip rows that have offers we didn't set.
    if (existing.length > 0 && !isAuto) continue

    const detected = normalizeDetectedOffers(
      [...set].map((u) => ({ label: '', units: u })),
      args.locale ?? 'es',
    )
    // Auto rows: append-only merge (keeps any tiers we detected earlier, e.g.
    // from a page scrape). Empty rows: just take the detected set.
    const { offers, added } = mergeOffers(isAuto ? existing : [], detected)
    if (added === 0 && existing.length > 0) continue

    await admin
      .from('shopify_products')
      .update({
        allowed_offers: offers,
        offers_auto_detected: true,
        bundle_metadata: {
          ...(p.bundle_metadata && typeof p.bundle_metadata === 'object'
            ? (p.bundle_metadata as Record<string, unknown>)
            : {}),
          detected_offers_source: 'order_history',
        },
      })
      .eq('id', p.id as string)
    updated++
  }
  return updated
}

/**
 * Connect-time learner: walk a BOUNDED window of recent orders (default 2
 * pages ≈ 500 orders) and write the learned tiers. Kept small so it can run
 * fire-and-forget right after the OAuth product sync without hammering
 * Shopify's leaky bucket. The full history is covered by the backfill.
 */
export async function learnOffersOnConnect(
  admin: SupabaseClient,
  args: {
    shopDomain: string
    accessToken: string
    maxPages?: number
    locale?: 'es' | 'en'
  },
): Promise<number> {
  const client = new ShopifyAdminClient(args.shopDomain, args.accessToken)
  const learned: Learned = new Map()
  const maxPages = args.maxPages ?? 2
  let pages = 0
  let path = `/orders.json?status=any&limit=250&order=${encodeURIComponent('created_at desc')}`
  while (pages < maxPages) {
    const { data, link } = await client.restPaged<{ orders?: unknown[] }>(path)
    const orders = data.orders ?? []
    for (const order of orders) accumulateOrderOffers(order, learned)
    pages++
    const pi = nextPageInfo(link)
    if (!pi) break
    path = `/orders.json?limit=250&page_info=${encodeURIComponent(pi)}`
    // Shopify REST leaky bucket ~2 req/s.
    await new Promise((r) => setTimeout(r, 600))
  }
  return writeLearnedOffers(admin, {
    shopDomain: args.shopDomain,
    learned,
    locale: args.locale,
  })
}
