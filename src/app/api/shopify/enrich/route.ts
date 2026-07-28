import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { safeSecretEqual } from '@/lib/auth/cron'
import { enrichProducts } from '@/lib/products/enrich'
import type { Locale } from '@/lib/i18n/config'

/**
 * POST /api/shopify/enrich — bounded, server-side product enrichment for a
 * connected store's catalog (scrape → detect offers → research). Same brain as
 * connect-time auto-enrichment; exposed so a catalog can be (re)enriched on
 * demand without reconnecting, and so a cron can chip away at large catalogs.
 *
 * Auth: `x-cron-secret` header or `?secret=` == AUTOMATION_CRON_SECRET.
 * Body (optional): { workspace_id, max, locale, include_done }.
 */
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
    max?: number
    locale?: string
    include_done?: boolean
  }

  const admin = supabaseAdmin()

  // Resolve active connection(s), optionally scoped to a workspace.
  let q = admin
    .from('shopify_connections')
    .select('workspace_id, shop_domain, status')
    .eq('platform', 'shopify')
    .eq('status', 'active')
  if (body.workspace_id) q = q.eq('workspace_id', body.workspace_id)
  const { data: conns, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!conns || conns.length === 0) {
    return NextResponse.json({ error: 'no active Shopify connection found' }, { status: 404 })
  }

  const locale: Locale = body.locale === 'en' ? 'en' : 'es'
  const results: unknown[] = []
  for (const c of conns) {
    const shopDomain = (c as Record<string, unknown>).shop_domain as string
    const r = await enrichProducts(admin, {
      shopDomain,
      max: body.max,
      locale,
      includeDone: body.include_done === true,
    })
    results.push({ shop: shopDomain, ...r })
  }

  return NextResponse.json({ ok: true, stores: results })
}
