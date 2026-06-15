import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { verifyWebhookHmac } from '@/lib/shopify/oauth'
import { getConnectionByShop } from '@/lib/shopify/connection'
import {
  extractShopifyName,
  extractShopifyPhone,
  upsertWhatsappContact,
} from '@/lib/shopify/contact-upsert'

/**
 * customers/update receiver. Keeps the WhatsApp contact's name/email/phone
 * in sync when the merchant edits the customer record in Shopify Admin.
 * No automation triggers fire here — this is metadata maintenance.
 */
export async function POST(request: Request) {
  const apiSecret = process.env.SHOPIFY_API_SECRET
  if (!apiSecret) {
    return NextResponse.json({ error: 'not configured' }, { status: 503 })
  }

  const rawBody = await request.text()
  const hmac = request.headers.get('x-shopify-hmac-sha256')
  if (!verifyWebhookHmac(rawBody, hmac, apiSecret)) {
    return new NextResponse('Invalid HMAC', { status: 401 })
  }

  const shopDomain = request.headers.get('x-shopify-shop-domain')
  if (!shopDomain) return NextResponse.json({ ok: true })

  try {
    const admin = supabaseAdmin()
    const conn = await getConnectionByShop(admin, shopDomain)
    if (!conn) return NextResponse.json({ ok: true })

    const customer = JSON.parse(rawBody) as Record<string, unknown>
    const phone = extractShopifyPhone({ customer })
    if (!phone) return NextResponse.json({ ok: true, skipped: 'no_phone' })
    const name = extractShopifyName({ customer })

    await upsertWhatsappContact(admin, {
      workspaceId: conn.row.user_id,
      phone,
      name,
      email: (customer.email as string) || undefined,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[shopify] customers webhook error:', err)
    return NextResponse.json({ ok: true })
  }
}
