import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveShopifyAdmin } from '@/lib/shopify/order-tags';
import { resolveCarrierTrackingUrl, displayCarrierName } from '@/lib/shopify/carrier-tracking';
import { buildVarsForOrder } from '@/lib/shopify/order-vars';
import { resolveOfferChosen } from '@/lib/shopify/offers';
import {
  extractShopifyLegacyPhone,
  extractShopifyName,
  extractShopifyPhone,
  upsertWhatsappContact,
} from '@/lib/shopify/contact-upsert';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { emitWebhook } from '@/lib/webhooks/outbound';

/**
 * PEDIDOS SIN GUÍA.
 *
 * Riverz se entera del despacho por Shopify: la app logística (Dropi,
 * Dropify…) crea el envío en la tienda y ese cambio dispara la plantilla con
 * la guía. Cuando la app no sincroniza, el paquete sale igual, pero para
 * Shopify el pedido sigue sin preparar y el cliente nunca recibe su guía.
 *
 * La detección vive en SQL (`orders_missing_tracking`, migración 281) para
 * que el aviso de Inicio y esta pantalla cuenten lo mismo. Acá está lo que
 * hace el comercio con eso: cargar la guía que tiene en su app logística, o
 * marcar que el pedido no se despacha.
 */

export interface MissingTrackingOrder {
  id: string;
  order_number: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  created_at: string;
  total_price: number | null;
  currency: string | null;
  financial_status: string | null;
  line_items: Array<{ title?: string; variant_title?: string; quantity?: number }> | null;
}

export async function listOrdersMissingTracking(
  db: SupabaseClient,
  workspaceId: string,
): Promise<MissingTrackingOrder[]> {
  const { data, error } = await db
    .rpc('orders_missing_tracking', { p_workspace_id: workspaceId })
    .select('id, order_number, customer_name, customer_phone, created_at, total_price, currency, financial_status, line_items')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(`orders_missing_tracking: ${error.message}`);
  return (data ?? []) as MissingTrackingOrder[];
}

/**
 * La guía tal como se escribe en una plantilla: sin espacios ni separadores
 * de copiar y pegar. Devuelve null si no parece una guía, para no mandarle al
 * cliente un texto cualquiera como número de seguimiento.
 */
export function normalizeTrackingNumber(raw: unknown): string | null {
  const value = String(raw ?? '').replace(/[\s.]/g, '').trim();
  return /^[A-Za-z0-9-]{4,40}$/.test(value) ? value : null;
}

export function normalizeCarrier(raw: unknown): string | null {
  const value = String(raw ?? '').replace(/\s+/g, ' ').trim();
  return value.length >= 2 && value.length <= 60 ? value : null;
}

export type RecordTrackingResult =
  | 'sent'
  | 'saved_without_contact'
  | 'already_recorded'
  | 'already_tracked'
  | 'cancelled'
  | 'not_found'
  | 'store_unavailable'
  | 'invalid';

interface MirrorRow {
  id: string;
  shop_domain: string | null;
  shopify_order_id: string | null;
  status: string;
  contact_id: string | null;
  tracking_number: string | null;
}

function hasActiveTracking(order: Record<string, unknown>): boolean {
  const fulfillments = Array.isArray(order.fulfillments)
    ? (order.fulfillments as Record<string, unknown>[])
    : [];
  return fulfillments.some(
    (f) =>
      !['cancelled', 'failure', 'error'].includes(String(f.status)) &&
      (Boolean(f.tracking_number) ||
        (Array.isArray(f.tracking_numbers) && f.tracking_numbers.length > 0)),
  );
}

function isCancelled(order: Record<string, unknown>): boolean {
  return (
    Boolean(order.cancelled_at) ||
    ['refunded', 'voided'].includes(String(order.financial_status ?? ''))
  );
}

/**
 * Guarda la guía que el comercio cargó a mano y avisa al cliente con las
 * mismas automatizaciones de despacho que dispara Shopify.
 *
 * Antes de escribir nada relee el pedido en la tienda: si ya se canceló no se
 * avisa un despacho, y si mientras tanto la app sí sincronizó la guía, el
 * webhook ya se encargó y repetirlo duplicaría el mensaje.
 */
