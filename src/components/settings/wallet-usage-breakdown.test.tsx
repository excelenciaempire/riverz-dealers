import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { translate } from '@/lib/i18n/translate';
import { formatCurrency, formatDate } from '@/lib/i18n/format';
import { WalletUsageBreakdown } from './wallet-usage-breakdown';
import { WalletDisclosure } from './wallet-disclosure';

const state = vi.hoisted(() => ({ locale: 'es' as 'es' | 'en' }));
vi.mock('@/hooks/use-locale', () => ({ useT: () => (key: string, params?: Record<string, string | number>) => translate(state.locale, key, params) }));
vi.mock('@/hooks/use-format', () => ({ useFormat: () => ({
  date: (date: string, options: Intl.DateTimeFormatOptions) => formatDate(date, state.locale, options),
  currency: (value: number, currency: string) => formatCurrency(value, state.locale, currency),
  number: (value: number) => String(value),
}) }));
const concepts = [{ concepto: 'ia_respuesta', centavos: 1000, cantidad: 4, movimientos: 4, porUnidadCentavos: 250 }];
const activity = { contacts: 1, charges: 4, chargedCentavos: 1000, byChannel: [
  { channel: 'whatsapp', contacts: 1, charges: 2, chargedCentavos: 600 },
  { channel: 'unattributed', contacts: 0, charges: 2, chargedCentavos: 400 },
], unrecorded: { charges: 2, chargedCentavos: 400, firstAt: '2026-09-01T00:00:00Z', lastAt: '2026-09-27T00:00:00Z' } };

it.each(['es', 'en'] as const)('retains the full total and separates unsupported history from named channels in %s', locale => {
  state.locale = locale;
  const html = renderToStaticMarkup(<WalletUsageBreakdown concepts={concepts} activity={activity} currency="usd" timezone="America/Bogota" name={() => 'AI replies'} channelName={() => 'WhatsApp'} initialView="channel" />);
  expect(html).toContain('WhatsApp');
  expect(html).toContain(locale === 'es' ? 'Detalle incompleto del historial' : 'Incomplete historical detail');
  expect(html).toContain(locale === 'es' ? '4,00' : '4.00');
  expect(html).toContain(locale === 'es' ? '10,00' : '10.00');
  expect(html).toContain('2026');
  expect(html).not.toContain('unattributed');
  expect(html).not.toContain('Sin canal identificado');
  expect(html).not.toContain('settings.');
  expect(html).not.toMatch(/<details[^>]*\sopen/);
  expect(html).toContain('<select');
});
it('shows one service breakdown by default and no provider identities', () => {
  state.locale = 'es';
  const html = renderToStaticMarkup(<WalletUsageBreakdown concepts={concepts} activity={activity} currency="usd" timezone="UTC" name={() => 'Respuestas de la IA'} channelName={() => 'WhatsApp'} />);
  expect(html).toContain('Respuestas de la IA');
  expect(html).not.toContain('<td class="py-3">WhatsApp');
  expect(html).not.toMatch(/Anthropic|Cerebras|Stripe|Groq|Gemini/);
});
it('keeps a native, keyboard-accessible disclosure closed initially', () => {
  const html = renderToStaticMarkup(<WalletDisclosure title="Detalle"><p>Contenido</p></WalletDisclosure>);
  expect(html).toContain('<summary');
  expect(html).toContain('Contenido');
  expect(html).not.toMatch(/<details[^>]*\sopen/);
});
