import { expect, it } from 'vitest';
import { esVentaReal } from './lentes';

it('counts paid sales, never pending, missing, authorized, cancelled or refunded amounts', () => {
  const base = { id: 1, created_at: '2026-09-01T00:00:00Z' };
  expect(esVentaReal({ ...base, financial_status: 'paid' })).toBe(true);
  for (const financial_status of [
    undefined,
    null,
    'pending',
    'authorized',
    'partially_paid',
    'refunded',
    'partially_refunded',
    'voided',
  ]) {
    expect(esVentaReal({ ...base, financial_status })).toBe(false);
  }
  expect(
    esVentaReal({
      ...base,
      financial_status: 'paid',
      cancelled_at: base.created_at,
    })
  ).toBe(false);
});
