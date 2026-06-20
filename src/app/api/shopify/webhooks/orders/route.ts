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
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { resolveCarrierTrackingUrl } from '@/lib/shopify/carrier-tracking'
import { isDuplicateDelivery } from '@/lib/shopify/webhook-dedup'
import { captureWebhookFailure } from '@/lib/webhooks/capture'
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

    // Per-delivery dedupe (migration 059). Shopify retries up to 19x
    // over ~48h, so any post-side-effect crash without dedupe would
    // re-send the order confirmation on every retry.
    const webhookId = request.headers.get('x-shopify-webhook-id')
    if (await isDuplicateDelivery(admin, shopDomain, webhookId, topic)) {
      return NextResponse.json({ ok: true, duplicate: true })
    }

    const conn = await getConnectionByShop(admin, shopDomain)
    if (!conn) return NextResponse.json({ ok: true })

    // Migration 055 made shopify_connections.workspace_id NOT NULL, so we
    // read it straight off the connection. The legacy owner_id lookup is
    // kept as a defense for any in-flight requests that observed pre-055
    // rows; harmless overhead once 055 settles.
    const workspaceId =
      conn.row.workspace_id ||
      (await resolveWorkspaceIdForUser(admin, conn.row.user_id))
    if (!workspaceId) {
      console.warn(
        '[shopify] orders webhook: no workspace for connection',
        conn.row.id,
      )
      return NextResponse.json({ ok: true, skipped: 'no_workspace' })
    }
    const order = JSON.parse(rawBody) as Record<string, unknown>
    const orderId = Number(order.id ?? 0)
    const incomingFulfillment =
      (order.fulfillment_status as string | null | undefined) ?? null

    // Reconciliar el espejo en Riverz (tabla orders, migración 080). Sólo
    // afecta a pedidos creados por la IA — en cualquier otro pedido el
    // update no matchea ninguna fila y es un no-op. Best-effort.
    if (orderId > 0) {
      await reconcileRiverzOrder(admin, shopDomain, order, orderId).catch((err) =>
        console.error('[shopify] reconcile riverz order failed:', err),
      )
    }

    let triggerType: AutomationTriggerType | null = null
    if (topic === 'orders/create') {
      triggerType = 'shopify_order_created'
      if (orderId > 0) {
        // Atomic claim — migration 059's RPC. Returns true the FIRST
        // time we see this (shop_domain, order_id) and false on every
        // replay. Without this, the per-webhook-id dedupe above only
        // catches retries of the SAME delivery; a brand-new delivery
        // for the SAME order (Shopify's deduper occasionally fails)
        // would still re-fire the "Nuevo pedido" template.
        const { data: claimed } = await admin.rpc('shopify_claim_order_created', {
          p_shop_domain: shopDomain,
          p_order_id: orderId,
          p_fulfillment_status: incomingFulfillment,
        })
        if (claimed !== true) {
          return NextResponse.json({ ok: true, skipped: 'duplicate_order' })
        }
      }
      // Si la orden vino de un checkout que ya teníamos persistido,
      // marcamos ese checkout como completado. Shopify reutiliza el
      // mismo token entre el checkout y la orden, así que un upsert
      // con shop_domain+checkout_id alcanza para cerrarlo. Si nunca
      // vimos el checkout (compra rápida), no pasa nada — el update
      // no hace nada con filas inexistentes.
      const checkoutToken = String(order.checkout_token ?? order.cart_token ?? '').trim()
      if (checkoutToken) {
        await admin
          .from('shopify_checkouts')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('shop_domain', shopDomain)
          .eq('checkout_id', checkoutToken)
      }
    } else {
      // orders/updated: only dispatch when fulfillment_status flips to
      // 'fulfilled' (from null/partial). Anything else (status edits,
      // tag changes) is a silent state refresh.
      //
      // Two near-simultaneous deliveries would otherwise both read
      // previous=null and both dispatch. The RPC introduced in 056
      // performs the read + upsert + diff inside a FOR UPDATE row lock,
      // so exactly one delivery observes the null→fulfilled transition.
      if (orderId > 0) {
        const fulfillments = Array.isArray(order.fulfillments)
          ? (order.fulfillments as Record<string, unknown>[])
          : []
        const latest = fulfillments[fulfillments.length - 1]
        const shipmentStatus = (latest?.shipment_status as string | null) ?? null
        const justDelivered = shipmentStatus === 'delivered'

        const { data: transition } = await admin.rpc(
          'shopify_record_fulfillment_transition',
          {
            p_shop_domain: shopDomain,
            p_order_id: orderId,
            p_fulfillment_status: incomingFulfillment,
            p_shipment_status: shipmentStatus,
            p_just_delivered: justDelivered,
          },
        )
        const row = Array.isArray(transition)
          ? (transition[0] as
              | {
                  transitioned_to_fulfilled?: boolean
                  transitioned_to_delivered?: boolean
                }
              | undefined)
          : null
        if (row?.transitioned_to_fulfilled) {
          triggerType = 'shopify_order_fulfilled'
        }
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

    // Stamp the contact onto the fulfillment-state row (migration 061)
    // so the post-delivery feedback cron messages the customer who
    // actually placed THIS order, instead of guessing from the most
    // recent fulfillment log in the workspace.
    if (orderId > 0) {
      await admin
        .from('shopify_order_fulfillment_state')
        .update({ contact_id: contactId })
        .eq('shop_domain', shopDomain)
        .eq('order_id', orderId)
    }

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
    // Signature already verified above — capture the raw delivery so an
    // exception mid-processing doesn't silently lose the order event
    // (webhook_events_raw, migration 059). We still ack 200 to avoid
    // Shopify's 19-retry storm; recovery is manual/idempotent.
    await captureWebhookFailure({
      provider: `shopify:${topic}`,
      rawBody,
      signature: hmac,
      error: err,
    })
    return NextResponse.json({ ok: true })
  }
}

