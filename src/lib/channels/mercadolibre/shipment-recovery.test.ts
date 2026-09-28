import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ChannelConnection } from '@/types';
const mocks = vi.hoisted(() => ({ connections: vi.fn(), token: vi.fn(), database: vi.fn() }));
vi.mock('../connections', () => ({ listConnections: mocks.connections }));
vi.mock('../admin-client', () => ({ supabaseAdmin: mocks.database }));
vi.mock('./adapter', () => ({ getFreshMLToken: mocks.token }));
import { reconcileCapturedShipments, reconcileShipmentMirror } from './shipment-recovery';

const connection = { id: 'c', workspace_id: 'w', config: { seller_id: '42' }, status: 'connected' } as unknown as ChannelConnection;
const mirror = { id: 'o', updated_at: '2026-09-27', order_status_url: 'https://sale.test/900',
  shipping_status: 'shipped', tracking_number: 'tracking', tracking_company: 'carrier',
  tracking_url: 'https://sale.test/900', fulfillment_status: null, status: 'paid' };
const event = { id: 'e', raw_body: JSON.stringify({ topic: 'shipments', resource: '/shipments/123', user_id: 42 }),
  received_at: '2026-09-26', last_error: 'connection missing refresh_token' };

function database(row: object | null = mirror, updated = true) {
  const filters: Array<[string, unknown]> = [];
  const writes: Array<{ table: string; patch: Record<string, unknown> }> = [];
  const db = { from: (table: string) => {
    let mutation = false;
    const q = {
      select: () => q, order: () => q, limit: () => q,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
      is: (key: string, value: unknown) => { filters.push([key, value]); return q; },
      update: (patch: Record<string, unknown>) => { mutation = true; writes.push({ table, patch }); return q; },
      maybeSingle: async () => ({ data: row, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: mutation ? updated ? [{ id: table === 'orders' ? 'o' : 'e' }] : []
        : table === 'webhook_events_raw' ? [event] : [], error: null }).then(resolve),
    };
    return q;
  } };
  return { db, filters, writes };
}

function provider(options: { seller?: number; shipping?: number; code?: number } = {}) {
  const fetcher = vi.fn<typeof fetch>(async input => {
    const path = new URL(String(input)).pathname;
    if (options.code) return new Response('', { status: options.code });
    if (path === '/shipments/123') return Response.json({ id: 123, sender_id: options.seller ?? 42, status: 'delivered', tracking_number: 'tracking', tracking_method: 'carrier' });
    if (path === '/shipments/123/items') return Response.json([{ order_id: 900 }, { order_id: 900 }]);
    if (path === '/orders/900') return Response.json({ id: 900, seller: { id: 42 }, shipping: { id: options.shipping ?? 123 }, status: 'paid' });
    throw new Error('unexpected URL');
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

beforeEach(() => { vi.clearAllMocks(); mocks.connections.mockResolvedValue([connection]); mocks.token.mockResolvedValue('token'); });
afterEach(() => vi.unstubAllGlobals());

it('previews verified delivery differences without writing orders or receipts', async () => {
  const { db, writes, filters } = database(); provider();
  const result = await reconcileShipmentMirror(db as never, connection, '123', 'token', false);
  expect(result).toMatchObject({ orders: 1, changedFields: ['shipping_status', 'fulfillment_status', 'status'] });
  expect(writes).toEqual([]);
  expect(filters).toContainEqual(['workspace_id', 'w']);
  expect(filters).toContainEqual(['shop_domain', 'mercadolibre:42']);
  expect(filters).toContainEqual(['shopify_order_id', '900']);
});

it('updates delivery fields only, using an optimistic concurrency guard', async () => {
  const { db, writes, filters } = database(); const fetcher = provider();
  await reconcileShipmentMirror(db as never, connection, '123', 'token', true);
  expect(writes).toHaveLength(1);
  expect(writes[0].patch).toMatchObject({ shipping_status: 'delivered', fulfillment_status: 'fulfilled', status: 'fulfilled' });
  for (const key of ['total_price', 'financial_status', 'contact_id', 'line_items']) expect(writes[0].patch).not.toHaveProperty(key);
  expect(filters).toContainEqual(['updated_at', mirror.updated_at]);
  expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});

it.each([{ seller: 77 }, { shipping: 999 }])('rejects provider scope mismatch %j', async options => {
  const { db, writes } = database(); provider(options);
  await expect(reconcileShipmentMirror(db as never, connection, '123', 'token', true)).rejects.toThrow('mismatch');
  expect(writes).toEqual([]);
});

it('does not close a receipt when the order mirror is missing', async () => {
  const { db, writes } = database(null); mocks.database.mockReturnValue(db); provider();
  const result = await reconcileCapturedShipments({ apply: true });
  expect(result.recovered).toBe(0);
  expect(result.results[0]).toMatchObject({ state: 'pending', reason: 'shipment_order_mirror_missing' });
  expect(writes).toEqual([]);
});

it('keeps the capture pending if a concurrent sync changed the order', async () => {
  const { db, writes } = database(mirror, false); mocks.database.mockReturnValue(db); provider();
  const result = await reconcileCapturedShipments({ apply: true });
  expect(result.results[0].state).toBe('pending');
  expect(writes.every(w => w.table !== 'webhook_events_raw')).toBe(true);
});

it('records closure evidence only after verification, preserving the original failure', async () => {
  const { db, writes } = database(); mocks.database.mockReturnValue(db); provider();
  const result = await reconcileCapturedShipments({ apply: true });
  expect(result.recovered).toBe(1);
  expect(writes[1]).toMatchObject({ table: 'webhook_events_raw', patch: { last_error: expect.stringContaining(event.last_error) } });
  expect(writes[1].patch).not.toHaveProperty('raw_body');
});

it('keeps rate-limited captures unresolved', async () => {
  const { db, writes } = database(); mocks.database.mockReturnValue(db); provider({ code: 429 });
  const result = await reconcileCapturedShipments({ apply: true });
  expect(result.recovered).toBe(0); expect(result.results[0].state).toBe('pending'); expect(writes).toEqual([]);
});

it('never fetches an arbitrary captured URL', async () => {
  const { db } = database(); const fetcher = provider();
  await expect(reconcileShipmentMirror(db as never, connection, 'https://untrusted.test', 'token', true)).rejects.toThrow('invalid');
  expect(fetcher).not.toHaveBeenCalled();
});
