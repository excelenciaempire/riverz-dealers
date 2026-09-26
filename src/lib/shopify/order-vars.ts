import { confirmationSummary } from '@/lib/shopify/confirmation-summary';
import {
  displayCarrierName,
  resolveCarrierTrackingUrl,
} from '@/lib/shopify/carrier-tracking';
import type { AutomationTriggerType } from '@/types';

/**
 * Las variables que un pedido de Shopify le pasa a las automatizaciones.
 *
 * Vive fuera del webhook porque el pedido también llega por otras puertas: la
 * guía que el comercio carga a mano cuando la app logística no la sincronizó
 * tiene que armar exactamente las mismas variables que el webhook, o la misma
 * plantilla sale distinta según por dónde entró el dato.
 */
export function buildVarsForOrder(
  trigger: AutomationTriggerType,
  order: Record<string, unknown>,
  name: string | undefined
): Record<string, string> {
  const customer = order.customer as Record<string, unknown> | undefined;
  const ordersCount = Number(customer?.orders_count ?? 0);
  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
  const firstItem = lineItems[0] as Record<string, unknown> | undefined;

  const shipping = order.shipping_address as
    | Record<string, unknown>
    | undefined;
  // El método de envío que eligió en la caja ("Punto Andreani HOP…", "Envío a
  // domicilio…"). Poner la casa en la dirección y elegir un punto de retiro es
  // el error más común después de comprar; confirmarlo en el primer mensaje lo
  // ataja antes del despacho. Nunca vacío: una variable vacía hace que Meta
  // rechace la plantilla entera.
  const shippingLines = Array.isArray(order.shipping_lines)
    ? (order.shipping_lines as Record<string, unknown>[])
    : [];
  const shippingMethod =
    shippingLines
      .map((line) => String(line.title ?? '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(', ') || '—';

  const base: Record<string, string> = {
    ...confirmationSummary(order),
    customer_name: name ?? '',
    // Numeric Shopify order id — needed to write the call outcome back as a tag
    // (COD confirmation) and to edit the order on an in-call upsell.
    order_id: String(order.id ?? ''),
    order_name: String(order.name ?? ''),
    order_number: String(order.order_number ?? ''),
    total_price: String(order.total_price ?? ''),
    subtotal_price: String(order.subtotal_price ?? ''),
    total_discounts: String(order.total_discounts ?? ''),
    currency: String(order.currency ?? order.presentment_currency ?? ''),
    item_count: String(lineItems.length),
    purchase_order_lines: JSON.stringify(lineItems.map((item: Record<string, unknown>) => ({
      id: item.id, product_id: item.product_id, variant_id: item.variant_id,
      title: item.title, name: item.name, variant_title: item.variant_title,
      quantity: item.quantity, properties: item.properties,
    }))),
    first_item: String(firstItem?.title ?? ''),
    retention_order_lines: JSON.stringify(lineItems.map((item: Record<string, unknown>) => ({ title: item.title, quantity: item.quantity }))),
    is_repeat_customer: ordersCount > 1 ? 'true' : 'false',
    order_status_url: String(order.order_status_url ?? ''),
    payment_gateway: Array.isArray(order.payment_gateway_names)
      ? order.payment_gateway_names.map(String).join(', ')
      : String(order.payment_gateway_names ?? ''),
    financial_status: String(order.financial_status ?? ''),
    fulfillment_status: String(order.fulfillment_status ?? ''),
    // Dirección de envío (la manda Shopify en shipping_address).
    shipping_address: [shipping?.address1, shipping?.address2]
      .filter((p) => p && String(p).trim())
      .join(', '),
    shipping_city: String(shipping?.city ?? ''),
    shipping_province: String(shipping?.province ?? ''),
    shipping_zip: String(shipping?.zip ?? ''),
    shipping_country: String(shipping?.country ?? ''),
    shipping_method: shippingMethod,
  };

  if (
    trigger === 'shopify_order_fulfilled' ||
    trigger === 'shopify_order_delivered'
  ) {
    const fulfillments = Array.isArray(order.fulfillments)
      ? (order.fulfillments as Record<string, unknown>[])
      : [];
    const latest = fulfillments[fulfillments.length - 1];
    const trackingUrl = String(latest?.tracking_url ?? '');
    const trackingCompany = String(latest?.tracking_company ?? '');
    const trackingNumber = String(latest?.tracking_number ?? '');
    base.tracking_number = trackingNumber;
    base.tracking_company = displayCarrierName(trackingCompany);
    // Shopify only auto-fills tracking_url for carriers in its built-in
    // list. Regional carriers often arrive without one and the customer gets
    // a naked number. Fall back to our resolver so
    // existing {{tracking_url}} templates keep working unchanged.
    //
    // Last resort: the order status page. Leaving this empty is not a
    // cosmetic degradation — a WhatsApp template whose variable resolves
    // to '' is rejected whole by Meta with "(#131008) Required parameter
    // is missing", so the customer gets NO message at all instead of one
    // without a link. Reproduced twice on 2026-08-27 with a fulfillment
    // saved from the Shopify admin, where the carrier combobox stores
    // `tracking_company: null` (or the literal "Otra") unless the
    // merchant picks a carrier Shopify already knows — nothing our
    // resolver can match. `order_status_url` is present on every order
    // and shows the carrier and number, so it always beats silence.
    base.tracking_url =
      trackingUrl ||
      resolveCarrierTrackingUrl(trackingCompany, trackingNumber) ||
      String(order.order_status_url ?? '');
  }

  return base;
}
