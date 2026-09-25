import { describe, expect, it } from 'vitest';
import { directPurchaseButtonIsSafe, purchaseConfirmationReply } from './purchase-confirmation-reply';
const args = { workspaceId: '36f81b96-41b9-4d29-b72e-11be3d3070a3', language: 'es', text: 'CONFIRMAR',
  context: { order_id: '1007', order_items: '1 × Blanco / 36; 1 × Negro con blanco / 37', delivery_address: 'Cúcuta' } };
describe('existing purchase confirmation buttons', () => {
  it('acknowledges the actual order without repeating it or asking for confirmation again', () => {
    const reply = purchaseConfirmationReply(args)!;
    expect(reply).toContain('Gracias por confirmar tu pedido');
    expect(reply).toContain('😊');
    expect(reply).toContain('Te enviaremos el número de guía por aquí apenas sea despachado');
    expect(reply).not.toMatch(/¿|\?|Cúcuta|36|37|ya fue despachado|nuevo pedido|\n\n/);
  });
  it('supports English and asks only for the correction when selected', () => {
    expect(purchaseConfirmationReply({ ...args, language: 'en', text: ' confirm ' })).toContain('Thank you for confirming');
    expect(purchaseConfirmationReply({ ...args, language: 'en', text: ' confirm ' })).toContain('tracking number here as soon as your order ships');
    expect(purchaseConfirmationReply({ ...args, text: 'CORREGIR' })).toBe('Claro, te ayudo 😊 ¿Qué dato de tu pedido necesitas corregir?');
  });
  it('does not swallow questions, negations, other merchants or recovery flows', () => {
    for (const text of ['no confirmar', 'CONFIRMAR, pero cambia la talla', 'sí', '¿ya despacharon?', 'quiero cancelar']) {
      expect(purchaseConfirmationReply({ ...args, text })).toBeNull();
    }
    expect(purchaseConfirmationReply({ ...args, workspaceId: 'other' })).toBeNull();
    expect(purchaseConfirmationReply({ ...args, context: null })).toBeNull();
    for (const extra of [{ order_id: '' }, { order_items: '—' }, { retention_handoff: {} }, { checkout_url: 'https://shop/cart' }, { benefit_percent: 10 }]) {
      expect(purchaseConfirmationReply({ ...args, context: { ...args.context, ...extra } })).toBeNull();
    }
  });
});

describe('direct purchase button eligibility', () => {
  const order = {
    shopify_order_id: '12406809657708', status: 'created', financial_status: 'pending',
    fulfillment_status: null, customer_phone: '3217357571',
    line_items: [
      { title: 'Puma Suede XL para Dama y Caballero', variant_title: 'Negro / 42', quantity: 1 },
      { title: 'Puma Suede XL para Dama y Caballero', variant_title: 'Gris / 42', quantity: 1 },
    ],
    shipping_address: {
      address1: 'Carrera 52a # 60a-51', address2: 'Horizontes Senderos de San Sebastian apto 1001 t1',
      city: 'Rionegro', province: 'Antioquia',
    },
  };
  const context = {
    order_id: order.shopify_order_id,
    order_items: '1 × Puma Suede XL para Dama y Caballero (Negro / 42)\n1 × Puma Suede XL para Dama y Caballero (Gris / 42)',
    delivery_address: 'Carrera 52a # 60a-51, Horizontes Senderos de San Sebastian apto 1001 t1, Rionegro, Antioquia',
    delivery_phone: '3217357571',
  };
  const summary = { sender_type: 'bot', origin: 'automation', template_name: 'deuna_resumen_compra_2_v1', status: 'delivered',
    content_text: `${context.order_items}\n${context.delivery_address}` };
  const photo = { sender_type: 'bot', origin: 'automation', template_name: 'deuna_foto_referencia_v1', status: 'delivered', content_text: 'Referencia de tu pedido' };
  const input = { context, order, priorMessages: [summary, photo, photo] };

  it('allows the direct button response for Carlos’s unchanged two-pair order', () => {
    expect(directPurchaseButtonIsSafe(input)).toBe(true);
  });

  it('falls back to the full conversation when a correction or another reply intervened', () => {
    expect(directPurchaseButtonIsSafe({ ...input, priorMessages: [
      { sender_type: 'customer', origin: null, template_name: null, status: 'delivered', content_text: 'Cambio de talla' }, ...input.priorMessages,
    ] })).toBe(false);
    expect(directPurchaseButtonIsSafe({ ...input, priorMessages: [
      { sender_type: 'bot', origin: 'ai_agent', template_name: null, status: 'delivered', content_text: 'Otro pedido' }, ...input.priorMessages,
    ] })).toBe(false);
  });

  it('rejects a changed, cancelled, or shipped order', () => {
    expect(directPurchaseButtonIsSafe({ ...input, order: { ...order, line_items: [order.line_items[0]] } })).toBe(false);
    expect(directPurchaseButtonIsSafe({ ...input, order: { ...order, status: 'cancelled' } })).toBe(false);
    expect(directPurchaseButtonIsSafe({ ...input, order: { ...order, fulfillment_status: 'fulfilled' } })).toBe(false);
    expect(directPurchaseButtonIsSafe({ ...input, order: { ...order, shopify_order_id: 'another' } })).toBe(false);
    expect(directPurchaseButtonIsSafe({ ...input, order: { ...order, shipping_address: { ...order.shipping_address, city: 'Medellín' } } })).toBe(false);
  });
});
