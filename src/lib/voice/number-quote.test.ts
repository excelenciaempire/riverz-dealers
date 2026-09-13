import { afterEach, describe, expect, it, vi } from 'vitest';
import { cents, nextNumberRenewal, quoteNumber, verifyNumberQuote } from './number-quote';
afterEach(() => vi.unstubAllEnvs());
describe('merchant number quotes', () => {
  it('binds the full price to one merchant, number and expiry', () => {
    vi.stubEnv('ENCRYPTION_KEY', 'test-key');
    const token = quoteNumber({ phone_number: '+576019191270', currency: 'USD', upfront_cost: '13.50', monthly_cost: '13.50', features: ['voice'] }, 'one', 'CO', 'local', 1000);
    expect(verifyNumberQuote(token, 'one', '+576019191270', 2000)).toMatchObject({ upfront: 1350, monthly: 1350 });
    expect(() => verifyNumberQuote(token, 'two', '+576019191270', 2000)).toThrow();
    expect(() => verifyNumberQuote(token, 'one', '+576019191271', 2000)).toThrow();
    expect(() => verifyNumberQuote(token, 'one', '+576019191270', 601000)).toThrow();
    expect(() => verifyNumberQuote(token.replace(token[10], 'x'), 'one', '+576019191270', 2000)).toThrow();
  });
  it('never treats missing or malformed prices as free', () => {
    for (const value of [null, undefined, '', '-1', 'NaN', '1.001', 'USD 13.50']) expect(() => cents(value)).toThrow();
    expect(cents('0.00')).toBe(0);
    expect(cents('13.5000')).toBe(1350);
  });
  it('renews on the calendar month including year boundaries', () => {
    expect(nextNumberRenewal(new Date('2026-09-13T03:00:00Z'))).toBe('2026-10-01T00:00:00.000Z');
    expect(nextNumberRenewal(new Date('2026-12-31T23:59:59Z'))).toBe('2027-01-01T00:00:00.000Z');
  });
});
