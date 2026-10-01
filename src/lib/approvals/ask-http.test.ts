import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const m = vi.hoisted(() => ({ text: vi.fn(), template: vi.fn(), platform: vi.fn() }));
vi.mock('@/lib/admin/platform-whatsapp', () => ({ platformWhatsApp: m.platform }));
vi.mock('@/lib/whatsapp/meta-api', () => ({ sendTextMessage: m.text, sendTemplateMessage: m.template }));
import { askForApproval } from './ask';
import { isProtectedHttpApproval } from './protected-http';
const workspace = '11111111-1111-4111-8111-111111111111', actor = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333', dedupeKey = 'http:' + 'a'.repeat(64);
const payload = { tool: 'http_action_example_v1', input: { request: 'reviewed', quantity: 2 } };
let existing: Record<string, unknown> | null, error: string, reads: number;
let writes: Array<{ op: string; payload: unknown }>, queries: Array<Array<[string, unknown]>>;
const input = (db = fakeDb()) => ({ db, workspaceId: workspace, kind: 'herramienta', title: 'Review action',
  body: 'Exact parameters', payload, dedupeKey, locale: 'en' as const });
function stored() { return { id, title: 'Review action', body: 'Exact parameters', payload: { ...payload, dedupe_key: dedupeKey },
  status: 'pendiente', expires_at: new Date(Date.now() + 86400000).toISOString(), notified_message_id: 'confirmed' }; }
function fakeDb(): SupabaseClient {
  return { from(table: string) {
    const filters: Array<[string, unknown]> = []; queries.push(filters);
    let op = '';
    const q: Record<string, unknown> = {
      select: () => q, limit: () => q,
      eq(key: string, value: unknown) { filters.push([key, value]); return q; },
      contains(key: string, value: unknown) { filters.push([key, value]); return q; },
      insert(value: unknown) { writes.push({ op: 'insert', payload: value }); op = 'insert'; return q; },
      update(value: unknown) { writes.push({ op: 'update', payload: value }); return q; },
      maybeSingle: async () => {
        if (table === 'workspaces') return { data: { owner_id: actor }, error: null };
        reads++;
        return { data: error === 'race' && reads === 1 ? null : existing, error: error === 'read' ? { message: 'private' } : null };
      },
      single: async () => { return { data: op === 'insert' ? { id } : null,
        error: ['race', 'insert'].includes(error) ? { code: error === 'race' ? '23505' : 'error', message: 'private' } : null }; },
    };
    if (table === 'workspace_members') { q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve); }
    if (table === 'profiles') q.in = () => Promise.resolve({ data: [{ user_id: actor, phone: '573001234567' }], error: null });
    return q;
  } } as unknown as SupabaseClient;
}
beforeEach(() => { vi.clearAllMocks(); existing = null; error = ''; reads = 0; writes = []; queries = [];
  m.platform.mockResolvedValue({ phoneNumberId: 'test', token: 'test', templateName: null, templateLanguage: 'es' });
  m.text.mockResolvedValue({ messageId: 'new-message' }); m.template.mockResolvedValue({ messageId: 'new-template' }); });
describe('HTTP proposal retries preserve the reviewed snapshot', () => {
  it('reuses a matching pending review without any writes or repeat notifications', async () => {
    existing = stored(); expect(await askForApproval(input())).toEqual({ ok: true, approvalId: id, notified: true });
    expect(writes).toEqual([]); expect(m.text).not.toHaveBeenCalled();
    expect(queries[0]).toContainEqual(['workspace_id', workspace]); expect(queries[0]).toContainEqual(['payload', { dedupe_key: dedupeKey }]);
  });
  it('accepts equivalent payload key order', async () => {
    existing = stored(); existing.payload = { dedupe_key: dedupeKey, input: { quantity: 2, request: 'reviewed' }, tool: payload.tool };
    expect((await askForApproval(input())).ok).toBe(true); expect(writes).toEqual([]);
  });
  it.each(['input', 'title', 'body'])('never rewrites a changed %s', async field => {
    existing = stored(); if (field === 'input') existing.payload = { ...payload, input: { request: 'other' }, dedupe_key: dedupeKey };
    else existing[field] = 'different';
    expect(await askForApproval(input())).toMatchObject({ ok: false, error: 'http_approval_snapshot_changed' }); expect(writes).toEqual([]);
  });
  it.each(['aprobada', 'rechazada', 'vencida', 'fallida'])('does not create a fresh request after %s', async status => {
    existing = { ...stored(), status };
    expect(await askForApproval(input())).toMatchObject({ ok: false, approvalId: id, error: 'http_approval_already_decided' }); expect(writes).toEqual([]);
  });
  it('does not extend an expired pending request', async () => {
    existing = { ...stored(), expires_at: '2000-01-01T00:00:00Z' };
    expect(await askForApproval(input())).toMatchObject({ ok: false, error: 'http_approval_review_required' }); expect(writes).toEqual([]);
  });
  it('observes the winning exact request after a simultaneous insert conflict', async () => {
    error = 'race'; existing = stored(); expect(await askForApproval(input())).toMatchObject({ ok: true, approvalId: id });
    expect(reads).toBe(2); expect(writes.filter(write => write.op === 'insert')).toHaveLength(1); expect(m.text).not.toHaveBeenCalled();
  });
  it.each(['read', 'insert'])('does not expose private backend errors: %s', async problem => {
    error = problem; expect(await askForApproval(input())).toMatchObject({ ok: false, error: 'http_approval_unavailable' }); expect(m.text).not.toHaveBeenCalled();
  });
  it('requires a stable proposal key before any query', async () => {
    expect((await askForApproval({ ...input(), dedupeKey: undefined })).ok).toBe(false); expect(queries).toEqual([]);
  });
  it.each(['es', 'en'] as const)('notifies the authenticated panel review instead of requesting WhatsApp approval: %s', async locale => {
    expect((await askForApproval({ ...input(), locale })).notified).toBe(true);
    expect(m.text.mock.calls[0][0].text).toContain(locale === 'en' ? 'dashboard' : 'panel');
    expect(m.text.mock.calls[0][0].text).not.toMatch(/Responde SI|responde SI|NO 333333/);
  });
  it('uses the same panel-only instruction in configured templates', async () => {
    m.platform.mockResolvedValue({ phoneNumberId: 'test', token: 'test', templateName: 'configured', templateLanguage: 'en' });
    await askForApproval(input()); expect(m.template.mock.calls[0][0].params[1]).toContain('dashboard');
    expect(m.template.mock.calls[0][0].params[1]).not.toMatch(/responde SI/);
  });
  it('reserves malformed future flow proposals from legacy execution', () => {
    expect(isProtectedHttpApproval({ tool: 'http_flow_action_malformed' })).toBe(true);
    expect(isProtectedHttpApproval({ tool: 'legacy' })).toBe(false);
  });
});
