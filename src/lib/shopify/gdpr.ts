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
  // Fail-closed: si falta el secreto, NO aceptar ciegamente (503) — igual que
  // orders/checkouts. Devolver 200 sin verificar convertiría una
  // desconfiguración en un endpoint sin auth.
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
  return NextResponse.json({ ok: true })
}
