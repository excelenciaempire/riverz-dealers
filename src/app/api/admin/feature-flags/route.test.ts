import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  csrf: vi.fn(), guard: vi.fn(), audit: vi.fn(), from: vi.fn(), upsert: vi.fn(), del: vi.fn(),
}));
vi.mock('@/lib/channels/admin-client', () => ({ supabaseAdmin: () => ({ from: mocks.from }) }));
vi.mock('@/lib/csrf', () => ({ csrfGuard: mocks.csrf }));
vi.mock('@/lib/admin/guard', () => ({ requireAdmin: mocks.guard }));
vi.mock('@/lib/admin/route', () => ({ adminGet: vi.fn() }));
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: mocks.audit }));
vi.mock('@/lib/i18n/server', () => ({ getT: async () => (key: string) => key }));
import { PUT } from './route';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const request = (body: unknown) => new Request('https://riverzai.com/api/admin/feature-flags', {
  method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.csrf.mockResolvedValue(null);
  mocks.guard.mockResolvedValue({ ok: true, actor: { userId: 'admin-1' } });
  mocks.upsert.mockResolvedValue({ error: null });
  const query = { eq: vi.fn(), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) };
  query.eq.mockReturnValue(query);
  mocks.del.mockReturnValue(query);
  mocks.from.mockReturnValue({ upsert: mocks.upsert, delete: mocks.del });
});

it.each([
  { key: 'voice', workspaceId },
  { key: 'voice', workspaceId, enabled: 'false' },
  { key: 'voice', workspaceId: '', enabled: false },
  { key: 'voice', workspaceId: null, enabled: false },
  { key: 'voice', workspaceId: 'invalid', enabled: false },
  { key: 'voice', enabled: null },
  { key: 'unknown', enabled: true },
])('rejects invalid settings without any writes: %j', async (body) => {
  expect((await PUT(request(body))).status).toBe(400);
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.audit).not.toHaveBeenCalled();
});

it('writes a workspace override and records the actual destination', async () => {
  expect((await PUT(request({ key: 'voice', workspaceId, enabled: false }))).status).toBe(200);
  expect(mocks.from).toHaveBeenCalledWith('workspace_feature_flags');
  expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: workspaceId, enabled: false }), { onConflict: 'workspace_id,key' });
  expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ targetId: workspaceId }));
});
it('deletes an override for null instead of disabling the global feature', async () => {
  expect((await PUT(request({ key: 'voice', workspaceId, enabled: null }))).status).toBe(200);
  expect(mocks.del).toHaveBeenCalled();
  expect(mocks.upsert).not.toHaveBeenCalled();
});
it('updates the global feature only when workspaceId is absent', async () => {
  expect((await PUT(request({ key: 'voice', enabled: true }))).status).toBe(200);
  expect(mocks.from).toHaveBeenCalledWith('feature_flags');
});
it('never writes when the caller is not a platform administrator', async () => {
  mocks.guard.mockResolvedValue({ ok: false, res: new Response(null, { status: 403 }) });
  expect((await PUT(request({ key: 'voice', enabled: false }))).status).toBe(403);
  expect(mocks.from).not.toHaveBeenCalled();
});
it('does not report success or audit a write rejected by the database', async () => {
  mocks.upsert.mockResolvedValue({ error: { message: 'private database detail' } });
  const response = await PUT(request({ key: 'voice', enabled: false }));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: 'admin.featureSaveError' });
  expect(mocks.audit).not.toHaveBeenCalled();
});
