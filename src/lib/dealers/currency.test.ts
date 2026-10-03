import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  resolveWorkspaceCurrency,
  resolveWorkspaceCurrencyOrNull,
} from '@/lib/products/currency';
import { dealerInventoryCurrency } from './currency';
beforeEach(() => vi.stubEnv('NEXT_PUBLIC_RIVERZ_VERTICAL', 'dealers'));
afterEach(() => vi.unstubAllEnvs());
function database(rows: { currency: string | null }[]) {
  const q = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    range: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
  q.select.mockReturnValue(q);
  q.eq.mockReturnValue(q);
  q.order.mockReturnValue(q);
  const from = vi.fn(() => q);
  return { q, from, db: { from } as unknown as SupabaseClient };
}
describe('dealer business currency', () => {
  it('uses available vehicles in the current tenant instead of an inherited ecommerce COP default', async () => {
    const f = database([
      { currency: 'USD' },
      { currency: 'usd' },
      { currency: 'EUR' },
      { currency: null },
    ]);
    expect(await resolveWorkspaceCurrency(f.db, 'demo')).toBe('USD');
    expect(f.from.mock.calls).toEqual([['dealer_vehicles']]);
    expect(f.q.eq).toHaveBeenCalledWith('workspace_id', 'demo');
    expect(f.q.eq).toHaveBeenCalledWith('status', 'available');
  });
  it('reads every page instead of silently using a truncated inventory', async () => {
    const f = database([]);
    f.q.range
      .mockResolvedValueOnce({
        data: Array.from({ length: 1000 }, () => ({ currency: 'EUR' })),
        error: null,
      })
      .mockResolvedValueOnce({
        data: Array.from({ length: 1000 }, () => ({ currency: 'USD' })),
        error: null,
      })
      .mockResolvedValueOnce({ data: [{ currency: 'USD' }], error: null });
    expect(await dealerInventoryCurrency(f.db, 'demo')).toBe('USD');
    expect(f.q.range.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });
  it('preserves absence of currency evidence and provides USD only as the dealer setup default', async () => {
    const f = database([]);
    expect(await resolveWorkspaceCurrencyOrNull(f.db, 'empty')).toBeNull();
    expect(await resolveWorkspaceCurrency(f.db, 'empty')).toBe('USD');
    f.q.range.mockResolvedValue({ data: null, error: { message: 'offline' } });
    expect(await dealerInventoryCurrency(f.db, 'empty')).toBeNull();
  });
});
