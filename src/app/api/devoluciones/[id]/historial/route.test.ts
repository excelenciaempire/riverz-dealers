import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
const f = vi.hoisted(() => ({ enabled: true, locale: 'es', session: vi.fn(), load: vi.fn() }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return f.enabled; } }));
vi.mock('@/lib/inbox/server-context', () => ({ inboxSession: f.session }));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => f.locale }));
vi.mock('@/lib/returns/history', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/returns/history')>(), loadReturnHistory: f.load }));
import { ReturnHistoryError } from '@/lib/returns/history';
import { GET } from './route';
const request = (query = '') => new Request(`https://riverz.co/api/devoluciones/owned-case/historial${query}`);
const context = { params: Promise.resolve({ id: 'owned-case' }) };
beforeEach(() => { f.enabled = true; f.locale = 'es'; f.session.mockResolvedValue({ db: 'database', workspaceId: 'session-workspace',userId:'session-actor' }); f.load.mockResolvedValue({ events: [], next_cursor: null }); });
describe('reserved return history API', () => {
  it('returns reserved 404 before authenticating or reading outside comparison', async () => {
    f.enabled = false; const response = await GET(request(), context);
    expect(response.status).toBe(404); expect(f.session).not.toHaveBeenCalled(); expect(f.load).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it.each([401, 403, 503])('preserves session failure %s without loading events', async status => {
    f.session.mockResolvedValue({ response: NextResponse.json({ error: 'session failure' }, { status }) });
    const response = await GET(request(), context);
    expect(response.status).toBe(status); expect(f.load).not.toHaveBeenCalled(); expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('passes only the trusted session workspace and path case', async () => {
    expect((await GET(request(), context)).status).toBe(200);
    expect(f.load).toHaveBeenCalledWith('database', 'session-workspace', 'owned-case','session-actor', undefined);
  });
  it.each(['?workspace_id=foreign', '?cursor=', '?cursor=invalid'])('rejects malformed scope or cursor %s before reading', async query => {
    expect((await GET(request(query), context)).status).toBe(400); expect(f.load).not.toHaveBeenCalled();
  });
  it.each(['es', 'en'])('localizes read failure in %s without private detail', async locale => {
    f.locale = locale; f.load.mockRejectedValue(new Error('private SQL detail'));
    const response = await GET(request(), context); expect(response.status).toBe(503);
    const text = JSON.stringify(await response.json()); expect(text).not.toMatch(/private|SQL|returns\./);
    expect(text).toContain(locale === 'en' ? 'Could not load' : 'No se pudo');
  });
  it('hides a foreign case as not found', async () => {
    f.load.mockRejectedValue(new ReturnHistoryError('notFound'));
    expect((await GET(request(), context)).status).toBe(404);
  });
});
