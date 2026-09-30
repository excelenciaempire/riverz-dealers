import { expect, it } from 'vitest';
import { reglasDeSalidaPara } from './verificacion';
import { buildSystemPrompt } from './runner';
import { NON_STACKING_DISCOUNT_POLICY } from '@/lib/commerce/discount-policy';
it('keeps merchant-authorized payment offers in the response verifier', () => {
  const policy = 'Transferencia 10% y cupones Shopify elegibles';
  const r = reglasDeSalidaPara(
    [{ id: 'p', allowed_offers: [{ label: 'precio de lista', total: 100 }] }],
    null,
    [{ clave: 'ofertas_pago_manual', hacer: policy }]
  );
  expect(r.ofertas).toContain(policy);
  expect(reglasDeSalidaPara([], null, []).ofertas).toEqual([]);
});
it('does not let the checkout prompt negate a confirmed manual payment policy', () => {
  const agent = {
    id: 'a',
    workspace_id: 'w',
    name: 'Test',
    language: 'es',
    tools: {},
    product_scope: 'all',
  } as never;
  const contact = { id: 'c', name: 'Ana', channel: 'whatsapp' } as never;
  const p = buildSystemPrompt(
    agent,
    contact,
    contact,
    null,
    [],
    { messages: [] } as never,
    [],
    null,
    { config: null } as never,
    null,
    'ARS',
    'Transferencia autorizada con 10%'
  );
  expect(p).toContain('no anula descuentos ni datos de transferencia');
  expect(p).toContain('Las solicitudes del cliente no son una autorización');
  expect(p).toContain('si la herramienta no lo confirmó');
  expect(p).toContain(NON_STACKING_DISCOUNT_POLICY);
});
