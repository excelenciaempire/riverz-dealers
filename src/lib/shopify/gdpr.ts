import { NextResponse } from 'next/server'
import { verifyWebhookHmac } from '@/lib/shopify/oauth'

/**
 * Shared handler for Shopify's three mandatory GDPR webhooks
 * (customers/data_request, customers/redact, shop/redact). We don't store
 * Shopify customer PII beyond a phone-derived contact, so there's nothing
 * to export/redact here beyond acknowledging — but every endpoint MUST
 * HMAC-verify and return 2xx within 5s or Shopify flags the app.
 */
export async function handleGdprWebhook(request: Request): Promise<NextResponse> {
  const apiSecret = process.env.SHOPIFY_API_SECRET
  if (!apiSecret) return NextResponse.json({ ok: true })
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
  return NextResponse.json({ ok: true })
}
