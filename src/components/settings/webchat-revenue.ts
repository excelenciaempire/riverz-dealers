import type { Locale } from '@/lib/i18n/config';
import { formatExactCurrency } from '@/lib/i18n/format';
import { translate } from '@/lib/i18n/translate';

export interface WebchatRevenue {
  revenue: number | null;
  currency: string | null;
  revenue_by_currency: Array<{ currency: string; amount: string; orders: number }>;
  unavailable_amounts: number;
}

export function webchatRevenueDisplay(stats: WebchatRevenue, locale: Locale) {
  const values = stats.revenue_by_currency.map(group => formatExactCurrency(group.amount, group.currency, locale));
  const extra = values.slice(1);
  if (stats.unavailable_amounts) extra.push(translate(locale, 'webchat.amountsUnavailable', { n: stats.unavailable_amounts }));
  return { value: values[0] ?? '—', extra };
}
