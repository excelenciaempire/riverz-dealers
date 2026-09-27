import { describe, expect, it } from 'vitest';
import { billingAmount, compatibleBillingPlan } from './admin-agreement';
import type { Plan } from './plan';

const plan: Plan = { id: 'p', slug: 'contactos-500', nombre: '500', activo: true,
  precioCentavos: 19900, moneda: 'usd', incluidas: 500, excedenteCentavos: 0,
  stripePriceId: null, stripePriceExcedenteId: null, orden: 1 };

describe('admin billing agreements', () => {
  it.each([
    ['oficial', 'contactos-500', true], ['oficial', 'byok', false], ['oficial', 'saldo-ilimitado', false],
    ['saldo', 'contactos-500', true], ['saldo', 'byok', false], ['saldo', 'saldo-ilimitado', true],
    ['byok', 'contactos-500', false], ['byok', 'byok', true], ['byok', 'saldo-ilimitado', false],
  ] as const)('%s with %s is %s', (model, slug, expected) => {
    expect(compatibleBillingPlan(model, { ...plan, slug })).toBe(expected);
  });
  it('rejects missing, inactive and contact plans without capacity', () => {
    expect(compatibleBillingPlan('saldo', null)).toBe(false);
    expect(compatibleBillingPlan('saldo', { ...plan, activo: false })).toBe(false);
    expect(compatibleBillingPlan('oficial', { ...plan, incluidas: 0 })).toBe(false);
  });
  it.each([['399', 39900], ['12.34', 1234], ['12,34', 1234], ['0', 0], [' 1.01 ', 101]] as const)
    ('parses %s without losing cents', (input, expected) => expect(billingAmount(input)).toBe(expected));
  it.each(['', '-1', 'NaN', 'Infinity', '1e3', '1.001', '1,000.00', '9999999999999999'])
    ('rejects invalid amount %s', input => expect(billingAmount(input)).toBeNull());
});
