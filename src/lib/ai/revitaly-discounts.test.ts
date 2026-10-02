import { describe, expect, it } from 'vitest';
import type { Regla } from './guidance';
import { revitalyDiscountReply, REVITALY_DISCOUNT_KEY, REVITALY_DISCOUNT_POLICY, REVITALY_DISCOUNT_WORKSPACE } from './revitaly-discounts';

const rule: Regla = { id: 'discount-rule', workspace_id: REVITALY_DISCOUNT_WORKSPACE,
  agent_id: null, titulo: 'Descuentos', cuando: null, hacer: REVITALY_DISCOUNT_POLICY,
  activa: true, orden: 1, origen: 'comercio', clave: REVITALY_DISCOUNT_KEY };
const input = { workspaceId: REVITALY_DISCOUNT_WORKSPACE, agentId: 'natalia',
  channel: 'whatsapp' as const, language: 'es', rules: [rule], inbound: '¿Se suma el 5% con el 10% por transferencia?' };

describe('Revitaly payment discounts', () => {
  it.each(['¿Se suma el 5% con el 10% por transferencia?', '¿5% + 10% al alias es 15%?',
    '¿REVITALY5 se combina con transferencia?', '¿Por transferencia se suman para dar 14,5%?'])
  ('explains the two exclusive alternatives: %s', inbound => {
    const reply = revitalyDiscountReply({ ...input, inbound });
    expect(reply).toContain('no se combinan');
    expect(reply).toContain('alias de Mercado Pago');
    expect(reply).toContain('primera compra en la página web');
    expect(reply).toContain('no se suman');
  });
  it('supports English', () => {
    expect(revitalyDiscountReply({ ...input, language: 'en', inbound: 'Can I combine 5% online plus 10% bank transfer?' }))
      .toContain('only for your first purchase on the website');
  });
  it('requires the configured, active and unambiguous policy in a private merchant channel', () => {
    for (const rules of [[], [{ ...rule, activa: false }], [{ ...rule, workspace_id: 'other' }],
      [{ ...rule, agent_id: 'other' }], [{ ...rule, hacer: 'New policy' }], [rule, rule]])
      expect(revitalyDiscountReply({ ...input, rules })).toBeNull();
    for (const channel of ['mercadolibre', 'gmail', 'ig_comment', 'fb_comment'] as const)
      expect(revitalyDiscountReply({ ...input, channel })).toBeNull();
    expect(revitalyDiscountReply({ ...input, workspaceId: 'other' })).toBeNull();
  });
  it.each(['Quiero transferencia', '¿Puedo pagar con el cupón en la web?',
    'Ya pagué con 5% más 10% por transferencia, ¿qué pasa?',
    '¿Cuánto queda con 5% más 10% por transferencia?',
    '¿5% + 10% por transferencia y cuándo llega el pedido?',
    'Quiero reembolso del 5% más 10% por transferencia'])
  ('preserves contextual order, amount and payment handling: %s', inbound => {
    expect(revitalyDiscountReply({ ...input, inbound })).toBeNull();
  });
});
