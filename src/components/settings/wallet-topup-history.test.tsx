import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { translate } from '@/lib/i18n/translate';
import { formatCurrency, formatDateTime } from '@/lib/i18n/format';
import {
  WalletTopupHistory,
  WalletTopupHistoryTable,
} from './wallet-topup-history';

const state = vi.hoisted(() => ({ locale: 'es' as 'es' | 'en' }));
vi.mock('@/hooks/use-locale', () => ({
  useT: () => (key: string) => translate(state.locale, key),
}));
vi.mock('@/hooks/use-format', () => ({
  useFormat: () => ({
    dateTime: (date: string, options: Intl.DateTimeFormatOptions) =>
      formatDateTime(date, state.locale, options),
    currency: (value: number, currency: string) =>
      formatCurrency(value, state.locale, currency),
  }),
}));

it.each(['es', 'en'] as const)(
  'renders manual and automatic credits with exact timestamps in %s',
  (locale) => {
    state.locale = locale;
    const html = renderToStaticMarkup(
      <WalletTopupHistoryTable
        currency="usd"
        timezone="America/Bogota"
        rows={[
          {
            id: 'one',
            creadoEn: '2026-09-28T01:02:05Z',
            centavos: 2500,
            saldoDespuesCentavos: 2600,
            origen: 'manual',
          },
          {
            id: 'two',
            creadoEn: '2026-09-28T01:03:09Z',
            centavos: 1031,
            saldoDespuesCentavos: 3600,
            origen: 'automatica',
          },
          {
            id: 'old',
            creadoEn: '2026-07-28T01:03:09Z',
            centavos: 1000,
            saldoDespuesCentavos: 1000,
            origen: 'desconocida',
          },
        ]}
      />
    );
    expect(html).toContain('dateTime="2026-09-28T01:02:05Z"');
    expect(html).toContain('02:05');
    expect(html).toContain('03:09');
    expect(html).toContain('GMT-5');
    expect(html).toContain(locale === 'es' ? 'Automática' : 'Automatic');
    expect(html).toContain(locale === 'es' ? 'Sin especificar' : 'Unspecified');
    expect(html).toContain(locale === 'es' ? 'sept' : 'Sep');
    expect(html).toContain(locale === 'es' ? '10,31' : '10.31');
    expect(html).not.toContain('settings.');
  }
);
it('shows a loading state instead of a false empty history before reading data', () => {
  const html = renderToStaticMarkup(
    <WalletTopupHistory currency="usd" timezone="UTC" revision={0} />
  );
  expect(html).toContain('aria-busy="true"');
  expect(html).not.toContain('No top-ups yet');
});
