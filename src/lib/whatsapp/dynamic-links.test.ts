import { describe, expect, it } from 'vitest';
import {
  BUTTON_URL_VARIABLES,
  isButtonUrlVariable,
  resolveButtonUrlFromVars,
} from './dynamic-links';

describe('payment instructions button', () => {
  it('is selectable and accepted by the sender', () => {
    expect(BUTTON_URL_VARIABLES).toContain('payment');
    expect(isButtonUrlVariable('payment')).toBe(true);
  });
  it('uses the original payment instructions, never a checkout replacement', () => {
    expect(
      resolveButtonUrlFromVars('payment', {
        payment_url: ' https://www.mercadopago.com/voucher/123 ',
        checkout_url: 'https://shop.example/new-charge',
      })
    ).toBe('https://www.mercadopago.com/voucher/123');
    expect(
      resolveButtonUrlFromVars('payment', {
        checkout_url: 'https://shop.example/new-charge',
      })
    ).toBeNull();
    expect(resolveButtonUrlFromVars('payment', null)).toBeNull();
  });
  it('preserves existing checkout buttons', () => {
    expect(
      resolveButtonUrlFromVars('abandoned_checkout', {
        checkout_url: 'https://shop.example/cart',
      })
    ).toBe('https://shop.example/cart');
  });
});
