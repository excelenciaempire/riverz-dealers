import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { verifyWebhookHmac } from '@/lib/shopify/oauth'

/**
 * Shopify fires this when the merchant uninstalls the app — the access
 * token is now invalid, so flip the connection to 'uninstalled'.
 */
export async function POST(request: Request) {
  const apiSecret = process.env.SHOPIFY_API_SECRET
  if (!apiSecret) return NextResponse.json({ ok: true })

  const rawBody = await request.text()
  if (!verifyWebhookHmac(rawBody, request.headers.get('x-shopify-hmac-sha256'), apiSecret)) {
    return new NextResponse('Invalid HMAC', { status: 401 })
  }

  const shopDomain = request.headers.get('x-shopify-shop-domain')
  if (shopDomain) {
    await supabaseAdmin()
      .from('shopify_connections')
      .update({
        status: 'uninstalled',
        uninstalled_at: new Date().toISOString(),
        last_error: 'app/uninstalled webhook',
      })
      .eq('shop_domain', shopDomain)
  }
  return NextResponse.json({ ok: true })
}
