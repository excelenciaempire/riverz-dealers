import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ visible: false, card: vi.fn() }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return h.visible; } }));
vi.mock('@/hooks/use-locale', () => ({ useT: () => () => 'Integrations' }));
vi.mock('@/components/settings/channels-panel', () => ({ ChannelsPanel: () => <div data-existing="channels">Existing connections</div> }));
vi.mock('@/components/settings/connection-result', () => ({ ConnectionResult: () => null }));
vi.mock('@/components/settings/http-actions-card', () => ({ HttpActionsCard: h.card }));
import IntegracionesPage from './page';
describe('integration page comparison boundary', () => {
  it('does not add even an empty settings container to the normal page', () => {
    h.visible = false; h.card.mockClear();
    const html = renderToStaticMarkup(<IntegracionesPage />);
    expect(html).toContain('Existing connections'); expect(html).not.toContain('<ul'); expect(h.card).not.toHaveBeenCalled();
  });
  it('keeps existing connections and appends the optional comparison section', () => {
    h.visible = true; h.card.mockReturnValue(<li>Configured actions</li>);
    const html = renderToStaticMarkup(<IntegracionesPage />);
    expect(html).toContain('Existing connections'); expect(html).toContain('<ul'); expect(html).toContain('Configured actions');
    h.visible = false;
  });
});
