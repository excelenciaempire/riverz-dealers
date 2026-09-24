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
    const now = new Date().toISOString()
    await admin
      .from('shopify_connections')
      .update({
        status: 'uninstalled',
        uninstalled_at: now,
        last_error: 'app/uninstalled webhook',
      })
      .eq('platform', 'shopify')
      .eq('shop_domain', shopDomain)
    await admin
      .from('workspace_subscriptions')
      .update({ estado: 'cancelada', cancelar_al_final: true, updated_at: now })
      .eq('stripe_customer_id', shopDomain)
      .like('stripe_subscription_id', 'gid://shopify/AppSubscription/%')
  }
  return NextResponse.json({ ok: true })
}
