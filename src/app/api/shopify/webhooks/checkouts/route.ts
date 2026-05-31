import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { verifyWebhookHmac } from '@/lib/shopify/oauth'
import { getConnectionByShop } from '@/lib/shopify/connection'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import {
  extractShopifyName,
  extractShopifyPhone,
  upsertWhatsappContact,
} from '@/lib/shopify/contact-upsert'

/**
 * Shopify checkout webhook receiver. Fires the
 * `shopify_abandoned_checkout` automation trigger when a checkout is
 * created. The automation's own "wait" step turns this into a recovery
 * flow (checkout created → wait 15m → send WhatsApp → tag).
 *
 * Only `checkouts/create` dispatches — `checkouts/update` fires repeatedly
 * and would re-trigger the automation, so it's verified but ignored.
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
  const topic = request.headers.get('x-shopify-topic')
  if (!shopDomain) return NextResponse.json({ ok: true })

  if (topic && topic !== 'checkouts/create') {
    return NextResponse.json({ ok: true, ignored: topic })
  }

  try {
    const admin = supabaseAdmin()
    const conn = await getConnectionByShop(admin, shopDomain)
    if (!conn) return NextResponse.json({ ok: true })

    const workspaceId = conn.row.user_id
    const checkout = JSON.parse(rawBody) as Record<string, unknown>

    const phone = extractShopifyPhone(checkout)
    if (!phone) return NextResponse.json({ ok: true, skipped: 'no_phone' })
    const name = extractShopifyName(checkout)

    const contactId = await upsertWhatsappContact(admin, {
      workspaceId,
      phone,
      name,
      email: (checkout.email as string) || undefined,
    })
    if (!contactId) return NextResponse.json({ ok: true })

    runAutomationsForTrigger({
      workspaceId,
      triggerType: 'shopify_abandoned_checkout',
      contactId,
      context: {
        vars: {
          checkout_url:
            checkout.abandoned_checkout_url ?? checkout.checkout_url ?? '',
          total_price: checkout.total_price ?? '',
          currency: checkout.currency ?? checkout.presentment_currency ?? '',
          customer_name: name ?? '',
          checkout_token: checkout.token ?? '',
        },
      },
    }).catch((err) => console.error('[shopify] dispatch failed:', err))

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[shopify] checkouts webhook error:', err)
    return NextResponse.json({ ok: true })
  }
}
