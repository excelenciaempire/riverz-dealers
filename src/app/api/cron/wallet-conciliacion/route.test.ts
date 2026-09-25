import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  retrieve: vi.fn(), credit: vi.fn(), update: vi.fn(), attempts: [] as { id: string; payment_intent_id: string }[],
  pending: [] as Record<string, unknown>[], excluded: [] as unknown[][],
}));
vi.mock('@/lib/auth/cron', () => ({ assertCronAuth: () => undefined }));
vi.mock('@/lib/cron/heartbeat', () => ({ withCronRun: (_name: string, handler: unknown) => handler }));
vi.mock('@/lib/billing/stripe', () => ({ stripeDisponible: () => true, stripe: () => ({ paymentIntents: { retrieve: mocks.retrieve } }) }));
vi.mock('@/lib/wallet/recarga', () => ({ acreditarDesdeEvento: mocks.credit }));
vi.mock('@/lib/channels/admin-client', () => ({
  supabaseAdmin: () => ({ from: (table: string) => {
    const chain = {
      select: () => chain, eq: () => chain, lt: () => chain, order: () => chain, not: () => chain,
      neq: (...args: unknown[]) => { mocks.excluded.push(args); return chain; },
      limit: async () => ({ data: table === 'wallet_operaciones' ? mocks.pending : mocks.attempts, error: null }),
      update: (values: unknown) => ({ eq: (_key: string, id: string) => mocks.update(id, values) }),
    };
    return chain;
  } }),
}));
import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pending = [];
  mocks.excluded = [];
  mocks.attempts = [ { id: 'first', payment_intent_id: 'pi_first' }, { id: 'second', payment_intent_id: 'pi_second' } ];
  mocks.retrieve.mockImplementation(async (id: string) => ({ id, status: 'succeeded' }));
  mocks.credit.mockResolvedValue(undefined);
  mocks.update.mockResolvedValue({ error: null });
});

it.each(['provider', 'credit', 'persistence'])('continues other merchants after a %s failure and reports partial health', async failure => {
  if (failure === 'provider') mocks.retrieve.mockRejectedValueOnce(new Error('provider unavailable'));
  if (failure === 'credit') mocks.credit.mockRejectedValueOnce(new Error('ledger unavailable'));
  if (failure === 'persistence') mocks.update.mockResolvedValueOnce({ error: { message: 'database unavailable' } });
  const response = await GET(new Request('https://riverz.test/api/cron/wallet-conciliacion'));
  expect(response.status).toBe(207);
  expect(await response.json()).toMatchObject({ ok: false, recovered: 1, paymentFailures: ['first'] });
  expect(mocks.retrieve).toHaveBeenCalledWith('pi_second');
  expect(mocks.update).toHaveBeenCalledWith('second', { estado: 'completada' });
});

it('never credits a payment still in progress', async () => {
  mocks.retrieve.mockResolvedValue({ status: 'processing' });
  const response = await GET(new Request('https://riverz.test/api/cron/wallet-conciliacion'));
  expect(response.status).toBe(200);
  expect(mocks.credit).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
});

it('keeps uncertain old usage reserved while recovering unrelated successful payments', async () => {
  mocks.pending = [{ id: 'unknown-run', proveedor: 'apify', detalle: {} }];
  const response = await GET(new Request('https://riverz.test/api/cron/wallet-conciliacion'));
  expect(response.status).toBe(207);
  expect(await response.json()).toMatchObject({ recovered: 2, pending: [{ id: 'unknown-run' }] });
});

it('leaves phone number holds to their own reconciler', async () => {
  await GET(new Request('https://riverz.test/api/cron/wallet-conciliacion'));
  expect(mocks.excluded).toContainEqual(['concepto', 'numero_telefono']);
});
