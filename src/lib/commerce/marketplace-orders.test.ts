import { expect, it } from 'vitest';
import { pedidosDeMercadoLibre } from './recent-orders';
import { esVentaReal } from '@/lib/attribution/lentes';
function db(rows: unknown[], error: unknown = null) {
  const q = {
    select: () => q,
    eq: () => q,
    gte: () => q,
    order: () => q,
    range: async (a: number, b: number) => ({
      data: rows.slice(a, b + 1),
      error,
    }),
  };
  return { from: () => q } as never;
}
it('keeps paid marketplace sales after shipment and pages past the API cap', async () => {
  const rows = Array.from({ length: 1201 }, (_, i) => ({
    shopify_order_id: String(i + 1),
    status: 'shipped',
    financial_status: 'paid',
    created_at: '2026-09-27T12:00:00Z',
  }));
  rows[0] = { ...rows[0], financial_status: 'refunded' };
  const r = await pedidosDeMercadoLibre(db(rows), 'w', '2026-09-27T00:00:00Z');
  expect(r).toHaveLength(1201);
  expect(r.filter(esVentaReal)).toHaveLength(1200);
});
it('never reports no marketplace sales when the query failed', async () => {
  await expect(
    pedidosDeMercadoLibre(db([], { message: 'unavailable' }), 'w', 'now')
  ).rejects.toEqual({ message: 'unavailable' });
});
