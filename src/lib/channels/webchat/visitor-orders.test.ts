import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadVisitorOrders } from './visitor-orders';
import { parseVisitorOrderCursor, parseVisitorOrderQuery, widgetOrderRequest } from './order-contract';

const ws = '11111111-1111-4111-8111-111111111111';
const contact = '22222222-2222-4222-8222-222222222222';
const session = { workspaceId: ws, visitorId: 'visitor', origin: 'shop.example', exp: Date.now() + 10000 };
const order = (n: number, patch = {}) => ({ id: `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`, workspace_id: ws, contact_id: contact, order_number: `#${n}`, created_at: '2026-10-01T12:00:00.123456Z', ...patch });
function database(rows: ReturnType<typeof order>[] = [], options?: { error?: string; noContact?: boolean }) {
  const contacts = [
    { id: contact, workspace_id: ws, channel: 'webchat', external_id: 'visitor', email: 'claimed@example.com' },
    { id: '44444444-4444-4444-8444-444444444444', workspace_id: ws, channel: 'whatsapp', external_id: 'other', email: 'claimed@example.com' },
    { id: '55555555-5555-4555-8555-555555555555', workspace_id: 'foreign', channel: 'webchat', external_id: 'visitor' },
  ];
  const calls: Array<[string, string, unknown[]]> = [];
  const from = vi.fn((table: string) => {
    let values: Record<string, unknown>[] = table === 'contacts' ? options?.noContact ? [] : contacts : [...rows];
    let amount = 0;
    const q = {
      select: (fields: string) => { calls.push([table, 'select', [fields]]); return q; },
      eq: (key: string, value: unknown) => { calls.push([table, 'eq', [key, value]]); values = values.filter(row => row[key] === value); return q; },
      not: (key: string) => { values = values.filter(row => row[key] != null); return q; },
      order: () => { values.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')) || String(b.id).localeCompare(String(a.id))); return q; },
      limit: (n: number) => { amount = n; return q; },
      or: (filter: string) => {
        calls.push([table, 'or', [filter]]);
        const match = /created_at\.lt\.(.+),and\(created_at\.eq\.(.+),id\.lt\.([^)]*)\)/.exec(filter)!;
        values = values.filter(row => String(row.created_at) < match[1] || (row.created_at === match[2] && String(row.id) < match[3])); return q;
      },
      maybeSingle: async () => ({ data: values[0] ?? null, error: options?.error === table ? { message: 'private database detail' } : null }),
      then: (resolve: (value: unknown) => unknown) => resolve({ data: values.slice(0, amount), error: options?.error === table ? { message: 'private database detail' } : null }),
    };
    return q;
  });
  return { db: { from } as unknown as SupabaseClient, from, calls };
}

describe('signed visitor order isolation and pagination', () => {
  it('includes only orders for this visitor’s exact contact and business, without personal/provider data', async () => {
    const f = database([order(1, { customer_email: 'private@example.com', shipping_address: { address1: 'private' } }), order(2, { workspace_id: 'foreign' }), order(3, { contact_id: '44444444-4444-4444-8444-444444444444' }), order(4, { order_number: null })]);
    const result = await loadVisitorOrders(f.db, session);
    expect(result.orders.map(row => row.reference)).toEqual(['#1']);
    expect(Object.keys(result.orders[0])).toEqual(['id', 'reference', 'created_at']);
    expect(JSON.stringify(result)).not.toContain('private');
    expect(f.calls.filter(call => call[1] === 'eq')).toEqual([
      ['contacts', 'eq', ['workspace_id', ws]], ['contacts', 'eq', ['channel', 'webchat']], ['contacts', 'eq', ['external_id', 'visitor']],
      ['orders', 'eq', ['workspace_id', ws]], ['orders', 'eq', ['contact_id', contact]],
    ]);
  });
  it('does not create a contact or infer one from a claimed email when the visitor has none', async () => {
    const f = database([order(1)], { noContact: true });
    expect(await loadVisitorOrders(f.db, session)).toEqual({ orders: [], next_cursor: null });
    expect(f.from).toHaveBeenCalledTimes(1);
  });
  it.each(['contacts', 'orders'])('reports a failed %s read instead of an empty list', async error => {
    await expect(loadVisitorOrders(database([order(1)], { error }).db, session)).rejects.toThrow('visitor_order_unavailable');
  });
  it('returns older pages without losing same-time orders or Postgres microseconds', async () => {
    const f = database(Array.from({ length: 43 }, (_, i) => order(i + 1)));
    const first = await loadVisitorOrders(f.db, session);
    const second = await loadVisitorOrders(f.db, session, first.next_cursor!);
    const third = await loadVisitorOrders(f.db, session, second.next_cursor!);
    expect([first.orders.length, second.orders.length, third.orders.length]).toEqual([20, 20, 3]);
    expect(new Set([...first.orders, ...second.orders, ...third.orders].map(row => row.id)).size).toBe(43);
    expect(first.next_cursor).toContain('.123456Z');
    expect(third.next_cursor).toBeNull();
  });
  it('rejects malformed returned rows', async () => {
    await expect(loadVisitorOrders(database([order(1, { id: 'invalid' })]).db, session)).rejects.toThrow('visitor_order_unavailable');
  });
});

describe('visitor order request contracts', () => {
  it.each([
    { workspaceId: ws }, { contact_id: contact }, { order_number: '#1' }, { locale: 'fr' }, { cursor: '' },
    { cursor: JSON.stringify({ id: order(1).id, created_at: '2026-10-01T12:00:00Z),workspace_id.neq.any' }) },
    { cursor: JSON.stringify({ id: 'injected)', created_at: order(1).created_at }) },
    { cursor: JSON.stringify({ id: order(1).id, created_at: order(1).created_at, workspace_id: ws }) },
  ])('rejects caller-controlled scope or unsafe cursors: %j', raw => {
    expect(() => parseVisitorOrderQuery(raw)).toThrow('visitor_order_invalid');
  });
  it('accepts the validated cursor without normalizing away microseconds', () => {
    const value = { id: order(1).id, created_at: order(1).created_at };
    expect(parseVisitorOrderCursor(JSON.stringify(value))).toEqual(value);
    expect(parseVisitorOrderQuery({ locale: 'en' })).toEqual({ locale: 'en' });
  });
  it.each(['es', 'en'] as const)('builds bounded requests in %s, without claiming execution', locale => {
    const item = { id: order(1).id, reference: '#1', created_at: order(1).created_at };
    for (const action of ['confirm', 'address', 'variant', 'cancel'] as const) {
      const text = widgetOrderRequest(locale, item, action, 'Street 123');
      expect(text).toContain('"#1"'); expect(text).not.toContain('webchat.');
      expect(text).toMatch(locale === 'en' ? /I (want|request)/ : /Quiero|Solicito/);
      expect(text!.length).toBeLessThan(4000);
    }
    expect(widgetOrderRequest(locale, item, 'cancel', '   ')).toBeNull();
    expect(widgetOrderRequest(locale, item, 'address', 'x'.repeat(601))).toBeNull();
    expect(widgetOrderRequest(locale, item, 'variant', 'Size "L"\nBlue')).toContain('"Size \\"L\\"\\nBlue"');
  });
});
