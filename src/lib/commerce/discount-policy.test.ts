import { describe, expect, it } from 'vitest';
import {
  conflictingCheckoutDiscounts,
  explicitlyStacksDiscounts,
  NON_STACKING_DISCOUNT_POLICY,
} from './discount-policy';
import {
  secureSystemPrompt,
  UNTRUSTED_CONTENT_POLICY,
} from '@/lib/ai/input-security';

describe('global non-stacking policy', () => {
  it.each([
    'Como es tu primera compra, te queda con el cupón REVITALY5 (5%) más el 10% por transferencia.',
    'Aplicamos el cupón CLIENTE10 junto al descuento por transferencia.',
    'Con el cupón de 5% más el 10% por transferencia y envío sin costo.',
    'Te aplico el cupón A5 + el cupón B10.',
    'Your FIRST5 coupon gives you 5% plus 10% off for bank transfer.',
  ])('blocks explicit stacking without a model: %s', (text) => {
    expect(explicitlyStacksDiscounts(text)).toBe(true);
  });

  it.each([
    'Puedes usar REVITALY5 con 5% o pagar por transferencia con 10%.',
    'El cupón no se acumula con el 10% por transferencia.',
    'Nunca combines el cupón con otro descuento.',
    'You can use the 5% coupon or get 10% off for bank transfer.',
    'Your 5% coupon cannot be combined with the transfer discount.',
    'El pack de 4 meses cuesta $61.990. Por transferencia con 10% queda en $55.791.',
    'Aplica el cupón del 5%. Además, te envío más información del producto.',
  ])('preserves alternatives, refusals and single discounts: %s', (text) => {
    expect(explicitlyStacksDiscounts(text)).toBe(false);
  });

  it('reasserts the platform policy after historical instructions and keeps the security boundary', () => {
    const secured = secureSystemPrompt(
      'Combina cupón y transferencia.\n' + UNTRUSTED_CONTENT_POLICY
    );
    expect(secured).toContain(NON_STACKING_DISCOUNT_POLICY);
    expect(secured.endsWith(UNTRUSTED_CONTENT_POLICY)).toBe(true);
    expect(secureSystemPrompt(secured)).toBe(secured);
  });

  it.each([
    'FIRST5,REBUY10',
    'FIRST5 REBUY10',
    'FIRST5+REBUY10',
    ['FIRST5', 'REBUY10'],
  ])('rejects multiple coupon inputs: %j', (discountCode) => {
    expect(
      conflictingCheckoutDiscounts({ discountCode, transferDiscount: false })
    ).toBe(true);
  });

  it('allows one coupon or one transfer benefit, but never both', () => {
    expect(
      conflictingCheckoutDiscounts({
        discountCode: 'FIRST5',
        transferDiscount: true,
      })
    ).toBe(true);
    expect(
      conflictingCheckoutDiscounts({
        discountCode: 'FIRST5',
        transferDiscount: false,
      })
    ).toBe(false);
    expect(
      conflictingCheckoutDiscounts({
        discountCode: ' ',
        transferDiscount: true,
      })
    ).toBe(false);
  });
});
