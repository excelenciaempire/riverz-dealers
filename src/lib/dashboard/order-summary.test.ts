import { describe, expect, it } from 'vitest';
import { summarizeOrders, type SummaryOrder } from './order-summary';

const paid = (amount: number | string | null = '10.00', currency: string | null = 'USD'): SummaryOrder => ({
  total_price: amount, currency, financial_status: 'paid', status: 'created',
});
describe('stored paid-order totals', () => {
  it('keeps currencies separate and refuses a mixed scalar', () => {
    expect(summarizeOrders([paid('10.10'), paid('0.20'), paid('45000', 'COP')])).toMatchObject({
      cantidad: 3, pagados: 3, facturado: null, moneda: null,
      por_moneda: [{ moneda: 'COP', importe: '45000.00', cantidad: 1 }, { moneda: 'USD', importe: '10.30', cantidad: 2 }],
    });
  });
  it.each(['pending', 'authorized', 'partially_paid', 'partially_refunded', 'refunded', null])('excludes financial status %s', financial_status => {
    expect(summarizeOrders([{ ...paid(), financial_status }])).toMatchObject({ pagados: 0, excluidos: 1, facturado: null, por_moneda: [] });
  });
  it.each(['cancelled', 'failed', 'returned', 'unknown', null])('does not count paid status with order state %s', status => {
    expect(summarizeOrders([{ ...paid(), status }])).toMatchObject({ pagados: 0, excluidos: 1 });
  });
  it('distinguishes absent data from an observed zero', () => {
    expect(summarizeOrders([]).facturado).toBeNull();
    expect(summarizeOrders([paid('0')])).toMatchObject({ facturado: 0, moneda: 'USD', por_moneda: [{ importe: '0.00', cantidad: 1, moneda: 'USD' }] });
  });
  it('preserves three and six decimal amounts without rounding to cents', () => {
    expect(summarizeOrders([paid('1.001', 'KWD'), paid('0.000001', 'KWD')])).toMatchObject({
      facturado: 1.001001, por_moneda: [{ moneda: 'KWD', importe: '1.001001', cantidad: 2 }],
    });
  });
  it.each([null, '-1', '10abc', 'NaN', '1e3', '0.0000001', Infinity, 9_000_000_000_000])('marks unavailable amounts instead of substituting zero: %s', amount => {
    expect(summarizeOrders([paid(amount)])).toMatchObject({ pagados: 1, importes_no_disponibles: 1, facturado: null });
  });
  it.each([null, '', 'US', 'USDT', '123', 'ZZZ', 'XXX'])('does not label an unknown currency as USD: %s', currency => {
    expect(summarizeOrders([paid('10', currency)])).toMatchObject({ importes_no_disponibles: 1, moneda: null, facturado: null });
  });
  it('does not publish a partial scalar when a paid order has missing evidence', () => {
    expect(summarizeOrders([paid('10'), paid(null)])).toMatchObject({ pagados: 2, importes_no_disponibles: 1, facturado: null, por_moneda: [{ importe: '10.00', cantidad: 1, moneda: 'USD' }] });
  });
  it('keeps large stored strings exact even when the legacy scalar is unsafe', () => {
    const summary = summarizeOrders([paid('99999999999999.999999'), paid('0.000001')]);
    expect(summary.por_moneda[0].importe).toBe('100000000000000.00');
    expect(summary.facturado).toBeNull();
  });
});
