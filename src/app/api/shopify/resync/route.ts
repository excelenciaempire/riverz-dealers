import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { safeSecretEqual } from '@/lib/auth/cron'
import { decrypt } from '@/lib/whatsapp/encryption'
import { syncShopifyProducts } from '@/lib/shopify/product-sync'
import { learnOffersOnConnect } from '@/lib/shopify/offer-learning'
import { enrichProducts } from '@/lib/products/enrich'
import type { Locale } from '@/lib/i18n/config'

/**
 * POST /api/shopify/resync — run the full connect-time chain on demand:
 * (optionally reset) → sync catalog → learn offers from order history →
 * scrape + detect offers + enrich. Server-side so it has the real token,
 * ENCRYPTION_KEY and FIRECRAWL_API_KEY (a local box has none of those). Same
 * building blocks the OAuth callback fires; exposed for verification + ops.
 *
 * Auth: `x-cron-secret` header or `?secret=` == AUTOMATION_CRON_SECRET.
 * Body (optional): { workspace_id, reset, enrich_max, locale }.
 *   reset=true deletes the store's shopify_products first (fresh re-sync).
 */
export async function POST(request: Request) {
  const url = new URL(request.url)
  const expected = process.env.AUTOMATION_CRON_SECRET
  const supplied =
    request.headers.get('x-cron-secret') ?? url.searchParams.get('secret') ?? ''
  if (!expected) return NextResponse.json({ error: 'not configured' }, { status: 503 })
  if (!safeSecretEqual(supplied, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    workspace_id?: string
    reset?: boolean
    enrich_max?: number
    locale?: string
  }
  const locale: Locale = body.locale === 'en' ? 'en' : 'es'
  const admin = supabaseAdmin()

  let q = admin
    .from('shopify_connections')
    .select('workspace_id, user_id, shop_domain, access_token, status')
    .eq('platform', 'shopify')
    .eq('status', 'active')
  if (body.workspace_id) q = q.eq('workspace_id', body.workspace_id)
  const { data: conns, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!conns || conns.length === 0) {
    return NextResponse.json({ error: 'no active Shopify connection found' }, { status: 404 })
  }

  const results: unknown[] = []
  for (const c of conns) {
    const row = c as Record<string, unknown>
    const shopDomain = row.shop_domain as string
    try {
      const accessToken = decrypt(row.access_token as string)

      let deleted = 0
      if (body.reset) {
        const del = await admin
          .from('shopify_products')
          .delete()
          .eq('shop_domain', shopDomain)
          .select('id')
        deleted = del.data?.length ?? 0
      }

      const sync = await syncShopifyProducts(admin, {
        userId: row.user_id as string,
        workspaceId: row.workspace_id as string,
        shopDomain,
        accessToken,
      })

      const offersLearned = await learnOffersOnConnect(admin, {
        shopDomain,
        accessToken,
        maxPages: 2,
        locale,
      })

      const enrich = await enrichProducts(admin, {
        shopDomain,
        max: body.enrich_max ?? 25,
        locale,
      })

      results.push({ shop: shopDomain, deleted, sync, offersLearned, enrich })
    } catch (e) {
      results.push({ shop: shopDomain, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return NextResponse.json({ ok: true, stores: results })
}
