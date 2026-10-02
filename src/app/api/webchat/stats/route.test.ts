import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/lib/i18n/config';
import { translate } from '@/lib/i18n/translate';
const h = vi.hoisted(() => ({
  user: '00000000-0000-4000-8000-000000000001' as string | null,
  workspace: '00000000-0000-4000-8000-000000000002' as string | null,
  locale: 'es' as Locale,
  visible: ['00000000-0000-4000-8000-000000000003'], scopeCalls: 0, revoked: false, denied: false,
  fail: '' as string, calls: [] as Array<{ table: string; select: string; ids?: string[]; filters: Array<[string, string, unknown]>; range?: [number, number] }>,
  data: {} as Record<string, Array<Record<string, unknown>>>,
  outcomes: vi.fn(),
}));
function db() {
  return {
    rpc: async () => {
      h.scopeCalls++;
      return h.denied ? { error: { message: 'dashboard_forbidden' }, data: null } : { error: null, data: h.revoked && h.scopeCalls > 1 ? [] : h.visible };
    },
    from(table: string) {
      const call: typeof h.calls[number] = { table, select: '', filters: [] };h.calls.push(call);
      const query = {
        select: (fields: string) => { call.select = fields;return query; },
        eq: (key: string, value: unknown) => { call.filters.push(['eq', key, value]);return query; },
        is: (key: string, value: unknown) => { call.filters.push(['is', key, value]);return query; },
        in: (key: string, ids: string[]) => { call.ids = ids;call.filters.push(['in', key, ids]);return query; },
        order: () => query,
        gte: (key: string, value: string) => { call.filters.push(['gte', key, value]);return query; },
        lt: (key: string, value: string) => { call.filters.push(['lt', key, value]);return query; },
        range: (from: number, to: number) => { call.range = [from, to];return query; },
        then: (resolve: (result: unknown) => unknown) => {
          const rows = (h.data[table] ?? []).filter(row => call.filters.every(([op, key, value]) => {
            if (op === 'in') return (value as unknown[]).includes(row[key]);
            if (op === 'gte') return Date.parse(String(row[key])) >= Date.parse(String(value));
            if (op === 'lt') return Date.parse(String(row[key])) < Date.parse(String(value));
            return row[key] === value;
          }));
          return Promise.resolve({ data: h.fail === table ? null : rows.slice(call.range?.[0] ?? 0, (call.range?.[1] ?? 999) + 1), error: null }).then(resolve);
        },
      };return query;
    },
  };
}
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user ? { id: h.user } : null } }) } }) }));
vi.mock('@/lib/channels/admin-client', () => ({ supabaseAdmin: () => db() }));
vi.mock('@/lib/workspaces/resolve', () => ({ resolveWorkspaceIdForUser: async () => h.workspace }));
vi.mock('@/lib/dashboard/outcomes-query', () => ({ readOutcomes: (...args: unknown[]) => h.outcomes(...args) }));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => h.locale }));
import { GET } from './route';

const now = '2026-10-01T00:00:00Z';
function order(patch: Record<string, unknown> = {}) {
  return { id: crypto.randomUUID(), workspace_id: h.workspace, channel: 'webchat', conversation_id: h.visible[0],
    created_at: '2026-09-25T00:00:00Z', total_price: '100', currency: 'USD', status: 'created', financial_status: 'paid', ...patch };
}
function message(sender: string, time: string, patch: Record<string, unknown> = {}) {
  return { conversation_id: h.visible[0], sender_type: sender, created_at: `2026-09-25T10:${time}Z`,
    origin: sender === 'bot' ? 'ai_agent' : null, status: sender === 'customer' ? 'received' : 'sent', deleted_at: null, ...patch };
}
async function stats() { const response = await GET();return { response, body: await response.json() }; }
beforeEach(() => {
  vi.useFakeTimers();vi.setSystemTime(new Date(now));
  h.user = '00000000-0000-4000-8000-000000000001';h.workspace = '00000000-0000-4000-8000-000000000002';
  h.visible = ['00000000-0000-4000-8000-000000000003'];h.locale = 'es';h.scopeCalls = 0;h.revoked = h.denied = false;h.fail = '';h.calls = [];
  h.data = { conversations: [{ id: h.visible[0], workspace_id: h.workspace, channel: 'webchat', deleted_at: null, status: 'open',
    assigned_agent_id: null, needs_human_at: null, csat: null, created_at: '2026-09-25T00:00:00Z' }], orders: [], messages: [] };
  h.outcomes.mockReset().mockResolvedValue({ cases: [] });
});
afterEach(() => vi.useRealTimers());

