import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/lib/i18n/translate';
import type { Locale } from '@/lib/i18n/config';
const h = vi.hoisted(() => ({ visible: true, locale: 'en' as Locale, request: vi.fn() }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return h.visible; } }));
vi.mock('@/hooks/use-locale', () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => translate(h.locale, key, vars) }));
vi.mock('@/lib/api/fetch-with-csrf', () => ({ useFetchWithCsrf: () => h.request }));
import { HttpActionGrants } from './http-action-grants';
const row = { id: '22222222-2222-4222-8222-222222222222', revision: 2, state: 'active' as const, updated_at: '2026-10-01T00:00:00Z', has_secret: false,
  definition: { name: 'Fixture', description: 'Fixture purpose', url: 'https://fixture.test/status', method: 'GET' as const, credential_kind: 'none' as const, parameters: [], outputs: [] } };
beforeEach(() => { vi.clearAllMocks(); h.visible = true; h.locale = 'en'; });
describe('optional assistant permission controls', () => {
  it('renders no controls or requests without comparison or required access', () => {
    h.visible = false; expect(renderToStaticMarkup(<HttpActionGrants workspaceId="own" row={row} allowed />)).toBe('');
    h.visible = true; expect(renderToStaticMarkup(<HttpActionGrants workspaceId="own" row={row} allowed={false} />)).toBe('');
    expect(h.request).not.toHaveBeenCalled();
  });
  it.each(['es', 'en'] as const)('starts collapsed without configuration/profile requests or forms (%s)', locale => {
    h.locale = locale; const html = renderToStaticMarkup(<HttpActionGrants workspaceId="own" row={row} allowed />);
    expect(html).toContain('aria-expanded="false"'); expect(html).toContain(translate(locale, 'settings.httpGrantTitle'));
    expect(html).not.toContain('<form'); expect(html).not.toContain('fixture.test'); expect(h.request).not.toHaveBeenCalled();
  });
});
