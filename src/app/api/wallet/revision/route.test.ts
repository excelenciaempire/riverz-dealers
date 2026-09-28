import { beforeEach, expect, it, vi } from 'vitest';
import { GET } from './route';

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  resolve: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  read: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.user } }),
}));
vi.mock('@/lib/workspaces/resolve', () => ({
  resolveWorkspaceIdForUser: mocks.resolve,
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ from: mocks.from }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ data: { user: { id: 'owner' } } });
  mocks.resolve.mockResolvedValue('merchant');
  const query = { select: mocks.select, eq: mocks.eq, maybeSingle: mocks.read };
  mocks.from.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.read.mockResolvedValue({
    data: { updated_at: '2026-09-28T12:00:00Z' },
    error: null,
  });
});
it('reads only the revision of the authenticated merchant without caching', async () => {
  const result = await GET();
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ revision: '2026-09-28T12:00:00Z' });
  expect(mocks.eq).toHaveBeenCalledWith('workspace_id', 'merchant');
  expect(mocks.select).toHaveBeenCalledWith('updated_at');
  expect(result.headers.get('Cache-Control')).toBe('no-store');
});
it('does not read wallet data without authentication', async () => {
  mocks.user.mockResolvedValue({ data: { user: null } });
  expect((await GET()).status).toBe(401);
  expect(mocks.from).not.toHaveBeenCalled();
});
it('does not report a successful revision when the database read fails', async () => {
  mocks.read.mockResolvedValue({ data: null, error: new Error('unavailable') });
  expect((await GET()).status).toBe(503);
});