describe('current authorized complete webchat report', () => {
  it('does not equate an open unattended case with verified resolution or absent paid totals with zero', async () => {
    const { response, body } = await stats();expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(body).toMatchObject({ resolved: 0, resolution_rate: null, revenue: null, currency: null, revenue_by_currency: [], first_response_seconds: null });
    expect(h.outcomes.mock.calls[0][3]).toBe(h.user);
  });
  it('never picks a largest nominal currency as the overall total', async () => {
    h.data.orders = [order({ currency: 'ARS', total_price: '1000000' }), order({ currency: 'ARS', total_price: '250000', status: 'fulfilled' }), order({ total_price: '120' })];
    const { body } = await stats();expect(body.revenue).toBeNull();expect(body.currency).toBeNull();
    expect(body.revenue_by_currency).toEqual([{ currency: 'ARS', amount: '1250000.00', orders: 2 }, { currency: 'USD', amount: '120.00', orders: 1 }]);
  });
  it('requires paid financial status and preserves exact six-decimal arithmetic', async () => {
    h.data.orders = [order({ total_price: '0.123456' }), order({ total_price: '0.000001' }),
      ...['pending', 'authorized', 'partially_paid', 'partially_refunded', 'refunded', null].map(financial_status => order({ financial_status })),
      order({ status: 'cancelled' }), order({ status: 'failed' })];
    const { body } = await stats();expect(body).toMatchObject({ revenue: 0.123457, paid_orders: 2, excluded_orders: 8 });
    expect(body.revenue_by_currency).toEqual([{ currency: 'USD', amount: '0.123457', orders: 2 }]);
  });
  it('distinguishes observed zero from missing and unsafe paid amounts', async () => {
    h.data.orders = [order({ total_price: '0' })];expect((await stats()).body.revenue).toBe(0);
    h.data.orders.push(order({ total_price: null }), order({ total_price: '12', currency: 'ZZZ' }), order({ total_price: 999999999999 }));
    const { body } = await stats();expect(body.revenue).toBeNull();expect(body.unavailable_amounts).toBe(3);
  });
  it('pages all orders beyond the REST default and isolates metadata before reading it', async () => {
    h.data.orders = Array.from({ length: 1003 }, () => order({ conversation_id: null, total_price: '1' }));
    h.data.orders.push(order({ conversation_id: 'hidden-case', total_price: '99999' }));
    const { body } = await stats();expect(body.orders).toBe(1003);expect(body.revenue).toBe(1003);
    expect(h.calls.some(c => c.table === 'orders' && c.range?.[0] === 1000)).toBe(true);
    for (const call of h.calls.filter(c => c.table === 'conversations' || c.table === 'messages')) expect(call.ids).toEqual(h.visible);
  });
  it('reads every current case rather than a 300-case sample', async () => {
    const originals = h.data.conversations[0];
    h.visible = Array.from({ length: 350 }, (_, i) => `00000000-0000-4000-8000-${String(i + 3).padStart(12, '0')}`);
    h.data.conversations = h.visible.map(id => ({ ...originals, id }));
    h.data.messages = h.visible.flatMap(conversation_id => [message('customer', '00:00', { conversation_id }), message('bot', '00:10', { conversation_id })]);
    const { body } = await stats();expect(body.conversations).toBe(350);expect(body.first_response_samples).toBe(350);expect(body.first_response_seconds).toBe(10);
    expect(h.calls.filter(c => c.table === 'messages')).toHaveLength(4);
  });
  it('ignores failed, queued, deleted and system messages; counts one first response per case', async () => {
    h.data.messages = [message('customer', '00:00'), message('bot', '00:01', { status: 'failed' }), message('bot', '00:02', { status: 'queued' }),
      message('bot', '00:03', { deleted_at: now }), message('system', '00:04'), message('bot', '00:20'), message('customer', '01:00'), message('agent', '02:00')];
    const { body } = await stats();expect(body.first_response_seconds).toBe(20);expect(body.first_response_samples).toBe(1);
  });
  it('uses equal adjacent exclusive windows and excludes events at the end', async () => {
    const original = h.data.conversations[0];h.visible.push('00000000-0000-4000-8000-000000000004');
    h.data.conversations.push({ ...original, id: h.visible[1], created_at: '2026-08-25T00:00:00Z' });
    h.data.orders = [order({ created_at: now }), order({ created_at: '2026-09-01T00:00:00Z' })];
    const { body } = await stats();expect(body.conversations_previous).toBe(1);expect(body.orders).toBe(1);
    for (const call of h.calls) expect(call.filters).toContainEqual(['lt', 'created_at', new Date(now).toISOString()]);
  });
  it.each(['es', 'en'] as const)('withholds private data on denied or changed authority in %s', async locale => {
    h.locale = locale;h.denied = true;
    const denied = await stats();expect(denied.response.status).toBe(403);expect(denied.body.error).toBe(translate(locale, 'dashboard.outcomeForbidden'));expect(h.calls).toEqual([]);
    h.denied = false;h.scopeCalls = 0;h.revoked = true;
    const changed = await stats();expect(changed.response.status).toBe(503);expect(changed.body).not.toHaveProperty('revenue');
  });
  it.each(['conversations', 'orders', 'messages'])('does not replace unavailable %s with a successful empty report', async table => {
    h.fail = table;const { response, body } = await stats();expect(response.status).toBe(503);expect(body).not.toHaveProperty('conversations');
  });
  it('rejects an unauthenticated request without reading business data', async () => {
    h.user = null;const { response } = await stats();expect(response.status).toBe(401);expect(h.calls).toEqual([]);
  });
});
