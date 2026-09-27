import { describe, expect, it } from 'vitest';
import { allocateFinancialReceipt, type FinancialReceipt, type FundingShare } from './financial-allocation';

const activated = '2026-09-28T00:00:00Z';
const receipt: FinancialReceipt = { id: 'payout-fee', kind: 'instant_payout', currency: 'usd', createdAt: activated, feeCents: 50, basisCents: 2310 };
const share = (id: string, basisCents: number, collectedCents = 0): FundingShare => ({ id, workspaceId: `ws-${id}`, basisCents, collectedCents, exempt: false });

describe('receipt-backed financial allocations', () => {
  it('uses the actual 50-cent minimum once for the entire payout', () => {
    const result = allocateFinancialReceipt(receipt, [share('a', 1155), share('b', 1155)], activated);
    expect(result.allocations.map(a => a.outstandingCents)).toEqual([25, 25]);
    expect(result.riverzCents).toBe(0);
  });
  it('does not recover fees already deducted from the merchant', () => {
    const result = allocateFinancialReceipt({ ...receipt, kind: 'processing', feeCents: 140, basisCents: 2500 }, [share('payment', 2500, 140)], activated);
    expect(result.allocations[0].outstandingCents).toBe(0);
  });
  it('recovers only the unpaid portion of a receipt', () => {
    expect(allocateFinancialReceipt(receipt, [share('a', 2310, 30)], activated).allocations[0].outstandingCents).toBe(20);
  });
  it('leaves exempt and unattributed funds with Riverz', () => {
    const result = allocateFinancialReceipt({ ...receipt, basisCents: 1000 }, [share('a', 200), { ...share('b', 300), exempt: true }], activated);
    expect(result.allocations[0].outstandingCents).toBe(10);
    expect(result.riverzCents).toBe(40);
  });
  it('does not recover historical fees even when imported after activation', () => {
    expect(allocateFinancialReceipt({ ...receipt, createdAt: '2026-09-27T17:15:00Z' }, [share('a', 2310)], activated)).toEqual({ allocations: [], riverzCents: 50 });
  });
  it('makes rounding deterministic regardless of input ordering', () => {
    const parts = [share('a', 770), share('b', 770), share('c', 770)];
    const first = allocateFinancialReceipt(receipt, parts, activated);
    expect(first).toEqual(allocateFinancialReceipt(receipt, [...parts].reverse(), activated));
    expect(first.allocations.map(a => a.allocatedCents)).toEqual([17, 17, 16]);
  });
  it('does not guess a fee for missing attribution', () => {
    expect(allocateFinancialReceipt(receipt, [], activated)).toEqual({ allocations: [], riverzCents: 50 });
  });
  it('rejects duplicated, excessive, fractional and negative funding', () => {
    for (const parts of [[share('a', 100), share('a', 100)], [share('a', 2311)], [share('a', -1)], [share('a', 0.1)]]) {
      expect(() => allocateFinancialReceipt(receipt, parts, activated)).toThrow();
    }
  });
  it('rejects an unverified currency or date', () => {
    expect(() => allocateFinancialReceipt({ ...receipt, currency: 'eur' } as FinancialReceipt, [], activated)).toThrow();
    expect(() => allocateFinancialReceipt(receipt, [], 'invalid')).toThrow();
  });
  it('preserves exact integer amounts without floating-point multiplication', () => {
    const result = allocateFinancialReceipt({ ...receipt, feeCents: 9999999, basisCents: 9999999999 }, [share('a', 9999999999)], activated);
    expect(result.allocations[0].outstandingCents).toBe(9999999);
  });
});
