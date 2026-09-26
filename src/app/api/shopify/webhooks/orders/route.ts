import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { verifyShopifyWebhook } from '@/lib/shopify/webhook-auth';
import { getConnectionByShop } from '@/lib/shopify/connection';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { orderConfirmationReason } from '@/lib/automations/order-confirmation';
import { attributeExperimentOrder } from '@/lib/automations/template-ab-attribution';
import {
  extractShopifyLegacyPhone,
  extractShopifyName,
  extractShopifyPhone,
  upsertWhatsappContact,
} from '@/lib/shopify/contact-upsert';
import { applyCategoryTags } from '@/lib/contacts/tags';
import {
  linkOrphanPurchases,
  recordPurchases,
  shopifyOrderToPurchase,
} from '@/lib/contacts/purchases';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { motorApagado } from '@/lib/workspaces/motor';
import { resolveCarrierTrackingUrl } from '@/lib/shopify/carrier-tracking';
import { shouldAnnounceTrackingNumber } from '@/lib/shopify/tracking-notice';
import { isDuplicateDelivery } from '@/lib/shopify/webhook-dedup';
import { captureWebhookFailure } from '@/lib/webhooks/capture';
import { getAdapter } from '@/lib/channels/registry';
import { fmtMoney } from '@/lib/shopify/create-checkout';
import { resolveOfferChosen } from '@/lib/shopify/offers';
import { attributeWebchatOrder } from '@/lib/channels/webchat/attribution';
import { marcarCuponesUsados } from '@/lib/shopify/discounts';
import { espejarPedidoDeShopify } from '@/lib/shopify/espejo-de-pedido';
import { buildVarsForOrder } from '@/lib/shopify/order-vars';
import { ensureShopifyOrderCustomer } from '@/lib/shopify/order-customer';
import { emitWebhook } from '@/lib/webhooks/outbound';
import type {
  AutomationTriggerType,
  Channel,
  ChannelConnection,
  Contact,
  Conversation,
} from '@/types';

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
  const rawBody = await request.text();
  const hmac = request.headers.get('x-shopify-hmac-sha256');
  const verdict = await verifyShopifyWebhook(supabaseAdmin(), request, rawBody);
  if (verdict === 'unconfigured') {
    return NextResponse.json({ error: 'not configured' }, { status: 503 });
  }
  if (verdict === 'invalid') {
    return new NextResponse('Invalid HMAC', { status: 401 });
  }

  const shopDomain = request.headers.get('x-shopify-shop-domain');
  const topic = request.headers.get('x-shopify-topic') || '';
  if (!shopDomain) return NextResponse.json({ ok: true });

  if (topic !== 'orders/create' && topic !== 'orders/updated') {
    return NextResponse.json({ ok: true, ignored: topic });
  }

  try {
    const admin = supabaseAdmin();

    // Per-delivery dedupe (migration 059). Shopify retries up to 19x
    // over ~48h, so any post-side-effect crash without dedupe would
    // re-send the order confirmation on every retry.
    const webhookId = request.headers.get('x-shopify-webhook-id');
    if (await isDuplicateDelivery(admin, shopDomain, webhookId, topic)) {
      return NextResponse.json({ ok: true, duplicate: true });
    }

    const conn = await getConnectionByShop(admin, shopDomain);
    if (!conn) return NextResponse.json({ ok: true });

    // Migration 055 made shopify_connections.workspace_id NOT NULL, so we
    // read it straight off the connection. The legacy owner_id lookup is
    // kept as a defense for any in-flight requests that observed pre-055
    // rows; harmless overhead once 055 settles.
    const workspaceId =
      conn.row.workspace_id ||
      (await resolveWorkspaceIdForUser(admin, conn.row.user_id));
    if (!workspaceId) {
      console.warn(
        '[shopify] orders webhook: no workspace for connection',
        conn.row.id
      );
      return NextResponse.json({ ok: true, skipped: 'no_workspace' });
    }
    const order = JSON.parse(rawBody) as Record<string, unknown>;
    const orderId = Number(order.id ?? 0);
    if (topic === 'orders/create' && orderId > 0 && !order.customer) {
      const linked = await ensureShopifyOrderCustomer({
        shopDomain,
        accessToken: conn.accessToken,
        order,
      });
      if (linked.customer) order.customer = linked.customer;
      if (linked.status === 'failed') {
        console.warn('[shopify] no se pudo vincular el cliente al pedido', {
          shopDomain,
          orderId,
        });
      }
    }
    const incomingFulfillment =
      (order.fulfillment_status as string | null | undefined) ?? null;
    const fulfillments = Array.isArray(order.fulfillments)
      ? (order.fulfillments as Record<string, unknown>[])
      : [];
    const latestFulfillment = fulfillments[fulfillments.length - 1];
    const shipmentStatus = String(latestFulfillment?.shipment_status ?? '');
    const trackingNumber = String(latestFulfillment?.tracking_number ?? '');
    const trackingCompany = String(latestFulfillment?.tracking_company ?? '');
    const trackingUrl = String(latestFulfillment?.tracking_url ?? '');

    let previousLogistics: {
      fulfillment_status?: string | null;
      shipment_status?: string | null;
      tracking_number?: string | null;
      tracking_company?: string | null;
      tracking_url?: string | null;
    } | null = null;

    if (topic === 'orders/updated' && orderId > 0) {
      const [{ data: mirrored }, { data: state }] = await Promise.all([
        admin
          .from('orders')
          .select('tracking_number, tracking_company, tracking_url')
          .eq('workspace_id', workspaceId)
          .eq('shop_domain', shopDomain)
          .eq('shopify_order_id', String(orderId))
          .maybeSingle(),
        admin
          .from('shopify_order_fulfillment_state')
          .select('fulfillment_status, shipment_status')
          .eq('shop_domain', shopDomain)
          .eq('order_id', orderId)
          .maybeSingle(),
      ]);
      previousLogistics = {
        ...((mirrored as Record<string, string | null> | null) ?? {}),
        ...((state as Record<string, string | null> | null) ?? {}),
      };
    }

    // El espejo en Riverz (tabla `orders`, migración 080). Antes esto era un
    // UPDATE: sólo tocaba los pedidos que había creado la IA, y una venta
    // hecha por una persona sola en la tienda no matcheaba ninguna fila y no
    // quedaba registrada en ningún lado. Ahora la fila se crea si no existe.
    // Best-effort: el pedido ya está hecho, esto no puede tumbar el webhook.
    if (orderId > 0) {
      await espejarPedidoDeShopify(admin, {
        workspaceId,
        shopDomain,
        order,
      }).catch((err) =>
        console.error('[shopify] espejo del pedido falló:', err)
      );
    }

    // Historial de compras del contacto (migración 172). Va ANTES de decidir
    // si hay algo que anunciar: un pedido que no dispara ninguna automatización
    // igual es una compra, y si no se guarda acá se pierde — Shopify sólo deja
    // releer los últimos 60 días sin el permiso `read_all_orders`.
    {
      const purchase = shopifyOrderToPurchase(shopDomain, order);
      if (purchase) {
        await recordPurchases(admin, workspaceId, [purchase]).catch((err) =>
          console.error('[shopify] historial de compras falló:', err)
        );
      }
    }

    // Una actualización puede traer más de una transición; se emiten todas.
    let triggerTypes: AutomationTriggerType[] = [];
    if (topic === 'orders/create') {
      triggerTypes = ['shopify_order_created'];
      if (orderId > 0) {
        // Atomic claim — migration 059's RPC. Returns true the FIRST
        // time we see this (shop_domain, order_id) and false on every
        // replay. Without this, the per-webhook-id dedupe above only
        // catches retries of the SAME delivery; a brand-new delivery
        // for the SAME order (Shopify's deduper occasionally fails)
        // would still re-fire the "Nuevo pedido" template.
        const { data: claimed } = await admin.rpc(
          'shopify_claim_order_created',
          {
            p_shop_domain: shopDomain,
            p_order_id: orderId,
            p_fulfillment_status: incomingFulfillment,
          }
        );
        if (claimed !== true) {
          return NextResponse.json({ ok: true, skipped: 'duplicate_order' });
        }
      }
      // Si la orden vino de un checkout que ya teníamos persistido,
      // marcamos ese checkout como completado. Shopify reutiliza el
      // mismo token entre el checkout y la orden, así que un upsert
      // con shop_domain+checkout_id alcanza para cerrarlo. Si nunca
      // vimos el checkout (compra rápida), no pasa nada — el update
      // no hace nada con filas inexistentes.
      const checkoutToken = String(
        order.checkout_token ?? order.cart_token ?? ''
      ).trim();
      if (checkoutToken) {
        await admin
          .from('shopify_checkouts')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('shop_domain', shopDomain)
          .eq('checkout_id', checkoutToken);
      }

      // Chat web: si el carrito venía estampado con el id del visitante, esta
      // compra es de alguien que estuvo conversando en la tienda. Se le pone
      // nombre al visitante anónimo, se lo fusiona con el cliente que el
      // comercio ya conocía y el pedido queda atado a SU conversación.
      //
      // Va antes de todo lo demás a propósito: lo que sigue se corta si el
      // pedido no trae teléfono, y un comprador por chat bien puede no
      // haberlo dejado. La atribución no puede depender de eso.
      // Los cupones que el agente emitió y esta compra usó: se sellan para no
      // volver a ofrecer un código que Shopify ya dio por agotado.
      {
        const usados = Array.isArray(order.discount_codes)
          ? (order.discount_codes as Array<{ code?: string }>)
              .map((d) => String(d?.code ?? ''))
              .filter(Boolean)
          : [];
        if (usados.length > 0) {
          await marcarCuponesUsados(admin, workspaceId, usados).catch((err) =>
            console.error('[shopify] no se pudieron sellar los cupones:', err)
          );
        }
      }

      await attributeWebchatOrder(admin, {
        workspaceId,
        shopDomain,
        order,
      }).catch((err) =>
        console.error('[shopify] webchat attribution failed:', err)
      );

      // Sembrar el estado inicial del pedido (sin disparar) para que la primera
      // actualización real compute transiciones correctas (pagado/cancelado/…)
      // en vez de disparar en el primer avistamiento. No pisa si ya existe.
      if (orderId > 0) {
        await admin.from('shopify_order_fulfillment_state').upsert(
          {
            shop_domain: shopDomain,
            order_id: orderId,
            fulfillment_status: incomingFulfillment,
            financial_status: (order.financial_status as string | null) ?? null,
            cancelled: !!order.cancelled_at,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'shop_domain,order_id', ignoreDuplicates: true }
        );
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
        const justDelivered = shipmentStatus === 'delivered';

        const { data: transition } = await admin.rpc(
          'shopify_record_fulfillment_transition',
          {
            p_shop_domain: shopDomain,
            p_order_id: orderId,
            p_fulfillment_status: incomingFulfillment,
            p_shipment_status: shipmentStatus || null,
            p_just_delivered: justDelivered,
            p_financial_status:
              (order.financial_status as string | null) ?? null,
            p_cancelled: !!order.cancelled_at,
          }
        );
        const row = Array.isArray(transition)
          ? (transition[0] as
              | {
                  transitioned_to_fulfilled?: boolean;
                  transitioned_to_delivered?: boolean;
                  transitioned_to_paid?: boolean;
                  transitioned_to_cancelled?: boolean;
                  transitioned_to_refunded?: boolean;
                }
              | undefined)
          : null;
        const trackingReady = shouldAnnounceTrackingNumber(
          trackingNumber,
          previousLogistics?.tracking_number,
        );
        // Una actualización puede traer VARIAS transiciones a la vez: Shopify
        // manda un solo `orders/updated` cuando alguien marca pagado y
        // despacha en el mismo movimiento, que es exactamente lo que hace
        // quien confirma una transferencia y arma el envío seguido.
        //
        // Antes se elegía una sola por prioridad y el resto se perdía en
        // silencio: pagado ganaba, y ese pedido nunca recibía su número de
        // seguimiento. Ahora se emiten todas, en el orden en que le importan
        // al cliente. Cancelado y reembolsado siguen siendo excluyentes:
        // avisar "tu pedido salió" de un pedido cancelado es peor que no
        // avisar nada.
        if (row?.transitioned_to_cancelled) {
          triggerTypes = ['shopify_order_cancelled'];
        } else if (row?.transitioned_to_refunded) {
          triggerTypes = ['shopify_order_refunded'];
        } else {
          if (row?.transitioned_to_paid)
            triggerTypes.push('shopify_order_paid');
          // Dropi publica la guía mientras todavía figura «preparado para
          // transportadora». Eso ya alcanza para que el cliente la siga. Al
          // pasar luego a fulfilled, previousLogistics contiene la misma guía
          // y no se repite el mensaje.
          if (trackingReady)
            triggerTypes.push('shopify_order_fulfilled');
          if (row?.transitioned_to_delivered)
            triggerTypes.push('shopify_order_delivered');
        }
      }
    }

    // Shopify es la fuente que Dropi actualiza cuando genera la guía. Así,
    // Make, Zapier y n8n reciben tanto el pedido inicial como cada cambio de
    // fulfillment sin necesitar acceso a la API privada de Dropi.
    const eventData = {
      shop_domain: shopDomain,
      order_id: String(order.id ?? ''),
      order_name: String(order.name ?? ''),
      financial_status: String(order.financial_status ?? ''),
      fulfillment_status: String(order.fulfillment_status ?? ''),
      shipment_status: shipmentStatus,
      tracking_number: trackingNumber,
      tracking_company: trackingCompany,
      tracking_url:
        trackingUrl ||
        resolveCarrierTrackingUrl(trackingCompany, trackingNumber) ||
        String(order.order_status_url ?? ''),
    };
    void emitWebhook(
      workspaceId,
      topic === 'orders/create' ? 'order.created' : 'order.updated',
      eventData
    ).catch((error) =>
      console.error('[webhook] Shopify order delivery failed', error)
    );
    if (triggerTypes.includes('shopify_order_paid')) {
      void emitWebhook(workspaceId, 'payment.approved', eventData).catch(
        (error) =>
          console.error('[webhook] Shopify payment delivery failed', error)
      );
    }
    if (topic === 'orders/updated') {
      const shipmentChanged =
        (incomingFulfillment != null &&
          incomingFulfillment !== previousLogistics?.fulfillment_status) ||
        (shipmentStatus !== '' &&
          shipmentStatus !== previousLogistics?.shipment_status);
      const trackingChanged =
        trackingNumber !== '' &&
        (trackingNumber !== previousLogistics?.tracking_number ||
          trackingCompany !== (previousLogistics?.tracking_company ?? '') ||
          trackingUrl !== (previousLogistics?.tracking_url ?? ''));

      if (shipmentChanged) {
        void emitWebhook(workspaceId, 'shipment.updated', eventData).catch(
          (error) =>
            console.error('[webhook] Shopify shipment delivery failed', error)
        );
      }
      if (trackingChanged) {
        void emitWebhook(workspaceId, 'tracking.updated', eventData).catch(
          (error) =>
            console.error('[webhook] Shopify tracking delivery failed', error)
        );
      }
    }

    const { data: confirmationConnection } = await admin.from('channel_connections').select('config')
      .eq('workspace_id', workspaceId).eq('channel', 'voice').maybeSingle();
    const confirmedTag = confirmationConnection?.config?.order_writeback?.confirmed_tag || 'Confirmado';
    const confirmation = orderConfirmationReason(order, confirmedTag);
    if ((confirmation === 'paid' && (topic === 'orders/create' || triggerTypes.includes('shopify_order_paid'))) ||
      (confirmation === 'cod_confirmed' && !incomingFulfillment)) {
      triggerTypes.push('shopify_order_confirmed');
    }
    if (triggerTypes.length === 0) {
      return NextResponse.json({ ok: true, ignored: 'no_transition' });
    }

    const phone = extractShopifyPhone(order);
    if (!phone) return NextResponse.json({ ok: true, skipped: 'no_phone' });
    const name = extractShopifyName(order);

    const contactId = await upsertWhatsappContact(admin, {
      workspaceId,
      phone,
      name,
      email: (order.email as string) || undefined,
      legacyExternalId: extractShopifyLegacyPhone(order),
    });
    if (topic === 'orders/create' && contactId && orderId > 0) {
      const { data: mirroredOrder } = await admin
        .from('orders')
        .select('id, total_price, currency')
        .eq('workspace_id', workspaceId)
        .eq('shop_domain', shopDomain)
        .eq('shopify_order_id', String(orderId))
        .maybeSingle();
      if (mirroredOrder) {
        await attributeExperimentOrder(admin, {
          workspaceId,
          contactId,
          orderId: String((mirroredOrder as { id: string }).id),
          total:
            Number(
              (mirroredOrder as { total_price?: string | number | null })
                .total_price ?? 0
            ) || null,
          currency:
            (mirroredOrder as { currency?: string | null }).currency ?? null,
          orderedAt: String(order.created_at ?? new Date().toISOString()),
        }).catch((err) =>
          console.error('[ab-test] order attribution failed:', err)
        );
      }
    }
    if (!contactId) return NextResponse.json({ ok: true });

    // El espejo se escribe antes de resolver el teléfono. Sellar ahora el
    // contacto sobre `orders` hace que el pedido aparezca en el panel Shopify
    // de esta conversación; antes la fila quedaba huérfana aunque el webhook
    // sí hubiera creado el contacto y enviado la automatización.
    if (orderId > 0) {
      const { error: orderContactError } = await admin
        .from('orders')
        .update({ contact_id: contactId })
        .eq('workspace_id', workspaceId)
        .eq('shop_domain', shopDomain)
        .eq('shopify_order_id', String(orderId));
      if (orderContactError) {
        console.error(
          '[shopify] order contact link failed:',
          orderContactError
        );
      }
    }

    // También se enganchan las compras históricas del mismo email o teléfono
    // que hubieran quedado sueltas.
    await linkOrphanPurchases(admin, workspaceId, {
      id: contactId,
      email: (order.email as string) ?? null,
      phone,
    }).catch((err) =>
      console.error('[shopify] enganche de compras falló:', err)
    );

    // Stamp the contact onto the fulfillment-state row (migration 061)
    // so the post-delivery feedback cron messages the customer who
    // actually placed THIS order, instead of guessing from the most
    // recent fulfillment log in the workspace.
    if (orderId > 0) {
      await admin
        .from('shopify_order_fulfillment_state')
        .update({ contact_id: contactId })
        .eq('shop_domain', shopDomain)
        .eq('order_id', orderId);
    }

    // Oferta elegida (flujos de recompra): derivamos qué oferta compró el
    // cliente por número de unidades y la persistimos sobre el contacto en
    // el momento de compra, así la IA la conoce en futuras conversaciones de
    // recompra. Se calcula para todos los pedidos (también los del asistente)
    // y se inyecta como var {{vars.offer_chosen}} más abajo.
    const offer = await resolveOfferChosen(admin, workspaceId, order);
    if (triggerTypes.includes('shopify_order_created')) {
      // Producto comprado = título del primer ítem del pedido. Se guarda en el
      // contacto para poder ramificar/personalizar recompras por producto.
      const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
      const firstItemTitle = String(
        (lineItems[0] as Record<string, unknown> | undefined)?.title ?? ''
      ).trim();
      const contactUpdate: Record<string, unknown> = {};
      if (offer.label) {
        contactUpdate.last_offer_chosen = offer.label;
        contactUpdate.last_offer_units = offer.units;
        contactUpdate.last_offer_at = new Date().toISOString();
      }
      if (firstItemTitle) contactUpdate.last_product = firstItemTitle;
      if (Object.keys(contactUpdate).length > 0) {
        const { error: offerErr } = await admin
          .from('contacts')
          .update(contactUpdate)
          .eq('id', contactId);
        if (offerErr)
          console.error(
            '[shopify] last_offer/product update failed:',
            offerErr
          );
      }
    }

    // Categorize the buyer so they're selectable in segments / broadcasts /
    // automations: comprador (o comprador-recurrente) + la oferta elegida +
    // el rango de unidades. Idempotente; no envía nada.
    try {
      const ordersCount = Number(
        (order.customer as Record<string, unknown> | undefined)?.orders_count ??
          1
      );
      await applyCategoryTags(admin, workspaceId, contactId, {
        ordersCount: ordersCount > 0 ? ordersCount : 1,
        isAbandoned: false,
        offerLabel: offer.label,
        units: offer.units,
      });
    } catch (e) {
      console.error('[shopify] categorize order contact failed:', e);
    }

    // Atribución por pedido: si el pedido vino del asistente (link con
    // riverz_origin=ai, o pedido creado por la tool create_order con tag
    // riverz-ia), el ASISTENTE confirma el pago con sus propias palabras.
    //
    // Antes esto cortaba acá con un `return`, y así se llevaba puesto TODO lo
    // demás que cuelga del mismo disparador. El recordatorio de transferencia
    // —que habla recién a la hora y sólo si no pagó— no tenía nada que ver
    // con la confirmación duplicada y quedaba muerto justo para los pedidos
    // que cierra la IA, que son los que más lo necesitan.
    //
    // Ahora sólo se saltea lo que duplicaría: las automatizaciones que hablan
    // al instante. Las que esperan siguen su curso.
    const confirmadoPorLaIA =
      triggerTypes.includes('shopify_order_created') &&
      isAiAttributedOrder(order);
    if (confirmadoPorLaIA) {
      await sendAiOrderConfirmation(admin, {
        workspaceId,
        contactId,
        order,
        name,
        shopDomain,
      }).catch((err) =>
        console.error('[shopify] ai order confirmation failed:', err)
      );
    }

    // Las variables dependen del evento (el tracking sólo existe en el
    // despacho), así que se arman una vez por disparador.
    let vars: Record<string, string> = {};
    for (const triggerType of triggerTypes) {
      vars = buildVarsForOrder(triggerType, order, name);
      vars.purchase_shop_domain = shopDomain;
      vars.offer_chosen = offer.label;
      vars.offer_units = offer.units > 0 ? String(offer.units) : '';

      await runAutomationsForTrigger({
        workspaceId,
        triggerType,
        contactId,
        context: { vars },
        skipImmediateSenders: confirmadoPorLaIA,
      }).catch((err) => console.error('[shopify] dispatch failed:', err));
    }

    // Acá había un segundo disparador de llamadas, invisible: si un agente
    // tenía prendido el objetivo "order_confirmation", el pedido hacía sonar
    // un teléfono sin que existiera ninguna automatización que lo dijera. Una
    // llamada saliente ahora nace SIEMPRE de un nodo «Llamar con IA» en el
    // lienzo — que es donde el comercio puede verla, editarla y apagarla.
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[shopify] orders webhook error:', err);
    // Signature already verified above — capture the raw delivery so an
    // exception mid-processing doesn't silently lose the order event
    // (webhook_events_raw, migration 059). We still ack 200 to avoid
    // Shopify's 19-retry storm; recovery is manual/idempotent.
    await captureWebhookFailure({
      provider: `shopify:${topic}`,
      rawBody,
      signature: hmac,
      error: err,
    });
    return NextResponse.json({ ok: true });
  }
}

