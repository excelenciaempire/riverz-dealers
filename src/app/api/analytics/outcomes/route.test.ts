import { beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  user: { id: 'user' } as { id: string } | null,
  workspace: 'workspace' as string | null,
  read: vi.fn(),
  thread: vi.fn(),
  upsert: vi.fn(),
  csrf: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mock.user } }) },
  }),
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ from: () => ({ upsert: mock.upsert }) }),
}));
vi.mock('@/lib/workspaces/resolve', () => ({
  resolveWorkspaceIdForUser: async () => mock.workspace,
}));
vi.mock('@/lib/csrf', () => ({ csrfGuard: mock.csrf }));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'es' }));
vi.mock('@/lib/dashboard/outcomes-query', () => ({
  readOutcomes: mock.read,
  readThread: mock.thread,
}));
import { GET, PATCH } from './route';
const id = '00000000-0000-4000-8000-000000000001';
const last = '00000000-0000-4000-8000-000000000002';
const patch = () =>
  new Request('https://riverz.co/api/analytics/outcomes', {
    method: 'PATCH',
    body: JSON.stringify({
      conversationId: id,
      lastMessageId: last,
      category: 'tracking',
    }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mock.user = { id: 'user' };
  mock.workspace = 'workspace';
  mock.csrf.mockResolvedValue(null);
  mock.thread.mockResolvedValue({ id, lastMessageId: last, state: 'review' });
  mock.upsert.mockResolvedValue({ error: null });
});
it('requires authentication and workspace resolution', async () => {
  mock.user = null;
  expect((await PATCH(patch())).status).toBe(401);
  expect(mock.thread).not.toHaveBeenCalled();
});
it('rejects cross-workspace conversation ids', async () => {
  mock.thread.mockResolvedValue(null);
  expect((await PATCH(patch())).status).toBe(404);
  expect(mock.thread).toHaveBeenCalledWith(expect.anything(), 'workspace', id);
  expect(mock.upsert).not.toHaveBeenCalled();
});
it('rejects a stale message snapshot and human-assisted cases', async () => {
  mock.thread.mockResolvedValue({
    id,
    lastMessageId: 'changed',
    state: 'review',
  });
  expect((await PATCH(patch())).status).toBe(409);
  mock.thread.mockResolvedValue({ id, lastMessageId: last, state: 'human' });
  expect((await PATCH(patch())).status).toBe(409);
  expect(mock.upsert).not.toHaveBeenCalled();
});
it('writes server-resolved workspace and reviewer, never values supplied by the caller', async () => {
  expect((await PATCH(patch())).status).toBe(200);
  expect(mock.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      workspace_id: 'workspace',
      verified_by: 'user',
      last_message_id: last,
      category: 'tracking',
    }),
    expect.anything()
  );
});
it('rejects invalid ranges without querying data', async () => {
  expect(
    (
      await GET(
        new Request(
          'https://riverz.co/api/analytics/outcomes?start=2026-09-20&end=2026-09-01'
        )
      )
    ).status
  ).toBe(400);
  expect(mock.read).not.toHaveBeenCalled();
});
it('preserves CSRF protection', async () => {
  mock.csrf.mockResolvedValue(new Response(null, { status: 403 }));
  expect((await PATCH(patch())).status).toBe(403);
  expect(mock.upsert).not.toHaveBeenCalled();
});
