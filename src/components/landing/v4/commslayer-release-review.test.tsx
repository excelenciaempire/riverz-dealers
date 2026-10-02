import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, beforeEach, expect, it, vi } from 'vitest';
import type { Locale } from '@/lib/i18n/config';
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/i18n/format';
import { MESSAGES } from '@/lib/i18n/messages/registry';
const h = vi.hoisted(() => ({ enabled: true, locale: 'es' as Locale, section: 'demos', index: 0 }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return h.enabled; } }));
vi.mock('@/hooks/use-locale', () => ({ useLocale: () => ({ locale: h.locale }) }));
vi.mock('@/hooks/use-format', () => ({ useFormat: () => ({ number: (value: number) => formatNumber(value, h.locale), dateTime: (value: string) => formatDateTime(value, h.locale), currency: (value: number, currency: string, options: Intl.NumberFormatOptions) => formatCurrency(value, h.locale, currency, options) }) }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useState: (initial: unknown) => [h.index++ === 0 ? h.section : initial, vi.fn()] }));
import { CommslayerReleaseReview } from './commslayer-release-review';
beforeEach(() => { h.enabled = true;h.locale = 'es';h.section = 'demos';h.index = 0; });
describe('private release review', () => {
  it.each(['es', 'en'] as const)('does not expose launch material in the current interface in %s', locale => {
    h.enabled = false;h.locale = locale;expect(renderToStaticMarkup(<CommslayerReleaseReview />)).toBe('');
  });
  for (const locale of ['es', 'en'] as const) {
    it.each(['demos', 'examples', 'pricing', 'integrations', 'changelog'])('keeps %s localized and reserved for review in ' + locale, section => {
      h.locale = locale;h.section = section;const html = renderToStaticMarkup(<CommslayerReleaseReview />);
      expect(html).toContain(locale === 'es' ? 'Material privado' : 'Private materials');expect(html).not.toContain('commslayerRelease.');expect(html).not.toContain('�');
      if (section === 'pricing') { expect(html).toContain(locale === 'es' ? 'Las unidades de cobro son diferentes' : 'Billing units differ');expect(html).toContain('https://www.commslayer.com/pricing');expect(html).not.toContain('ROI'); }
      if (section === 'examples') expect(html).toContain(locale === 'es' ? 'Son configuraciones ilustrativas' : 'These are illustrative configurations');
      if (section === 'changelog') expect(html).toContain(locale === 'es' ? 'no anuncia disponibilidad general' : 'does not announce general availability');
    });
  }
  it('keeps the bounded release catalog out of the public app/admin registry', () => {
    expect(Object.keys(MESSAGES).some(key => key.startsWith('commslayerRelease.'))).toBe(false);
  });
});