export async function recordManualTracking(
  db: SupabaseClient,
  args: { workspaceId: string; orderId: string; trackingNumber: unknown; carrier: unknown },
  fetcher: typeof fetch = fetch,
): Promise<RecordTrackingResult> {
  const trackingNumber = normalizeTrackingNumber(args.trackingNumber);
  const carrier = normalizeCarrier(args.carrier);
  if (!trackingNumber || !carrier) return 'invalid';

  const { data: row, error } = await db
    .from('orders')
    .select('id, shop_domain, shopify_order_id, status, contact_id, tracking_number')
    .eq('id', args.orderId)
    .eq('workspace_id', args.workspaceId)
    .eq('platform', 'shopify')
    .maybeSingle();
  if (error) throw new Error(`orders: ${error.message}`);
  const mirror = row as MirrorRow | null;
  if (!mirror?.shop_domain || !mirror.shopify_order_id) return 'not_found';
  if (mirror.status === 'cancelled') return 'cancelled';
  if (mirror.tracking_number === trackingNumber) return 'already_recorded';

  const admin = await resolveShopifyAdmin(db, args.workspaceId);
  if (!admin || admin.shopDomain !== mirror.shop_domain) return 'store_unavailable';
  const response = await fetcher(
    `https://${admin.shopDomain}/admin/api/${admin.apiVersion}/orders/${mirror.shopify_order_id}.json`,
    {
      headers: { 'X-Shopify-Access-Token': admin.accessToken },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) return 'store_unavailable';
  const { order } = (await response.json()) as { order?: Record<string, unknown> };
  if (!order || String(order.id) !== mirror.shopify_order_id) return 'store_unavailable';
  if (isCancelled(order)) return 'cancelled';
  if (hasActiveTracking(order)) return 'already_tracked';

  const trackingUrl =
    resolveCarrierTrackingUrl(carrier, trackingNumber) ||
    String(order.order_status_url ?? '') ||
    null;
  const { error: updateError } = await db
    .from('orders')
    .update({
      tracking_number: trackingNumber,
      tracking_company: displayCarrierName(carrier),
      tracking_url: trackingUrl,
      tracking_source: 'manual',
      tracking_recorded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', mirror.id)
    .eq('workspace_id', args.workspaceId);
  if (updateError) throw new Error(`orders update: ${updateError.message}`);

  void emitWebhook(args.workspaceId, 'tracking.updated', {
    shop_domain: mirror.shop_domain,
    order_id: mirror.shopify_order_id,
    order_name: String(order.name ?? ''),
    tracking_number: trackingNumber,
    tracking_company: displayCarrierName(carrier),
    tracking_url: trackingUrl ?? '',
    source: 'manual',
  }).catch((err) => console.error('[logistics] tracking webhook failed:', err));

  let contactId = mirror.contact_id;
  if (!contactId) {
    const phone = extractShopifyPhone(order);
    contactId = phone
      ? await upsertWhatsappContact(db, {
          workspaceId: args.workspaceId,
          phone,
          name: extractShopifyName(order),
          email: (order.email as string) || undefined,
          legacyExternalId: extractShopifyLegacyPhone(order),
        })
      : null;
  }
  if (!contactId) return 'saved_without_contact';

  // El pedido con la guía adentro, como lo mandaría Shopify si la app la
  // hubiera sincronizado: así las variables salen idénticas a las del webhook.
  const withTracking = {
    ...order,
    fulfillments: [
      ...((order.fulfillments as unknown[]) ?? []),
      {
        status: 'success',
        tracking_number: trackingNumber,
        tracking_company: carrier,
        tracking_url: trackingUrl,
      },
    ],
  };
  const vars = buildVarsForOrder('shopify_order_fulfilled', withTracking, extractShopifyName(order));
  const offer = await resolveOfferChosen(db, args.workspaceId, order);
  vars.purchase_shop_domain = mirror.shop_domain;
  vars.offer_chosen = offer.label;
  vars.offer_units = offer.units > 0 ? String(offer.units) : '';

  await runAutomationsForTrigger({
    workspaceId: args.workspaceId,
    triggerType: 'shopify_order_fulfilled',
    contactId,
    context: { vars },
  });
  return 'sent';
}

/** El comercio marca que este pedido no se despacha: deja de contar como pendiente. */
export async function dismissMissingTracking(
  db: SupabaseClient,
  workspaceId: string,
  orderId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from('orders')
    .update({ tracking_dismissed_at: new Date().toISOString() })
    .eq('id', orderId)
    .eq('workspace_id', workspaceId)
    .select('id');
  if (error) throw new Error(`orders dismiss: ${error.message}`);
  return (data ?? []).length > 0;
}
