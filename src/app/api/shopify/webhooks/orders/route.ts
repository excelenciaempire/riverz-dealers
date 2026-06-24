import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { verifyWebhookHmac } from '@/lib/shopify/oauth'
import { getConnectionByShop } from '@/lib/shopify/connection'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import {
  extractShopifyLegacyPhone,
  extractShopifyName,
  extractShopifyPhone,
  upsertWhatsappContact,
} from '@/lib/shopify/contact-upsert'
import { applyCategoryTags } from '@/lib/contacts/tags'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { resolveCarrierTrackingUrl } from '@/lib/shopify/carrier-tracking'
import { isDuplicateDelivery } from '@/lib/shopify/webhook-dedup'
import { captureWebhookFailure } from '@/lib/webhooks/capture'
import { getAdapter } from '@/lib/channels/registry'
import { fmtMoney } from '@/lib/shopify/create-checkout'
import { resolveOfferChosen } from '@/lib/shopify/offers'
import type {
  AutomationTriggerType,
  Channel,
  ChannelConnection,
  Contact,
  Conversation,
} from '@/types'

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
      legacyExternalId: extractShopifyLegacyPhone(order),
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

    // Oferta elegida (flujos de recompra): derivamos qué oferta compró el
    // cliente por número de unidades y la persistimos sobre el contacto en
    // el momento de compra, así la IA la conoce en futuras conversaciones de
    // recompra. Se calcula para todos los pedidos (también los del asistente)
    // y se inyecta como var {{vars.offer_chosen}} más abajo.
    const offer = await resolveOfferChosen(admin, workspaceId, order)
    if (triggerType === 'shopify_order_created' && offer.label) {
      const { error: offerErr } = await admin
        .from('contacts')
        .update({
          last_offer_chosen: offer.label,
          last_offer_units: offer.units,
          last_offer_at: new Date().toISOString(),
        })
        .eq('id', contactId)
      if (offerErr)
        console.error('[shopify] last_offer update failed:', offerErr)
    }

    // Categorize the buyer so they're selectable in segments / broadcasts /
    // automations: comprador (o comprador-recurrente) + la oferta elegida +
    // el rango de unidades. Idempotente; no envía nada.
    try {
      const ordersCount = Number(
        (order.customer as Record<string, unknown> | undefined)?.orders_count ??
          1,
      )
      await applyCategoryTags(admin, workspaceId, contactId, {
        ordersCount: ordersCount > 0 ? ordersCount : 1,
        isAbandoned: false,
        offerLabel: offer.label,
        units: offer.units,
      })
    } catch (e) {
      console.error('[shopify] categorize order contact failed:', e)
    }

    // Atribución por pedido: si el pedido vino del asistente (link con
    // riverz_origin=ai, o pedido creado por la tool create_order con tag
    // riverz-ia), el ASISTENTE confirma el pago y NOS SALTAMOS la
    // automatización "Nuevo pedido" para no duplicar el mensaje. Solo en
    // orders/create (la confirmación de pago); el flujo de fulfilled sigue
    // usando la automatización normal.
    if (triggerType === 'shopify_order_created' && isAiAttributedOrder(order)) {
      await sendAiOrderConfirmation(admin, {
        workspaceId,
        contactId,
        order,
        name,
        shopDomain,
      }).catch((err) =>
        console.error('[shopify] ai order confirmation failed:', err),
      )
      return NextResponse.json({ ok: true, ai_confirmed: true })
    }

    const vars = buildVarsForOrder(triggerType, order, name)
    vars.offer_chosen = offer.label
    vars.offer_units = offer.units > 0 ? String(offer.units) : ''

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
  else if (financial === 'refunded' || financial === 'partially_refunded')
    update.status = 'refunded'
  else if (financial === 'voided') update.status = 'cancelled'
  else if (fulfillment === 'fulfilled') update.status = 'fulfilled'
  else if (financial === 'paid') update.status = 'paid'

  await admin
    .from('orders')
    .update(update)
    .eq('shop_domain', shopDomain)
    .eq('shopify_order_id', String(orderId))
}

/** ¿El pedido lo originó el asistente? Link con riverz_origin=ai
 *  (note_attributes) o pedido creado por la tool create_order (tag
 *  riverz-ia). */
