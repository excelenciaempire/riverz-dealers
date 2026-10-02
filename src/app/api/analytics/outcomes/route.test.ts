import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ user: { id: 'user' } as { id: string } | null, workspace: 'workspace' as string | null,
  read: vi.fn(), rpc: vi.fn(), csrf: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mock.user } }) } }) }));
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => ({ rpc: mock.rpc }) }));
vi.mock('@/lib/workspaces/resolve', () => ({ resolveWorkspaceIdForUser: async () => mock.workspace }));
vi.mock('@/lib/csrf', () => ({ csrfGuard: mock.csrf }));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'es' }));
vi.mock('@/lib/dashboard/outcomes-query', () => ({ readOutcomes: mock.read }));
import { GET, PATCH } from './route';
const id = '00000000-0000-4000-8000-000000000001', last = '00000000-0000-4000-8000-000000000002';
const patch = (extra = {}, category: string | null = 'tracking') => new Request('https://riverz.co/api/analytics/outcomes', {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: id, lastMessageId: last, category, ...extra }),
});
beforeEach(() => {
  vi.clearAllMocks(); mock.user = { id: 'user' }; mock.workspace = 'workspace'; mock.csrf.mockResolvedValue(null);
  mock.rpc.mockResolvedValue({ data: { ok: true }, error: null }); mock.read.mockResolvedValue({ cases: [] });
});
it('requires authentication and workspace resolution', async () => {
  mock.user = null; expect((await PATCH(patch())).status).toBe(401); expect(mock.rpc).not.toHaveBeenCalled();
});
it.each([['dashboard_outcome_not_found', 404], ['dashboard_outcome_changed', 409], ['subscription_read_only', 402]])('maps atomic rejection %s to %s', async (message, status) => {
  mock.rpc.mockResolvedValue({ error: { message }, data: null });
  const response = await PATCH(patch()); expect(response.status).toBe(status);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
});
it('writes only server-resolved identity through the transactional writer', async () => {
  expect((await PATCH(patch())).status).toBe(200);
  expect(mock.rpc).toHaveBeenCalledWith('write_dashboard_outcome', { p_workspace_id: 'workspace', p_actor_id: 'user',
    p_conversation_id: id, p_last_message_id: last, p_category: 'tracking' });
});
it.each([{ workspace_id: id }, { actor_id: id }, { verified_by: id }])('rejects authority supplied in the body: %s', async extra => {
  expect((await PATCH(patch(extra))).status).toBe(400); expect(mock.rpc).not.toHaveBeenCalled();
});
it('withdraws through the same atomic evidence and permission checks', async () => {
  expect((await PATCH(patch({}, null))).status).toBe(200);
  expect(mock.rpc).toHaveBeenCalledWith('write_dashboard_outcome', expect.objectContaining({ p_category: null, p_last_message_id: last }));
});
it('does not report malformed writer output as success', async () => {
  mock.rpc.mockResolvedValue({ data: {}, error: null }); expect((await PATCH(patch())).status).toBe(502);
});
it('hides provider/database details in errors', async () => {
  mock.rpc.mockResolvedValue({ error: { message: 'synthetic secret details' } });
  const response = await PATCH(patch()); expect(response.status).toBe(502); expect(await response.text()).not.toContain('secret');
});
it.each(['start=2026-09-20&end=2026-09-01', 'start=2026-09-01&end=2026-09-20&actor_id=user', 'start=2026-09-01&start=2026-09-02&end=2026-09-20'])('rejects invalid or overridden report queries: %s', async query => {
  expect((await GET(new Request(`https://riverz.co/api/analytics/outcomes?${query}`))).status).toBe(400);
  expect(mock.read).not.toHaveBeenCalled();
});
it('passes the actual session actor to report reads', async () => {
  const response = await GET(new Request('https://riverz.co/api/analytics/outcomes?start=2026-09-01&end=2026-09-20'));
  expect(response.status).toBe(200); expect(mock.read).toHaveBeenCalledWith(expect.anything(), 'workspace', expect.anything(), 'user');
});
it('preserves CSRF protection', async () => {
  mock.csrf.mockResolvedValue(new Response(null, { status: 403 })); expect((await PATCH(patch())).status).toBe(403); expect(mock.rpc).not.toHaveBeenCalled();
});
it('rejects unbounded and non-JSON bodies before writing', async () => {
  const response = await PATCH(new Request('https://riverz.co/api/analytics/outcomes', { method: 'PATCH',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ padding: 'a'.repeat(5000) }) }));
  expect(response.status).toBe(400); expect(mock.rpc).not.toHaveBeenCalled();
  expect((await PATCH(new Request('https://riverz.co/api/analytics/outcomes', { method: 'PATCH', body: '{}' }))).status).toBe(400);
});
