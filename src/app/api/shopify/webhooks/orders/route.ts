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
import type { AutomationTriggerType } from '@/types'

/**
 * Shopify orders webhook receiver. Handles two topics on the same route:
 *
 *  - `orders/create`     → trigger `shopify_order_created`
 *      Powers the "Nuevo pedido" automation (confirmation message).
 *      Also exposes `is_repeat_customer` in context.vars so the "Recompras"
 *      template can branch on it without a separate trigger.
 *
 *  - `orders/updated`    → trigger `shopify_order_fulfilled` when
 *      fulfillment_status transitions from null/partial to "fulfilled".
 *      Shopify retired the orders/fulfilled topic so we subscribe to
 *      orders/updated and diff against the last-seen status in
 *      shopify_order_fulfillment_state.
 *
 * Other topics that land here (Shopify sometimes pings shared addresses)
 * are verified and acknowledged but not dispatched.
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
  const topic = request.headers.get('x-shopify-topic') || ''
  if (!shopDomain) return NextResponse.json({ ok: true })

  if (topic !== 'orders/create' && topic !== 'orders/updated') {
    return NextResponse.json({ ok: true, ignored: topic })
  }

  try {
    const admin = supabaseAdmin()
    const conn = await getConnectionByShop(admin, shopDomain)
    if (!conn) return NextResponse.json({ ok: true })

    const workspaceId = conn.row.user_id
    const order = JSON.parse(rawBody) as Record<string, unknown>
    const orderId = Number(order.id ?? 0)
    const incomingFulfillment =
      (order.fulfillment_status as string | null | undefined) ?? null

    let triggerType: AutomationTriggerType | null = null
    if (topic === 'orders/create') {
      triggerType = 'shopify_order_created'
      if (orderId > 0) {
        await admin
          .from('shopify_order_fulfillment_state')
          .upsert(
            {
              shop_domain: shopDomain,
              order_id: orderId,
              fulfillment_status: incomingFulfillment,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'shop_domain,order_id' },
          )
      }
    } else {
      // orders/updated: only dispatch when fulfillment_status flips to
      // 'fulfilled' (from null/partial). Anything else (status edits,
      // tag changes) is a silent state refresh.
      let previousFulfillment: string | null = null
      if (orderId > 0) {
        const { data: prior } = await admin
          .from('shopify_order_fulfillment_state')
          .select('fulfillment_status')
          .eq('shop_domain', shopDomain)
          .eq('order_id', orderId)
          .maybeSingle()
        previousFulfillment =
          (prior as { fulfillment_status: string | null } | null)
            ?.fulfillment_status ?? null

        await admin
          .from('shopify_order_fulfillment_state')
          .upsert(
            {
              shop_domain: shopDomain,
              order_id: orderId,
              fulfillment_status: incomingFulfillment,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'shop_domain,order_id' },
          )
      }
      if (
        incomingFulfillment === 'fulfilled' &&
        previousFulfillment !== 'fulfilled'
      ) {
        triggerType = 'shopify_order_fulfilled'
      }
    }

    if (!triggerType) {
      return NextResponse.json({ ok: true, ignored: 'no_transition' })
    }

    const phone = extractShopifyPhone(order)
    if (!phone) return NextResponse.json({ ok: true, skipped: 'no_phone' })
    const name = extractShopifyName(order)

    const contactId = await upsertWhatsappContact(admin, {
      workspaceId,
      phone,
      name,
      email: (order.email as string) || undefined,
    })
    if (!contactId) return NextResponse.json({ ok: true })

    const vars = buildVarsForOrder(triggerType, order, name)

    runAutomationsForTrigger({
      workspaceId,
      triggerType,
      contactId,
      context: { vars },
    }).catch((err) => console.error('[shopify] dispatch failed:', err))

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[shopify] orders webhook error:', err)
    return NextResponse.json({ ok: true })
  }
}

function buildVarsForOrder(
  trigger: AutomationTriggerType,
  order: Record<string, unknown>,
  name: string | undefined,
): Record<string, string> {
  const customer = order.customer as Record<string, unknown> | undefined
  const ordersCount = Number(customer?.orders_count ?? 0)
  const lineItems = Array.isArray(order.line_items) ? order.line_items : []
  const firstItem = lineItems[0] as Record<string, unknown> | undefined

  const base: Record<string, string> = {
    customer_name: name ?? '',
    order_name: String(order.name ?? ''),
    order_number: String(order.order_number ?? ''),
    total_price: String(order.total_price ?? ''),
    currency: String(order.currency ?? order.presentment_currency ?? ''),
    item_count: String(lineItems.length),
    first_item: String(firstItem?.title ?? ''),
    is_repeat_customer: ordersCount > 1 ? 'true' : 'false',
    order_status_url: String(order.order_status_url ?? ''),
  }

  if (trigger === 'shopify_order_fulfilled') {
    const fulfillments = Array.isArray(order.fulfillments)
      ? (order.fulfillments as Record<string, unknown>[])
      : []
    const latest = fulfillments[fulfillments.length - 1]
    base.tracking_number = String(latest?.tracking_number ?? '')
    base.tracking_url = String(latest?.tracking_url ?? '')
    base.tracking_company = String(latest?.tracking_company ?? '')
  }

  return base
}
