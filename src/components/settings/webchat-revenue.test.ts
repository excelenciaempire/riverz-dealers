import { describe, expect, it } from 'vitest';
import { webchatRevenueDisplay } from './webchat-revenue';
import { formatExactCurrency } from '@/lib/i18n/format';
import { translate } from '@/lib/i18n/translate';
describe('exact paid-order totals in the existing webchat card', () => {
  it.each(['es', 'en'] as const)('displays every currency and unavailable amounts without a rounded float in %s', locale => {
    const result = webchatRevenueDisplay({ revenue: null, currency: null, unavailable_amounts: 1,
      revenue_by_currency: [{ currency: 'COP', amount: '9007199254740993.123456', orders: 2 }, { currency: 'USD', amount: '0.000001', orders: 1 }] }, locale);
    expect(result.value).toContain(locale === 'es' ? '9.007.199.254.740.993,123456' : '9,007,199,254,740,993.123456');
    expect(result.value).toContain('COP');expect(result.extra[0]).toContain(locale === 'es' ? '0,000001' : '0.000001');
    expect(result.extra[1]).toBe(translate(locale, 'webchat.amountsUnavailable', { n: 1 }));
  });
  it('displays absent values as unavailable and an observed zero as zero', () => {
    expect(webchatRevenueDisplay({ revenue: null, currency: null, unavailable_amounts: 0, revenue_by_currency: [] }, 'en').value).toBe('—');
    expect(webchatRevenueDisplay({ revenue: 0, currency: 'USD', unavailable_amounts: 0, revenue_by_currency: [{ currency: 'USD', amount: '0', orders: 1 }] }, 'en').value).toBe('USD\u00a00');
  });
  it('does not accept an invalid decimal as a valid money label', () => { expect(formatExactCurrency('1e6', 'USD', 'es')).toBe('—'); });
});
