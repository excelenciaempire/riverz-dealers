import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { verifyWebhookHmac } from '@/lib/shopify/oauth'
import { getConnectionByShop } from '@/lib/shopify/connection'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils'

/**
 * Shopify checkout webhook receiver. Fires the
 * `shopify_abandoned_checkout` automation trigger when a checkout is
 * created. The automation's own "wait" step turns this into a recovery
 * flow (checkout created → wait 15m → send WhatsApp → tag), matching the
 * canvas in the reference design.
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

  // Respond fast; ignore non-create topics after verification.
  if (topic && topic !== 'checkouts/create') {
    return NextResponse.json({ ok: true, ignored: topic })
  }

  // Do the work but never let it 500 back to Shopify (they'd retry+disable).
  try {
    const admin = supabaseAdmin()
    const conn = await getConnectionByShop(admin, shopDomain)
    if (!conn) return NextResponse.json({ ok: true })

    const workspaceId = conn.row.user_id
    const checkout = JSON.parse(rawBody) as Record<string, unknown>

    const phoneRaw =
      (checkout.phone as string) ||
      ((checkout.customer as Record<string, unknown> | undefined)?.phone as string) ||
      ((checkout.shipping_address as Record<string, unknown> | undefined)?.phone as string) ||
      ((checkout.billing_address as Record<string, unknown> | undefined)?.phone as string) ||
      ''
    const phone = phoneRaw ? sanitizePhoneForMeta(phoneRaw) : ''
    if (!phone || !isValidE164(phone)) {
      // No WhatsApp-reachable phone → nothing to recover via WhatsApp.
      return NextResponse.json({ ok: true, skipped: 'no_phone' })
    }

    const customer = checkout.customer as Record<string, unknown> | undefined
    const name =
      [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') ||
      (checkout.name as string) ||
      undefined

    const contactId = await upsertWhatsappContact(admin, {
      workspaceId,
      phone,
      name,
      email: (checkout.email as string) || undefined,
    })
    if (!contactId) return NextResponse.json({ ok: true })

    // Fire automations (fire-and-forget; engine never throws). Checkout
    // fields are exposed via context.vars for templates/conditions.
    runAutomationsForTrigger({
      workspaceId,
      triggerType: 'shopify_abandoned_checkout',
      contactId,
      context: {
        vars: {
          checkout_url: checkout.abandoned_checkout_url ?? checkout.checkout_url ?? '',
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
    // Still 200 so Shopify doesn't retry-storm / auto-disable the webhook.
    return NextResponse.json({ ok: true })
  }
}

/** Find-or-create a WhatsApp contact by phone in the unified inbox. */
async function upsertWhatsappContact(
  admin: ReturnType<typeof supabaseAdmin>,
  args: { workspaceId: string; phone: string; name?: string; email?: string },
): Promise<string | null> {
  const { data: existing } = await admin
    .from('contacts')
    .select('id')
    .eq('workspace_id', args.workspaceId)
    .eq('channel', 'whatsapp')
    .eq('external_id', args.phone)
    .maybeSingle()
  if (existing?.id) return existing.id as string

  const { data: created, error } = await admin
    .from('contacts')
    .insert({
      workspace_id: args.workspaceId,
      channel: 'whatsapp',
      external_id: args.phone,
      phone: args.phone,
      name: args.name ?? null,
      email: args.email ?? null,
    })
    .select('id')
    .single()
  if (error) {
    console.error('[shopify] contact upsert failed:', error)
    return null
  }
  return created.id as string
}
