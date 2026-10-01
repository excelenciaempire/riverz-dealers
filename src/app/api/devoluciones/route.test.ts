import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
const f = vi.hoisted(() => ({ locale: 'es', session: vi.fn(), csrf: vi.fn(), decide: vi.fn() }));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => f.locale }));
vi.mock('@/lib/inbox/server-context', () => ({ inboxSession: f.session }));
vi.mock('@/lib/csrf', () => ({ csrfGuard: f.csrf }));
vi.mock('@/lib/returns/decision', async () => ({ ...await vi.importActual<typeof import('@/lib/returns/decision')>('@/lib/returns/decision'), decideReturn: f.decide }));
import { ReturnDecisionError } from '@/lib/returns/decision';
import { GET, PATCH } from './route';
const id = '11111111-1111-4111-8111-111111111111', actor = '22222222-2222-4222-8222-222222222222';
const request = (body: unknown) => new Request('https://riverz.co/api/devoluciones', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => {
  f.locale = 'es'; f.csrf.mockResolvedValue(null); f.session.mockResolvedValue({ db: 'database', workspaceId: 'trusted-workspace', userId: actor });
  f.decide.mockResolvedValue({ status: 'aprobada', updated_at: '2026-10-01T12:00:00.123456Z', unchanged: false });
});

describe('return decision API', () => {
  it('checks CSRF before session and decision reads', async () => {
    f.csrf.mockResolvedValue(new Response('{}', { status: 403 }));
    expect((await PATCH(request({ id, status: 'aprobada' }))).status).toBe(403);
    expect(f.session).not.toHaveBeenCalled(); expect(f.decide).not.toHaveBeenCalled();
  });
  it.each([401, 403, 503])('preserves session or membership failure %s', async status => {
    f.session.mockResolvedValue({ response: NextResponse.json({ error: 'unavailable' }, { status }) });
    for (const response of [await GET(new Request('https://riverz.co/api/devoluciones')), await PATCH(request({ id, status: 'aprobada' }))]) {
      expect(response.status).toBe(status); expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(f.decide).not.toHaveBeenCalled();
  });
  it('delegates the decision with trusted business and actor and an exact observed timestamp', async () => {
    const body = { id, status: 'aprobada', expected_updated_at: '2026-10-01T12:00:00.123456Z' };
    const response = await PATCH(request(body));
    expect(response.status).toBe(200); expect(f.decide).toHaveBeenCalledWith('database', 'trusted-workspace', actor, body);
    expect(await response.json()).toEqual({ ok: true, status: 'aprobada', updated_at: '2026-10-01T12:00:00.123456Z', unchanged: false });
  });
  it.each([{ id, status: 'unknown' }, { id: 'invalid', status: 'aprobada' }, { id, status: 'aprobada', workspace_id: 'foreign' }, { id, status: 'aprobada', resolution: 'x'.repeat(501) }, { id, status: 'aprobada', expected_updated_at: 'invalid' }])('rejects an invalid decision: %j', async body => {
    expect((await PATCH(request(body))).status).toBe(400); expect(f.decide).not.toHaveBeenCalled();
  });
  it.each(['es', 'en'])('returns localized failures in %s without SQL details', async locale => {
    f.locale = locale;
    for (const [code, status] of [['unauthorized', 403], ['notFound', 404], ['platformManaged', 409], ['decisionChanged', 409], ['saveFailed', 503]] as const) {
      f.decide.mockRejectedValueOnce(new ReturnDecisionError(code));
      const response = await PATCH(request({ id, status: 'aprobada' }));
      expect(response.status).toBe(status); expect(JSON.stringify(await response.json())).not.toContain('returns.');
    }
    f.decide.mockRejectedValueOnce(new Error('private database secret'));
    const response = await PATCH(request({ id, status: 'aprobada' }));
    expect(response.status).toBe(503); expect((await response.json()).error).toBe(locale === 'en' ? 'Could not save.' : 'No se pudo guardar.');
  });
});

describe('return list contact isolation', () => {
  it.each([false, true])('scrubs inconsistent contact joins, malformedOnly=%s', async malformedOnly => {
    const records = malformedOnly ? [{ id, status: 'abierta', contacts: [{ id: 'foreign', name: 'private foreign name' }] }] : [
      { id, status: 'abierta', contacts: { id: 'own', name: 'Own' } },
      { id: 'other', status: 'aprobada', contacts: { id: 'foreign', name: 'private foreign name' } },
    ];
    const filters: unknown[] = [];
    const db = { from(table: string) {
      const q = {
        select: () => q, order: () => q, limit: () => q,
        eq: (key: string, value: unknown) => { filters.push([table, key, value]); return q; }, in: () => q,
        then: (resolve: (result: unknown) => unknown) => resolve({ data: table === 'returns' ? structuredClone(records) : [{ id: 'own' }], error: null }),
      }; return q;
    } };
    f.session.mockResolvedValue({ db, workspaceId: 'trusted-workspace', userId: actor });
    const response = await GET(new Request('https://riverz.co/api/devoluciones'));
    expect(response.status).toBe(200);
    const body = await response.json(); expect(JSON.stringify(body)).not.toContain('private foreign name');
    expect(filters).toContainEqual(['returns', 'workspace_id', 'trusted-workspace']);
    if (!malformedOnly) expect(body.returns[0].contacts.name).toBe('Own');
  });
});
