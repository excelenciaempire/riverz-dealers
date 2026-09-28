import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  user: { id: 'owner' } as { id: string } | null,
  workspace: vi.fn(),
  history: vi.fn(),
  retrieve: vi.fn(),
  available: true,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
  }),
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({}),
}));
vi.mock('@/lib/workspaces/resolve', () => ({
  resolveWorkspaceIdForUser: mocks.workspace,
}));
vi.mock('@/lib/wallet/topup-history', () => ({
  listTopupHistory: mocks.history,
}));
vi.mock('@/lib/billing/stripe', () => ({
  stripeDisponible: () => mocks.available,
  stripe: () => ({ paymentIntents: { retrieve: mocks.retrieve } }),
}));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'en' }));
import { GET } from './route';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: 'owner' };
  mocks.available = true;
  mocks.workspace.mockResolvedValue('my-workspace');
  mocks.history.mockResolvedValue({ filas: [], hayMas: false });
});
it('requires an authenticated user before reading financial history', async () => {
  mocks.user = null;
  expect(
    (await GET(new Request('https://riverz.test/api/wallet/recargas'))).status
  ).toBe(401);
  expect(mocks.history).not.toHaveBeenCalled();
});
it('ignores caller-supplied workspace ids and prevents stale financial responses', async () => {
  const response = await GET(
    new Request(
      'https://riverz.test/api/wallet/recargas?pagina=2&workspace_id=other'
    )
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(mocks.history).toHaveBeenCalledWith(
    {},
    'my-workspace',
    2,
    expect.any(Function)
  );
  const read = mocks.history.mock.calls[0][3];
  await read('pi_existing');
  expect(mocks.retrieve).toHaveBeenCalledWith(
    'pi_existing',
    {},
    { timeout: 5000, maxNetworkRetries: 0 }
  );
});
it('rejects accounts without a workspace', async () => {
  mocks.workspace.mockResolvedValue(null);
  expect(
    (await GET(new Request('https://riverz.test/api/wallet/recargas'))).status
  ).toBe(400);
  expect(mocks.history).not.toHaveBeenCalled();
});
it('localizes failures rather than showing a false empty history', async () => {
  mocks.history.mockRejectedValueOnce(new Error('database failed'));
  const response = await GET(
    new Request('https://riverz.test/api/wallet/recargas')
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: 'Could not load top-up history.',
  });
});