function isAiAttributedOrder(order: Record<string, unknown>): boolean {
  const attrs = Array.isArray(order.note_attributes)
    ? (order.note_attributes as Array<{ name?: string; value?: string }>)
    : []
  if (attrs.some((a) => a?.name === 'riverz_origin' && a?.value === 'ai')) {
    return true
  }
  return String(order.tags ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .includes('riverz-ia')
}

function formatOrderTotal(order: Record<string, unknown>): string {
  const n = parseFloat(String(order.total_price ?? ''))
  if (Number.isNaN(n)) return ''
  return fmtMoney(n, String(order.currency ?? 'ARS'))
}

/**
 * Confirmación de pago por el asistente (atribución por pedido). Busca la
 * conversación del contacto (prefiere la que tiene checkout pendiente),
 * manda un mensaje templado por el canal, lo persiste y limpia el
 * pending_checkout. Best-effort: cualquier fallo se loguea sin romper.
 */
async function sendAiOrderConfirmation(
  admin: ReturnType<typeof supabaseAdmin>,
  args: {
    workspaceId: string
    contactId: string
    order: Record<string, unknown>
    name: string | undefined
    shopDomain: string
  },
): Promise<void> {
  const { workspaceId, contactId, order, name, shopDomain } = args

  // Elegir la conversación correcta:
  //  1) Si el pedido lo creó la tool create_order, la fila de `orders`
  //     guarda su conversation_id exacto → lo usamos.
  //  2) Si vino de un link create_checkout (sin fila en orders), tomamos
  //     la conversación con pending_checkout_at.
  //  3) Fallback: la más reciente del contacto.
  // Así nunca limpiamos el pending de una conversación ajena.
  let conv: Conversation | null = null
  const shopifyOrderId = order.id != null ? String(order.id) : null
  if (shopifyOrderId) {
    const { data: orderRow } = await admin
      .from('orders')
      .select('conversation_id')
      .eq('shop_domain', shopDomain)
      .eq('shopify_order_id', shopifyOrderId)
      .maybeSingle()
    const convId = (orderRow as { conversation_id?: string } | null)?.conversation_id
    if (convId) {
      const { data } = await admin
        .from('conversations')
        .select('*')
        .eq('id', convId)
        .maybeSingle()
      conv = (data as Conversation | null) ?? null
    }
  }
  if (!conv) {
    const { data: convsRaw } = await admin
      .from('conversations')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('contact_id', contactId)
      .in('channel', ['whatsapp', 'instagram', 'messenger'])
      // Soft-delete (migración 085): skip threads deleted from the bandeja so
      // the order-confirmation message doesn't land in an invisible row.
      .is('deleted_at', null)
      .order('last_message_at', { ascending: false })
      .limit(10)
    const convs = (convsRaw ?? []) as Conversation[]
    conv = convs.find((c) => c.pending_checkout_at) ?? convs[0] ?? null
  }
  if (!conv) {
    console.warn(
      '[shopify] ai confirmation: sin conversación para contacto',
      contactId,
    )
    return
  }

  let connection: ChannelConnection | null = null
  if (conv.connection_id) {
    const { data } = await admin
      .from('channel_connections')
      .select('*')
      .eq('id', conv.connection_id)
      .maybeSingle()
    connection = (data as ChannelConnection | null) ?? null
  }
  if (!connection) {
    const { data } = await admin
      .from('channel_connections')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('channel', conv.channel)
      .neq('status', 'disconnected')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    connection = (data as ChannelConnection | null) ?? null
  }
  if (!connection) {
    console.warn('[shopify] ai confirmation: sin conexión de canal', conv.id)
    return
  }

  const { data: contactRow } = await admin
    .from('contacts')
    .select('*')
    .eq('id', contactId)
    .maybeSingle()
  if (!contactRow) {
    console.warn('[shopify] ai confirmation: contacto no encontrado', contactId)
    return
  }
  const contact = contactRow as Contact

  const first = (name || contact.name || '').trim().split(/\s+/)[0]
  const orderName = String(order.name ?? '#' + (order.order_number ?? ''))
  const total = formatOrderTotal(order)
  const text =
    `¡Listo${first ? ' ' + first : ''}! 🎉 Confirmamos el pago de tu pedido ${orderName}` +
    `${total ? ' por ' + total : ''}. ¡Gracias por tu compra! Cualquier cosa, escribime por acá.`

  const adapter = getAdapter(conv.channel as Channel)
  const sendResult = await adapter.sendText({
    channel: conv.channel as Channel,
    connection,
    conversation: conv,
    contact,
    text,
  })
  const now = new Date().toISOString()
  await admin.from('messages').insert({
    conversation_id: conv.id,
    channel: conv.channel,
    sender_type: 'bot',
    content_type: 'text',
    content_text: text,
    message_id: sendResult.externalMessageId,
    status: sendResult.status ?? 'sent',
  })
  const convUpdate: Record<string, unknown> = {
    last_message_text: text.slice(0, 200),
    last_message_at: now,
    last_sender_type: 'bot',
    updated_at: now,
  }
  // Solo limpiamos el pago pendiente si ESTA conversación lo tenía — así no
  // pisamos el pending de otra conversación concurrente (p. ej. un
  // create_order que cae en la conversación equivocada).
  if (conv.pending_checkout_at) {
    convUpdate.pending_checkout_at = null
    convUpdate.pending_checkout_url = null
  }
  await admin.from('conversations').update(convUpdate).eq('id', conv.id)
}

// resolveOfferChosen lives in '@/lib/shopify/offers' (shared with the
// historical backfill so both compute the chosen offer identically).

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
