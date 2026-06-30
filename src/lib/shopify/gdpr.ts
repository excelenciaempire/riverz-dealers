import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { verifyShopifyWebhook } from '@/lib/shopify/webhook-auth'

/**
 * Shared handler for Shopify's three mandatory GDPR webhooks
 * (customers/data_request, customers/redact, shop/redact). We don't store
 * Shopify customer PII beyond a phone-derived contact, so there's nothing
 * to export/redact here beyond acknowledging — but every endpoint MUST
 * HMAC-verify and return 2xx within 5s or Shopify flags the app.
 */
export async function handleGdprWebhook(request: Request): Promise<NextResponse> {
  const rawBody = await request.text()
  // Fail-closed: si falta el secreto (por-tienda o global), NO aceptar
  // ciegamente (503) — igual que orders/checkouts. Devolver 200 sin verificar
  // convertiría una desconfiguración en un endpoint sin auth.
  const verdict = await verifyShopifyWebhook(supabaseAdmin(), request, rawBody)
  if (verdict === 'unconfigured') {
    return new NextResponse('Webhook not configured', { status: 503 })
  }
  if (verdict === 'invalid') {
    return new NextResponse('Invalid HMAC', { status: 401 })
  }
  return NextResponse.json({ ok: true })
}
