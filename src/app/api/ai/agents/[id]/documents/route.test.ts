import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/lib/i18n/translate';
import type { Locale } from '@/lib/i18n/config';
const h = vi.hoisted(() => ({ enabled: true, locale: 'es' as Locale, user: true, agent: true, member: true, role: 'owner', csrf: false, rate: true, manage: vi.fn(), extract: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return h.enabled; } }));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => h.locale }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user ? { id: '44444444-4444-4444-8444-444444444444' } : null } }) } }) }));
vi.mock('@/lib/channels/admin-client', () => ({ supabaseAdmin: () => ({ from: (table: string) => {
  const q = { select: () => q, eq: () => q, is: () => q, maybeSingle: async () => table === 'ai_agents'
    ? { data: h.agent ? { id: '11111111-1111-4111-8111-111111111111', workspace_id: '22222222-2222-4222-8222-222222222222' } : null, error: null }
    : { data: h.member ? { role: h.role } : null, error: null } };return q;
} }) }));
vi.mock('@/lib/csrf', () => ({ csrfGuard: async () => h.csrf ? new Response('{}', { status: 403 }) : null }));
vi.mock('@/lib/rate-limit', () => ({ limitByKey: async () => ({ success: h.rate, reset: Date.now() + 10000 }) }));
vi.mock('@/lib/ai/document-sources', async () => ({ ...await vi.importActual<typeof import('@/lib/ai/document-sources')>('@/lib/ai/document-sources'), manageDocumentSource: h.manage }));
vi.mock('@/lib/ai/document-extraction', async () => ({ ...await vi.importActual<typeof import('@/lib/ai/document-extraction')>('@/lib/ai/document-extraction'), extractDocument: h.extract }));
import { GET, POST, PATCH } from './route';
import { DocumentSourceError } from '@/lib/ai/document-sources';
import { DocumentExtractionError } from '@/lib/ai/document-extraction';
const id = '11111111-1111-4111-8111-111111111111', sourceId = '33333333-3333-4333-8333-333333333333';
const context = { params: Promise.resolve({ id }) }, url = `https://riverz.co/api/ai/agents/${id}/documents`;
function json(body: unknown) { return new Request(url, { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }); }
function upload(fields?: Record<string, string>) {
  const form = new FormData();form.append('file', new File(['test'], 'policy.pdf', { type: 'application/pdf' }));
  for (const [key, value] of Object.entries(fields ?? {})) form.append(key, value);
  return new Request(url, { method: 'POST', body: form });
}
beforeEach(() => {
  h.enabled = true;h.locale = 'es';h.user = true;h.agent = true;h.member = true;h.role = 'owner';h.csrf = false;h.rate = true;
  h.manage.mockReset().mockResolvedValue({ sources: [] });h.extract.mockReset().mockResolvedValue({ name: 'policy.pdf', format: 'pdf', bytes: 4, sha256: 'a'.repeat(64), text: 'Reviewed policy' });
});
describe('document import route', () => {
  it('reserves reads and mutations outside comparison before parsing any file', async () => {
    h.enabled = false;
    for (const response of [await GET(new Request(url), context), await POST(upload(), context), await PATCH(json({}), context)]) {
      expect(response.status).toBe(404);expect(response.headers.get('Cache-Control')).toContain('no-store');
    }
    expect(h.manage).not.toHaveBeenCalled();expect(h.extract).not.toHaveBeenCalled();
  });
  it.each(['user','agent','member'] as const)('rejects missing %s before reading or importing', async field => {
    h[field] = false;expect((await GET(new Request(url), context)).status).toBe(404);expect((await POST(upload(), context)).status).toBe(404);expect(h.manage).not.toHaveBeenCalled();expect(h.extract).not.toHaveBeenCalled();
  });
  it('reads through server-resolved identity and exposes editability without allowing scope parameters', async () => {
    h.role = 'agent';const response = await GET(new Request(url), context);expect(await response.json()).toEqual({ sources: [], can_edit: false });
    expect(h.manage.mock.calls[0][1]).toMatchObject({ workspaceId: '22222222-2222-4222-8222-222222222222', actorId: '44444444-4444-4444-8444-444444444444', agentId: id, action: 'list' });
    for (const query of ['?workspace_id=other', '?source_id=', '?source_id=bad', `?source_id=${sourceId}&source_id=${sourceId}`]) expect((await GET(new Request(url + query), context)).status).toBe(422);
    expect(h.manage).toHaveBeenCalledTimes(1);
  });
  it('checks CSRF, current administrative role and import quota before extracting', async () => {
    h.csrf = true;expect((await POST(upload(), context)).status).toBe(403);expect((await PATCH(json({}), context)).status).toBe(403);
    h.csrf = false;h.role = 'agent';expect((await POST(upload(), context)).status).toBe(403);
    h.role = 'owner';h.rate = false;const blocked = await POST(upload(), context);expect(blocked.status).toBe(429);expect(blocked.headers.get('Retry-After')).toBe('10');expect(h.extract).not.toHaveBeenCalled();
  });
  it('imports extracted text as a draft, and passes replacement identity and expected revision separately', async () => {
    h.manage.mockResolvedValue({ id: sourceId, status: 'draft' });expect((await POST(upload(), context)).status).toBe(201);
    expect(h.manage.mock.calls[0][1]).toMatchObject({ action: 'create', text: 'Reviewed policy', sourceId: undefined });
    expect((await POST(upload({ source_id: sourceId, revision: '3' }), context)).status).toBe(201);
    expect(h.manage.mock.calls[1][1]).toMatchObject({ action: 'replace', sourceId, revision: 3 });
  });
  it('bounds streamed request bytes even when content-length is absent', async () => {
    const oversized = new Request(url, { method: 'POST', body: new Uint8Array(5 * 1024 * 1024 + 16385) });
    expect((await POST(oversized, context)).status).toBe(413);expect(h.extract).not.toHaveBeenCalled();expect(h.manage).not.toHaveBeenCalled();
  });
  it('rejects malformed multipart, extra fields, and incomplete replacement references', async () => {
    expect((await POST(new Request(url, { method: 'POST', body: 'not multipart' }), context)).status).toBe(422);
    for (const fields of [{ workspace_id: 'other' }, { source_id: sourceId }, { source_id: sourceId, revision: '0' }] as Record<string, string>[]) expect((await POST(upload(fields), context)).status).toBe(422);
    expect(h.extract).not.toHaveBeenCalled();expect(h.manage).not.toHaveBeenCalled();
  });
  it.each(['es','en'] as const)('does not persist extraction failures and returns localized errors in %s', async locale => {
    h.locale = locale;h.extract.mockRejectedValue(new DocumentExtractionError('document_no_text'));
    const response = await POST(upload(), context);expect(response.status).toBe(422);expect(await response.json()).toEqual({ error: translate(locale, 'assistant.document_no_text') });expect(h.manage).not.toHaveBeenCalled();
  });
  it('checks strict mutation contracts and preserves optimistic revision on activation', async () => {
    expect((await PATCH(json({ action: 'activate', source_id: sourceId, revision: 2 }), context)).status).toBe(200);
    expect(h.manage.mock.calls[0][1]).toMatchObject({ action: 'activate', sourceId, revision: 2 });
    for (const body of [{ action: 'activate', source_id: sourceId, revision: 2, text: 'Forged review' }, { action: 'edit', source_id: sourceId, revision: 2, text: '' }, { action: 'edit', source_id: sourceId, revision: 2, text: 'a'.repeat(32001) }, { action: 'delete', source_id: sourceId, revision: 2 }, { action: 'withdraw', source_id: sourceId, revision: 2, workspace_id: 'other' }]) expect((await PATCH(json(body), context)).status).toBe(422);
    expect(h.manage).toHaveBeenCalledTimes(1);
  });
  it.each(['es','en'] as const)('reports concurrent edits and revoked write permission without leaking storage details in %s', async locale => {
    h.locale = locale;h.manage.mockRejectedValueOnce(new DocumentSourceError('document_changed'));
    const response = await PATCH(json({ action: 'activate', source_id: sourceId, revision: 2 }), context);expect(response.status).toBe(409);expect(await response.json()).toEqual({ error: translate(locale, 'assistant.document_changed') });
    h.manage.mockRejectedValueOnce(new Error('Secret SQL details'));const failed = await GET(new Request(url), context);expect(failed.status).toBe(503);expect(JSON.stringify(await failed.json())).not.toContain('Secret');
  });
});
