import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/lib/i18n/translate';
const h = vi.hoisted(() => ({ visible: true, locale: 'es' as 'es' | 'en', reads: 0 }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return h.visible; } }));
vi.mock('@/hooks/use-locale', () => ({ useT: () => (key: string) => translate(h.locale, key), useLocale: () => { h.reads++; return { locale: h.locale }; } }));
import { HttpActionStarterPicker } from './http-action-starter-picker';
beforeEach(() => { h.visible = true; h.locale = 'es'; h.reads = 0; });
describe('comparison-only optional starter picker', () => {
  it('renders nothing and reads no locale outside comparison', () => {
    h.visible = false; const apply = vi.fn(); expect(renderToStaticMarkup(<HttpActionStarterPicker apply={apply} />)).toBe('');
    expect(h.reads).toBe(0); expect(apply).not.toHaveBeenCalled();
  });
  it.each(['es', 'en'] as const)('starts with manual setup and never applies a template automatically in %s', locale => {
    h.locale = locale; const apply = vi.fn(), html = renderToStaticMarkup(<HttpActionStarterPicker apply={apply} />);
    expect(html).toContain(translate(locale, 'settings.httpStarterTitle')); expect(html).toContain('value="" selected=""');
    expect(html).toContain('Make'); expect(html).toContain('n8n'); expect(html).not.toContain('target="_blank"'); expect(apply).not.toHaveBeenCalled();
  });
});
