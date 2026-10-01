import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ enabled: false }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return f.enabled; } }));
import { OrderRequests } from './order-requests';

describe('widget order controls remain reserved', () => {
  it.each(['es', 'en'] as const)('renders no new controls outside comparison in %s', locale => {
    f.enabled = false;
    expect(renderToStaticMarkup(<OrderRequests session="private-token" locale={locale} onSend={async () => true} onExpired={() => {}} />)).toBe('');
  });
  it.each(['es', 'en'] as const)('shows a localized entry point only in comparison, without serializing the session in %s', locale => {
    f.enabled = true;
    const html = renderToStaticMarkup(<OrderRequests session="private-token" locale={locale} onSend={async () => true} onExpired={() => {}} />);
    expect(html).toContain(locale === 'en' ? 'My orders' : 'Mis pedidos');
    expect(html).not.toMatch(/private-token|webchat\./);
  });
});
