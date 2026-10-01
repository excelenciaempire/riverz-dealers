import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const f = vi.hoisted(() => ({ enabled: true, guard: vi.fn(), load: vi.fn(), admin: vi.fn() }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return f.enabled; } }));
vi.mock('@/lib/channels/webchat/guard', () => ({ requireSession: f.guard }));
vi.mock('@/lib/channels/admin-client', () => ({ supabaseAdmin: f.admin }));
vi.mock('@/lib/channels/webchat/visitor-orders', () => ({ loadVisitorOrders: f.load }));
import { GET } from './route';

const session = { workspaceId: 'signed-workspace', visitorId: 'signed-visitor', origin: 'shop.example', exp: 0 };
beforeEach(() => { f.enabled = true; f.guard.mockResolvedValue({ ok: true, session }); f.admin.mockReturnValue('database'); f.load.mockResolvedValue({ orders: [], next_cursor: null }); });

describe('reserved widget order API', () => {
  it.each(['es', 'en'])('keeps the feature unavailable outside comparison in %s', async locale => {
    f.enabled = false;
    const response = await GET(new Request(`https://riverz.co/api/widget/orders?locale=${locale}`));
    expect(response.status).toBe(404); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect((await response.json()).error).not.toContain('webchat.'); expect(f.guard).not.toHaveBeenCalled(); expect(f.load).not.toHaveBeenCalled();
  });
  it.each([401, 404, 429])('preserves session, origin, connection and rate-limit denial %s', async status => {
    f.guard.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'blocked' }, { status }) });
    const response = await GET(new Request('https://riverz.co/api/widget/orders'));
    expect(response.status).toBe(status); expect(f.load).not.toHaveBeenCalled(); expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('reads only with the session returned by the shared guard', async () => {
    const response = await GET(new Request('https://riverz.co/api/widget/orders?locale=en'));
    expect(response.status).toBe(200); expect(f.guard).toHaveBeenCalledWith(expect.any(Request), 'poll');
    expect(f.load).toHaveBeenCalledWith('database', session, undefined);
  });
  it.each(['workspaceId=foreign', 'contact_id=foreign', 'locale=en&locale=es', 'cursor=invalid', 'locale=fr'])('rejects invalid query %s before loading orders', async query => {
    expect((await GET(new Request(`https://riverz.co/api/widget/orders?${query}`))).status).toBe(400);
    expect(f.load).not.toHaveBeenCalled();
  });
  it.each(['es', 'en'])('returns a localized generic failure in %s without leaking service errors', async locale => {
    f.load.mockRejectedValue(new Error('private service secret'));
    const response = await GET(new Request(`https://riverz.co/api/widget/orders?locale=${locale}`));
    expect(response.status).toBe(503); expect(response.headers.get('cache-control')).toBe('private, no-store');
    const text = JSON.stringify(await response.json()); expect(text).not.toMatch(/private|secret|webchat\./);
    expect(text).toContain(locale === 'en' ? 'Orders could not' : 'No se pudieron');
  });
});
