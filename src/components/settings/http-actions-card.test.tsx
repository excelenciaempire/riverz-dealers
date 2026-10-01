import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/lib/i18n/translate';
import type { Locale } from '@/lib/i18n/config';
const h = vi.hoisted(() => ({ visible: false, locale: 'en' as Locale, admin: true, loading: false,
  sections: null as string[] | null, workspace: '11111111-1111-4111-8111-111111111111', accessCalls: 0, request: vi.fn() }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return h.visible; } }));
vi.mock('@/hooks/use-locale', () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => translate(h.locale, key, vars) }));
vi.mock('@/hooks/use-workspace', () => ({ useWorkspace: () => { h.accessCalls++; return { workspace: h.workspace ? { id: h.workspace } : null,
  membership: { role: 'admin', allowed_sections: h.sections }, isAdmin: h.admin, loading: h.loading }; } }));
vi.mock('@/lib/api/fetch-with-csrf', () => ({ useFetchWithCsrf: () => h.request }));
import { HttpActionsCard } from './http-actions-card';
beforeEach(() => { h.visible = false; h.locale = 'en'; h.admin = true; h.loading = false; h.sections = null;
  h.workspace = '11111111-1111-4111-8111-111111111111'; h.accessCalls = 0; vi.clearAllMocks(); });
describe('HTTP settings reserved for comparison', () => {
  it('renders nothing and reads no identity or configuration in the normal build', () => {
    expect(renderToStaticMarkup(<HttpActionsCard />)).toBe(''); expect(h.accessCalls).toBe(0); expect(h.request).not.toHaveBeenCalled();
  });
  it.each(['agent', 'section', 'loading', 'no-workspace'])('hides configuration from %s context', mode => {
    h.visible = true;
    if (mode === 'agent') h.admin = false; else if (mode === 'section') h.sections = ['/automatizaciones'];
    else if (mode === 'loading') h.loading = true; else h.workspace = '';
    expect(renderToStaticMarkup(<HttpActionsCard />)).toBe(''); expect(h.request).not.toHaveBeenCalled();
  });
  it.each(['es', 'en'] as const)('starts as one collapsed localized section with no automatic API request in %s', locale => {
    h.visible = true; h.locale = locale;
    const html = renderToStaticMarkup(<HttpActionsCard />);
    expect(html).toContain(translate(locale, 'settings.httpTitle')); expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('<form'); expect(html).not.toContain('type="password"'); expect(h.request).not.toHaveBeenCalled();
  });
});
