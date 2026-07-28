import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { verifyShopifyWebhook } from '@/lib/shopify/webhook-auth'

/**
 * Shopify fires this when the merchant uninstalls the app — the access
 * token is now invalid, so flip the connection to 'uninstalled'.
 */
export async function POST(request: Request) {
  const rawBody = await request.text()
  const admin = supabaseAdmin()
  // Fail-closed: sin secreto (ni por-tienda ni global) no verificamos firma,
  // así que rechazamos (503) en vez de marcar conexiones 'uninstalled' sin auth.
  const verdict = await verifyShopifyWebhook(admin, request, rawBody)
  if (verdict === 'unconfigured') {
    return new NextResponse('Webhook not configured', { status: 503 })
  }
  if (verdict === 'invalid') {
    return new NextResponse('Invalid HMAC', { status: 401 })
  }

  const shopDomain = request.headers.get('x-shopify-shop-domain')
  if (shopDomain) {
    await admin
      .from('shopify_connections')
      .update({
        status: 'uninstalled',
        uninstalled_at: new Date().toISOString(),
        last_error: 'app/uninstalled webhook',
      })
      .eq('platform', 'shopify')
      .eq('shop_domain', shopDomain)
  }
  return NextResponse.json({ ok: true })
}
