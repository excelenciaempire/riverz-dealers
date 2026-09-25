/** A confirmation button completes the data check; it must not restart sales.
 * Scoped to the merchant's existing order handoff, never cart recovery.
 */
import { confirmationSummary } from '@/lib/shopify/confirmation-summary';

type PriorMessage = {
  sender_type: string;
  origin: string | null;
  template_name: string | null;
  status: string;
  content_text: string | null;
};

/** Only the immediate reply to an untouched purchase summary is unambiguous.
 * A prior conversation, correction, or changed Shopify order needs the agent
 * to read the full history instead of treating CONFIRMAR as final.
 */
export function directPurchaseButtonIsSafe(input: {
  context: Record<string, unknown> | null;
  priorMessages: PriorMessage[];
  order: Record<string, unknown> | null;
}): boolean {
  const { context, priorMessages, order } = input;
  if (!context || !order || priorMessages.length === 0 || priorMessages.length > 25) return false;
  const [summary, ...photos] = priorMessages;
  if (summary.sender_type !== 'bot' || summary.origin !== 'automation' ||
    !/^deuna_resumen_compra_(?:1|2|general)_v1$/.test(summary.template_name ?? '') ||
    !['sent', 'delivered', 'read'].includes(summary.status) ||
    photos.some(message => message.sender_type !== 'bot' || message.origin !== 'automation' ||
      message.template_name !== 'deuna_foto_referencia_v1' ||
      !['sent', 'delivered', 'read'].includes(message.status))) return false;
  const shown = summary.content_text ?? '';
  if (String(context.order_items ?? '').split('\n').some(line => line && !shown.includes(line)) ||
    !shown.includes(String(context.delivery_address ?? ''))) return false;
  if (String(context.order_id ?? '') !== String(order.shopify_order_id ?? '') ||
    order.status !== 'created' || order.fulfillment_status ||
    order.financial_status !== 'pending') return false;
  const current = confirmationSummary({
    line_items: order.line_items,
    shipping_address: order.shipping_address,
    phone: order.customer_phone,
  });
  return current.order_items !== '—' &&
    current.order_items === context.order_items &&
    current.delivery_address !== '—' &&
    current.delivery_address === context.delivery_address &&
    current.delivery_phone === context.delivery_phone;
}

export function purchaseConfirmationReply(input: {
  workspaceId: string;
  language: string | null;
  text: string;
  context: Record<string, unknown> | null;
}): string | null {
  const c = input.context;
  if (input.workspaceId !== '36f81b96-41b9-4d29-b72e-11be3d3070a3' || !c ||
    c.retention_handoff || c.checkout_url || c.benefit_percent ||
    !String(c.order_id ?? '').trim() || !String(c.order_items ?? '').trim() ||
    c.order_items === '—' || !String(c.delivery_address ?? '').trim()) return null;
  const action = input.text.trim().toUpperCase();
  const en = input.language?.toLowerCase().startsWith('en');
  if (action === 'CONFIRMAR' || action === 'CONFIRM') {
    return en
      ? 'Thank you for confirming your order and for choosing us! 😊 We’ll send your tracking number here as soon as your order ships. If you need anything, we’re here to help.'
      : '¡Gracias por confirmar tu pedido y por confiar en nosotros! 😊 Te enviaremos el número de guía por aquí apenas sea despachado. Si necesitas algo, estamos para ayudarte.';
  }
  if (action === 'CORREGIR' || action === 'CORRECT') {
    return en ? 'Of course, I’m happy to help 😊 Which order detail would you like to change?' : 'Claro, te ayudo 😊 ¿Qué dato de tu pedido necesitas corregir?';
  }
  return null;
}