/** ¿El pedido lo originó el asistente? Link con riverz_origin=ai
 *  (note_attributes) o pedido creado por la tool create_order (tag
 *  riverz-ia). */
function isAiAttributedOrder(order: Record<string, unknown>): boolean {
  const attrs = Array.isArray(order.note_attributes)
    ? (order.note_attributes as Array<{ name?: string; value?: string }>)
    : [];
  if (attrs.some((a) => a?.name === 'riverz_origin' && a?.value === 'ai')) {
    return true;
  }
  return String(order.tags ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .includes('riverz-ia');
}

function formatOrderTotal(order: Record<string, unknown>): string {
  const n = parseFloat(String(order.total_price ?? ''));
  if (Number.isNaN(n)) return '';
  return fmtMoney(n, String(order.currency ?? 'ARS'));
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
    workspaceId: string;
    contactId: string;
    order: Record<string, unknown>;
    name: string | undefined;
    shopDomain: string;
  }
): Promise<void> {
  const { workspaceId, contactId, order, name, shopDomain } = args;

  // Es un mensaje que sale solo, disparado por el pedido: con el motor
  // apagado no sale, igual que las automatizaciones del mismo webhook.
  if (await motorApagado(admin, workspaceId)) return;

  // Elegir la conversación correcta:
  //  1) Si el pedido lo creó la tool create_order, la fila de `orders`
  //     guarda su conversation_id exacto → lo usamos.
  //  2) Si vino de un link create_checkout (sin fila en orders), tomamos
  //     la conversación con pending_checkout_at.
  //  3) Fallback: la más reciente del contacto.
  // Así nunca limpiamos el pending de una conversación ajena.
  let conv: Conversation | null = null;
  const shopifyOrderId = order.id != null ? String(order.id) : null;
  if (shopifyOrderId) {
    const { data: orderRow } = await admin
      .from('orders')
      .select('conversation_id')
      .eq('shop_domain', shopDomain)
      .eq('shopify_order_id', shopifyOrderId)
      .maybeSingle();
    const convId = (orderRow as { conversation_id?: string } | null)
      ?.conversation_id;
    if (convId) {
      const { data } = await admin
        .from('conversations')
        .select('*')
        .eq('id', convId)
        .maybeSingle();
      conv = (data as Conversation | null) ?? null;
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
      .limit(10);
    const convs = (convsRaw ?? []) as Conversation[];
    conv = convs.find((c) => c.pending_checkout_at) ?? convs[0] ?? null;
  }
  if (!conv) {
    console.warn(
      '[shopify] ai confirmation: sin conversación para contacto',
      contactId
    );
    return;
  }

  let connection: ChannelConnection | null = null;
  if (conv.connection_id) {
    const { data } = await admin
      .from('channel_connections')
      .select('*')
      .eq('id', conv.connection_id)
      .maybeSingle();
    connection = (data as ChannelConnection | null) ?? null;
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
      .maybeSingle();
    connection = (data as ChannelConnection | null) ?? null;
  }
  if (!connection) {
    console.warn('[shopify] ai confirmation: sin conexión de canal', conv.id);
    return;
  }

  const { data: contactRow } = await admin
    .from('contacts')
    .select('*')
    .eq('id', contactId)
    .maybeSingle();
  if (!contactRow) {
    console.warn(
      '[shopify] ai confirmation: contacto no encontrado',
      contactId
    );
    return;
  }
  const contact = contactRow as Contact;

  const first = (name || contact.name || '').trim().split(/\s+/)[0];
  const orderName = String(order.name ?? '#' + (order.order_number ?? ''));
  const total = formatOrderTotal(order);
  const text =
    `¡Listo${first ? ' ' + first : ''}! 🎉 Confirmamos el pago de tu pedido ${orderName}` +
    `${total ? ' por ' + total : ''}. ¡Gracias por tu compra! Cualquier cosa, escribime por acá.`;

  const adapter = getAdapter(conv.channel as Channel);
  const sendResult = await adapter.sendText({
    channel: conv.channel as Channel,
    connection,
    conversation: conv,
    contact,
    text,
  });
  const now = new Date().toISOString();
  await admin.from('messages').insert({
    conversation_id: conv.id,
    channel: conv.channel,
    sender_type: 'bot',
    content_type: 'text',
    content_text: text,
    message_id: sendResult.externalMessageId,
    status: sendResult.status ?? 'sent',
    // Lo dispara el pedido de Shopify, no una persona ni el asistente
    // conversando: la bandeja lo dice tal cual (migración 143).
    origin: 'order_update',
  });
  const convUpdate: Record<string, unknown> = {
    last_message_text: text.slice(0, 200),
    last_message_at: now,
    last_sender_type: 'bot',
    updated_at: now,
  };
  // Solo limpiamos el pago pendiente si ESTA conversación lo tenía — así no
  // pisamos el pending de otra conversación concurrente (p. ej. un
  // create_order que cae en la conversación equivocada).
  if (conv.pending_checkout_at) {
    convUpdate.pending_checkout_at = null;
    convUpdate.pending_checkout_url = null;
  }
  await admin.from('conversations').update(convUpdate).eq('id', conv.id);
}

// resolveOfferChosen lives in '@/lib/shopify/offers' (shared with the
// historical backfill so both compute the chosen offer identically).
