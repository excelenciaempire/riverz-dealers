import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), resolve: vi.fn(), flags: vi.fn(), admin: vi.fn(), actor: vi.fn(), db: {},
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.auth } }) }));
vi.mock('@/lib/channels/admin-client', () => ({ supabaseAdmin: () => mocks.db }));
vi.mock('@/lib/workspaces/resolve', () => ({ resolveWorkspaceIdForUser: mocks.resolve }));
vi.mock('@/lib/admin/feature-flags', () => ({ getFeatureFlags: mocks.flags }));
vi.mock('@/lib/auth/platform-admin', () => ({ isPlatformAdmin: mocks.admin }));
vi.mock('@/lib/admin/commerce-session', () => ({ getCommerceActor: mocks.actor }));
import { GET } from './route';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ data: { user: { id: 'user-1', email: 'user@example.com' } }, error: null });
  mocks.resolve.mockResolvedValue('workspace-1');
  mocks.flags.mockResolvedValue({ voice: false, comments: true });
  mocks.admin.mockReturnValue(false);
  mocks.actor.mockResolvedValue(null);
});

it('returns only the authenticated workspace settings without caching', async () => {
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(await response.json()).toEqual({ flags: { voice: false, comments: true }, isPlatformAdmin: false });
  expect(mocks.resolve).toHaveBeenCalledWith(mocks.db, 'user-1');
  expect(mocks.flags).toHaveBeenCalledWith(mocks.db, 'workspace-1', { strict: true });
});
it('does not expose settings without authentication', async () => {
  mocks.auth.mockResolvedValue({ data: { user: null }, error: null });
  expect((await GET()).status).toBe(401);
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(mocks.flags).not.toHaveBeenCalled();
});
it('preserves the original platform administrator while viewing a merchant', async () => {
  mocks.actor.mockResolvedValue({ userId: 'original-admin', email: 'juandiegoriosmesa@gmail.com' });
  const response = await GET();
  expect((await response.json()).isPlatformAdmin).toBe(true);
  expect(mocks.resolve).toHaveBeenCalledWith(mocks.db, 'user-1');
});
it('does not fall back to global settings when workspace resolution fails', async () => {
  mocks.resolve.mockResolvedValue(null);
  expect((await GET()).status).toBe(404);
  expect(mocks.flags).not.toHaveBeenCalled();
});
it('returns a failure instead of an all-enabled configuration on a failed read', async () => {
  mocks.flags.mockRejectedValue(new Error('database unavailable'));
  expect((await GET()).status).toBe(503);
});
