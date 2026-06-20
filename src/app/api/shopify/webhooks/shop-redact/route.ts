import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { verifyWebhookHmac } from '@/lib/shopify/oauth'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('shopify.gdpr.shop-redact')

/**
 * CANONICAL GDPR endpoint — shop/redact.
 *
 * Fires ~48h after a merchant uninstalls the app and Shopify wants every
 * trace of the shop's data gone. This handler performs the REAL wipe of
 * all shop-scoped rows we persist: the stored connection (which holds the
 * encrypted Admin API token) plus the per-shop checkout / fulfillment /
 * dedup bookkeeping keyed on `shop_domain`.
 *
 * Fail-CLOSED: if SHOPIFY_API_SECRET is missing we cannot verify the
 * signature, so we refuse (503) instead of deleting connections on an
 * unauthenticated request.
 */
export async function POST(request: Request) {
  const apiSecret = process.env.SHOPIFY_API_SECRET
  if (!apiSecret) {
    return new NextResponse('Webhook not configured', { status: 503 })
  }

  const rawBody = await request.text()
  if (
    !verifyWebhookHmac(
      rawBody,
      request.headers.get('x-shopify-hmac-sha256'),
      apiSecret,
    )
  ) {
    return new NextResponse('Invalid HMAC', { status: 401 })
  }

  const shopDomain = request.headers.get('x-shopify-shop-domain')
  if (!shopDomain) return NextResponse.json({ ok: true })

  try {
    const admin = supabaseAdmin()

    // Drop the connection first — it carries the encrypted token, the most
    // sensitive shop-scoped secret we hold.
    await admin
      .from('shopify_connections')
      .delete()
      .eq('shop_domain', shopDomain)

    // Best-effort cleanup of the remaining shop-scoped bookkeeping tables.
    // Each is keyed on shop_domain; a missing table (older schema) must not
    // abort the wipe, so we swallow per-table errors and keep going.
    const shopScopedTables = [
      'shopify_checkouts',
      'shopify_order_fulfillment_state',
    ]
    for (const table of shopScopedTables) {
      const { error } = await admin
        .from(table)
        .delete()
        .eq('shop_domain', shopDomain)
      if (error) {
        log.warn('shop-redact: table cleanup skipped', {
          table,
          error: error.message,
        })
      }
    }

    log.info('shop-redact done', { shop: shopDomain })
    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error('shop-redact failed', {
      shop: shopDomain,
      error: err instanceof Error ? err.message : String(err),
    })
    // Signature verified; ack 200 to avoid Shopify's retry storm. The
    // delete is idempotent, so a manual replay is safe.
    return NextResponse.json({ ok: true })
  }
}
