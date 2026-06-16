import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { verifyWebhookHmac } from '@/lib/shopify/oauth'
import { getConnectionByShop } from '@/lib/shopify/connection'
import {
  extractShopifyName,
  extractShopifyPhone,
  upsertWhatsappContact,
} from '@/lib/shopify/contact-upsert'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { isDuplicateDelivery } from '@/lib/shopify/webhook-dedup'
import { captureWebhookFailure } from '@/lib/webhooks/capture'

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
    const topic = request.headers.get('x-shopify-topic') || 'customers/update'
    const webhookId = request.headers.get('x-shopify-webhook-id')
    if (await isDuplicateDelivery(admin, shopDomain, webhookId, topic)) {
      return NextResponse.json({ ok: true, duplicate: true })
    }
    const conn = await getConnectionByShop(admin, shopDomain)
    if (!conn) return NextResponse.json({ ok: true })

    // Pre-055 this route passed conn.row.user_id as workspaceId, which
    // misrouted upserts to a row keyed on the user UUID instead of the
    // workspace UUID. With workspace_id NOT NULL we use it directly.
    const workspaceId =
      conn.row.workspace_id ||
      (await resolveWorkspaceIdForUser(admin, conn.row.user_id))
    if (!workspaceId) {
      console.warn(
        '[shopify] customers webhook: no workspace for connection',
        conn.row.id,
      )
      return NextResponse.json({ ok: true, skipped: 'no_workspace' })
    }

    const customer = JSON.parse(rawBody) as Record<string, unknown>
    const phone = extractShopifyPhone({ customer })
    if (!phone) return NextResponse.json({ ok: true, skipped: 'no_phone' })
    const name = extractShopifyName({ customer })

    await upsertWhatsappContact(admin, {
      workspaceId,
      phone,
      name,
      email: (customer.email as string) || undefined,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[shopify] customers webhook error:', err)
    await captureWebhookFailure({
      provider: `shopify:${request.headers.get('x-shopify-topic') || 'customers/update'}`,
      rawBody,
      signature: hmac,
      error: err,
    })
    return NextResponse.json({ ok: true })
  }
}
