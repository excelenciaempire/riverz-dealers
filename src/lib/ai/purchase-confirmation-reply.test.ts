import { describe, expect, it } from 'vitest';
import { purchaseConfirmationReply } from './purchase-confirmation-reply';
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
