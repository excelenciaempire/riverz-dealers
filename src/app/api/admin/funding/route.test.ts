import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  gate: vi.fn(),
  csrf: vi.fn(),
  rpc: vi.fn(),
  upsert: vi.fn(),
  audit: vi.fn(),
  providers: vi.fn(),
  rate: vi.fn(),
}));
vi.mock('@/lib/admin/guard', () => ({ requireAdmin: mocks.gate }));
vi.mock('@/lib/csrf', () => ({ csrfGuard: mocks.csrf }));
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: mocks.audit }));
vi.mock('@/lib/admin/route', () => ({
  adminGet: async (
    _req: Request,
    _audit: unknown,
    handler: () => Promise<unknown>
  ) => {
    const gate = await mocks.gate();
    if (!gate.ok) return gate.res;
    return Response.json(await handler());
  },
}));
vi.mock('@/lib/channels/admin-client', () => ({
  supabaseAdmin: () => ({
    rpc: mocks.rpc,
    from: () => ({ upsert: mocks.upsert }),
  }),
}));
vi.mock('@/lib/admin/proveedores', () => ({
  claveParaSaldo: async () => 'test-key',
  leerSaldosParaRecarga: mocks.providers,
}));
vi.mock('@/lib/i18n/server', () => ({
  getT: async () => (key: string) => key,
}));
vi.mock('@/lib/rate-limit', () => ({
  limitByKey: mocks.rate,
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));
import { GET, PUT } from './route';
const request = (body: unknown) =>
  new Request('https://admin.riverz.co/api/admin/funding', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.gate.mockResolvedValue({
    ok: true,
    actor: { email: 'admin@example.test', userId: '1' },
  });
  mocks.csrf.mockResolvedValue(null);
  mocks.rate.mockResolvedValue({ success: true });
  mocks.upsert.mockResolvedValue({ error: null });
});
it('denies an unopened admin before reading or writing balances', async () => {
  mocks.gate.mockResolvedValue({
    ok: false,
    res: new Response(null, { status: 403 }),
  });
  expect(
    (await GET(new Request('https://admin.riverz.co/api/admin/funding'))).status
  ).toBe(403);
  expect(
    (await PUT(request({ provider: 'anthropic', balanceUsd: 10 }))).status
  ).toBe(403);
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.upsert).not.toHaveBeenCalled();
});
it('blocks writes without CSRF', async () => {
  mocks.csrf.mockResolvedValue(new Response(null, { status: 403 }));
  expect(
    (await PUT(request({ provider: 'anthropic', balanceUsd: 10 }))).status
  ).toBe(403);
  expect(mocks.upsert).not.toHaveBeenCalled();
});
it('rejects invalid amounts, missing amounts and providers with API balances', async () => {
  for (const body of [
    { provider: 'anthropic', balanceUsd: -1 },
    { provider: 'anthropic', balanceUsd: '10' },
    { provider: 'anthropic' },
    { provider: 'telnyx', balanceUsd: 10 },
  ]) {
    expect((await PUT(request(body))).status).toBe(400);
  }
  expect(mocks.upsert).not.toHaveBeenCalled();
});
it('records a confirmed balance separately from merchant wallets and audits it', async () => {
  expect(
    (await PUT(request({ provider: 'anthropic', balanceUsd: 0 }))).status
  ).toBe(200);
  expect(mocks.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: 'anthropic',
      balance_usd: 0,
      updated_by: 'admin@example.test',
    }),
    { onConflict: 'provider' }
  );
  expect(mocks.audit).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    expect.objectContaining({ action: 'update.provider_balance' })
  );
});
it('does not report a failed balance write as successful', async () => {
  mocks.upsert.mockResolvedValue({ error: { message: 'private SQL details' } });
  const response = await PUT(
    request({ provider: 'anthropic', balanceUsd: 10 })
  );
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('private SQL');
});
it('keeps wallet totals visible when provider reads fail', async () => {
  mocks.rpc.mockResolvedValue({
    data: {
      wallets: [],
      usage: [],
      manual: [],
      measured_at: new Date().toISOString(),
    },
    error: null,
  });
  mocks.providers.mockRejectedValue(new Error('timeout'));
  const response = await GET(
    new Request('https://admin.riverz.co/api/admin/funding')
  );
  expect(await response.json()).toMatchObject({
    wallets: [],
    providersError: true,
    providersCheckedAt: null,
  });
});
