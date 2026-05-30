import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { verifyWebhookHmac } from '@/lib/shopify/oauth'

/**
 * shop/redact fires 48h after uninstall. Drop the stored connection (and
 * its encrypted token) for the shop.
 */
export async function POST(request: Request) {
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
  const shopDomain = request.headers.get('x-shopify-shop-domain')
  if (shopDomain) {
    await supabaseAdmin()
      .from('shopify_connections')
      .delete()
      .eq('shop_domain', shopDomain)
  }
  return NextResponse.json({ ok: true })
}
