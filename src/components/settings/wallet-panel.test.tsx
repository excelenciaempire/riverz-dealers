import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { translate } from '@/lib/i18n/translate';
import { formatCurrency, formatDate, formatDateTime, formatNumber } from '@/lib/i18n/format';
import { WalletPanel } from './wallet-panel';

const state = vi.hoisted(() => ({ locale: 'es' as 'es' | 'en', index: 0, wallet: {} as Record<string, unknown> }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useState: (initial: unknown) => actual.useState(state.index++ === 3 ? state.wallet : initial) };
});
vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({ locale: state.locale }),
  useT: () => (key: string, params?: Record<string, string | number>) => translate(state.locale, key, params),
}));
vi.mock('@/hooks/use-timezone', () => ({ useTimezone: () => 'America/Bogota' }));
vi.mock('@/hooks/use-saldo', () => ({ avisarSaldoCambio: vi.fn() }));
vi.mock('@/lib/api/fetch-with-csrf', () => ({ useFetchWithCsrf: () => vi.fn() }));
vi.mock('@/hooks/use-format', () => ({ useFormat: () => ({
  date: (date: string, options?: Intl.DateTimeFormatOptions) => formatDate(date, state.locale, options),
  dateTime: (date: string, options?: Intl.DateTimeFormatOptions) => formatDateTime(date, state.locale, options),
  currency: (value: number, currency: string, options?: Intl.NumberFormatOptions) => formatCurrency(value, state.locale, currency, options),
  number: (value: number) => formatNumber(value, state.locale),
}) }));

it.each(['es', 'en'] as const)('renders a compact, reconciled wallet with named sources and dropdowns in %s', locale => {
  state.locale = locale; state.index = 0;
  const count = { contacts: 1, aiContacts: 1, sent: 1, aiMessages: 1, automated: 0, human: 0, other: 0, comments: 1 };
  state.wallet = {
    moneda: 'usd', saldoCentavos: 2945, exenta: false, aCosto: true, puedeRecargar: false,
    tarifas: [], costos: [{ concepto: 'llamada_ia', nombreEs: 'IA de llamadas', nombreEn: 'Call AI', centavos: 0, unidad: 'request', medido: true, cobro: 'por_uso' }],
    resumen: { gastadoCentavos: 1000, cargadoCentavos: 2500, ajustesCentavos: -30, porDia: [], porConcepto: [{ concepto: 'llamada_ia', centavos: 1000, movimientos: 3, cantidad: 3, porUnidadCentavos: 333.33 }] },
    auto: { recargaCentavos: null, umbralCentavos: null },
    serviceActivity: { ...count, byChannel: [{ ...count, channel: 'voice' }, { ...count, channel: 'tiktok_comment' }] },
    billedActivity: { contacts: 0, charges: 3, chargedCentavos: 1000, byChannel: [] },
  };
  const html = renderToStaticMarkup(<WalletPanel />);
  expect(html).toContain(locale === 'es' ? 'Llamadas y telefonía' : 'Calls and telephony');
  expect(html).toContain(locale === 'es' ? 'Comentarios de TikTok' : 'TikTok comments');
  expect(html).toContain(locale === 'es' ? 'IA de llamadas' : 'Call AI');
  expect(html).toContain(locale === 'es' ? '29,45' : '29.45');
  expect(html).toContain('value="custom"');
  expect(html.match(/<select/g)).toHaveLength(3);
  expect(html).not.toContain('llamada_ia</td>');
  expect(html).not.toContain('Sin canal identificado');
  expect(html).not.toContain('settings.');
  expect(html).not.toMatch(/<details[^>]*\sopen/);
});
