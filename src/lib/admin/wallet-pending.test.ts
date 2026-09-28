import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rows: vi.fn() }));
vi.mock('@/lib/db/paginate', () => ({ selectAll: mocks.rows }));
import { getPendingWalletReconciliation } from './wallet-pending';
beforeEach(() => vi.clearAllMocks());
it('counts every pending reservation and its exact cents without reading receipt details', async () => {
  mocks.rows.mockResolvedValue(Array.from({ length: 1005 }, (_, i) => ({ id: String(i), reserva_centavos: 1, created_at: '2026-09-27' })));
  expect(await getPendingWalletReconciliation({} as never)).toEqual({ pending: 1005, reservedCents: 1005 });
  expect(mocks.rows.mock.calls[0][3]).toMatchObject({ select: 'id,reserva_centavos,created_at', strict: true });
});
it('does not report zero reservations when their ledger cannot be read', async () => {
  mocks.rows.mockRejectedValue(new Error('ledger unavailable'));
  await expect(getPendingWalletReconciliation({} as never)).rejects.toThrow('ledger unavailable');
});
