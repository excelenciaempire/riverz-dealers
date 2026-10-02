import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dealerQuoteEvidence, verifiedDealerPrices } from './quote-evidence';
const id = '10000000-0000-4000-8000-000000000001';
const evidence = [{ id, price: 20000, currency: 'USD' }];
describe('dealer price evidence', () => {
  it('accepts only successful server inventory results', () => {
    const result = JSON.stringify({ ok: true, vehicles: evidence });
    expect(dealerQuoteEvidence('dealer_search_vehicles', result)).toEqual(
      evidence
    );
    expect(dealerQuoteEvidence('dealer_save_buyer', result)).toEqual([]);
    expect(dealerQuoteEvidence('dealer_search_vehicles', '{}')).toEqual([]);
    expect(dealerQuoteEvidence('dealer_search_vehicles', 'invalid')).toEqual(
      []
    );
  });
  it('rechecks fixed tenant, availability, price and currency before delivery', async () => {
    const q = { select: vi.fn(), eq: vi.fn(), in: vi.fn() };
    q.select.mockReturnValue(q);
    q.eq.mockReturnValue(q);
    q.in.mockResolvedValue({
      data: [
        ...evidence,
        { ...evidence[0], price: 25000 },
        { ...evidence[0], currency: 'EUR' },
      ],
      error: null,
    });
    const db = { from: vi.fn(() => q) } as unknown as SupabaseClient;
    expect(await verifiedDealerPrices(db, 'fixed', evidence)).toEqual([20000]);
    expect(q.eq).toHaveBeenCalledWith('workspace_id', 'fixed');
    expect(q.eq).toHaveBeenCalledWith('status', 'available');
    q.in.mockResolvedValue({ data: [], error: null });
    expect(await verifiedDealerPrices(db, 'fixed', evidence)).toEqual([]);
    q.in.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
    await expect(verifiedDealerPrices(db, 'fixed', evidence)).rejects.toThrow(
      'price_integrity'
    );
  });
});
