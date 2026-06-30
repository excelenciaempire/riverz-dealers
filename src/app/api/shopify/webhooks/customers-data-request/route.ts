import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { verifyShopifyWebhook } from '@/lib/shopify/webhook-auth'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('shopify.gdpr.customers-data-request')

/**
 * CANONICAL GDPR endpoint — customers/data_request.
 *
 * Shopify forwards this whenever a buyer exercises their right of access.
 * The merchant must hand the buyer whatever personal data the app holds.
 *
 * What we store about a Shopify buyer is a single phone-derived WhatsApp
 * contact (`contacts` row: phone, name, email). There is no separate
 * Shopify-PII store to export, and Shopify does not give us a buyer-facing
 * delivery channel here — the merchant relays the data manually. So we
 * HMAC-verify, log the request for the audit trail, and ack 200.
 *
 * Fail-CLOSED: if SHOPIFY_API_SECRET is missing we cannot verify the
 * signature, so we MUST refuse (503) rather than accept an unauthenticated
 * request — same posture as the orders/checkouts receivers.
 */
export async function POST(request: Request) {
  const rawBody = await request.text()
  const verdict = await verifyShopifyWebhook(supabaseAdmin(), request, rawBody)
  if (verdict === 'unconfigured') {
    return new NextResponse('Webhook not configured', { status: 503 })
  }
  if (verdict === 'invalid') {
    return new NextResponse('Invalid HMAC', { status: 401 })
  }

  log.info('data_request received', {
    shop: request.headers.get('x-shopify-shop-domain') ?? null,
    bytes: rawBody.length,
  })
  return NextResponse.json({ ok: true })
}