/**
 * Mantiene en sync la fila de `orders` (Riverz) que la IA creó para este
 * pedido de Shopify. Matchea por (shop_domain, shopify_order_id); si el
 * pedido no lo creó la IA, no hay fila y el update no hace nada.
 *
 * `status` sólo AVANZA (cancelled > fulfilled > paid) para no degradar una
 * fila ya marcada como pagada/enviada en un update no relacionado.
 */
async function reconcileRiverzOrder(
  admin: ReturnType<typeof supabaseAdmin>,
  shopDomain: string,
  order: Record<string, unknown>,
  orderId: number,
): Promise<void> {
  const financial = (order.financial_status as string | null) ?? null
  const fulfillment = (order.fulfillment_status as string | null) ?? null
  const cancelled = !!order.cancelled_at

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  if (financial) update.financial_status = financial
  if (fulfillment) update.fulfillment_status = fulfillment
  if (order.order_status_url) update.order_status_url = order.order_status_url
  if (order.total_price != null) {
    const t =
      typeof order.total_price === 'number'
        ? order.total_price
        : parseFloat(String(order.total_price))
    if (!Number.isNaN(t)) update.total_price = t
  }
  if (cancelled) update.status = 'cancelled'
  else if (fulfillment === 'fulfilled') update.status = 'fulfilled'
  else if (financial === 'paid') update.status = 'paid'

  await admin
    .from('orders')
    .update(update)
    .eq('shop_domain', shopDomain)
    .eq('shopify_order_id', String(orderId))
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
    const trackingUrl = String(latest?.tracking_url ?? '')
    const trackingCompany = String(latest?.tracking_company ?? '')
    const trackingNumber = String(latest?.tracking_number ?? '')
    base.tracking_number = trackingNumber
    base.tracking_company = trackingCompany
    // Shopify only auto-fills tracking_url for carriers in its built-in
    // list. For Andreani / Correo Argentino / OCA the URL is empty and
    // the customer gets a naked number. Fall back to our resolver so
    // existing {{tracking_url}} templates keep working unchanged.
    base.tracking_url =
      trackingUrl ||
      resolveCarrierTrackingUrl(trackingCompany, trackingNumber) ||
      ''
  }

  return base
}
