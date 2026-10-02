import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
vi.mock('@/lib/attribution/informe', () => ({ leerAtribucion: vi.fn() }));
vi.mock('@/lib/dashboard/cortes', () => ({ leerCortes: vi.fn() }));
vi.mock('@/lib/dashboard/queries', () => ({ loadMetrics: vi.fn() }));
vi.mock('@/lib/workspaces/timezone', () => ({ workspaceTimezone: async () => 'America/Bogota' }));
vi.mock('@/lib/dashboard/access', () => ({ visibleDashboardCases: async () => new Set(['visible-case']), assertDashboardScope: vi.fn() }));
import { loadMetrics } from '@/lib/dashboard/queries';
import { METRICS_CAPABILITIES } from './metrics';

describe('complete summary periods', () => {
  const calls: Array<{ table: string; filters: Array<[string, unknown]>; from: number; to: number }> = [];
  let fail = false, nullData = false;
  const orders = Array.from({ length: 1003 }, () => ({ total_price: '0.10', currency: 'USD', financial_status: 'paid', status: 'created', conversation_id: null, channel: 'webchat' }));
  const db = { from(table: string) {
    const record = { table, filters: [] as Array<[string, unknown]>, from: 0, to: 999 };
    calls.push(record);
    const chain = {
      select: () => chain, order: () => chain,
      eq: (key: string, value: unknown) => { record.filters.push([key, value]); return chain; },
      gte: (key: string, value: unknown) => { record.filters.push([`gte:${key}`, value]); return chain; },
      lt: (key: string, value: unknown) => { record.filters.push([`lt:${key}`, value]); return chain; },
      range: (from: number, to: number) => { record.from = from; record.to = to; return chain; },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve({
        data: nullData ? null : (table === 'orders' ? orders : [{ status: 'sent', conversation_id: 'visible-case' }, { status: 'queued', conversation_id: 'visible-case' }]).slice(record.from, record.to + 1),
        error: fail ? { message: 'private database details' } : null,
      }).then(resolve, reject),
    };
    return chain;
  } } as unknown as SupabaseClient;
  beforeEach(() => {
    calls.length = 0; fail = false; nullData = false;
    const pair = { current: 1, previous: 2 };
    vi.mocked(loadMetrics).mockResolvedValue({ conversations: pair, newContacts: pair, resolved: pair, messagesReceived: pair, messagesSent: pair, channelMix: [] } as unknown as Awaited<ReturnType<typeof loadMetrics>>);
  });
  const run = () => METRICS_CAPABILITIES.find(c => c.key === 'metricas.resumen')!.run({ db, workspaceId: 'actual-workspace', actor: { type: 'operator', id: 'actual-user' } }, { dias: 7 });
  it('paginates both periods and echoes a bounded window for every auxiliary query', async () => {
    const result = await run() as { pedidos: { cantidad: number; facturado: number; anterior: { cantidad: number } }; ia: { respondio: number; otros_estados: number; anterior: unknown } };
    expect(result.pedidos).toMatchObject({ cantidad: 1003, facturado: 100.3, anterior: { cantidad: 1003 } });
    expect(result.ia).toMatchObject({ respondio: 1, otros_estados: 1, anterior: { respondio: 1 } });
    expect(calls.filter(c => c.table === 'orders').map(c => c.from)).toEqual([0, 0, 1000, 1000]);
    for (const call of calls) expect(call.filters).toEqual(expect.arrayContaining([
      ['workspace_id', 'actual-workspace'], ['gte:created_at', expect.any(String)], ['lt:created_at', expect.any(String)],
    ]));
  });
  it('fails visibly when the source query fails', async () => {
    fail = true;
    await expect(run()).rejects.toThrow('metrics_summary_unavailable');
  });
  it('does not turn a missing source response into a zero', async () => {
    nullData = true;
    await expect(run()).rejects.toThrow('metrics_summary_unavailable');
  });
});

describe('attribution operator view', () => {
  it('renders the real handler categories without summing assisted and proven sales', async () => {
    const cap = METRICS_CAPABILITIES.find(c => c.key === 'metricas.atribucion')!;
    const ctx = { db: {} as SupabaseClient, workspaceId: 'w1', actor: { type: 'operator' as const, id: 'u1' }, locale: 'en' as const };
    const result = { periodo: { dias: 7 }, moneda: 'USD', venta_total: 900, pedidos_totales: 9,
      probada: { revenue: 300, orders: 3, currency: 'USD' }, influida: { revenue: 200, orders: 2, currency: 'USD' },
      quien_lo_cerro: { ia: { revenue: 100, orders: 1 }, humano: { revenue: 200, orders: 2 } } };
    const view = await cap.vista!(ctx, {}, result);
    expect(view).toMatchObject({ kind: 'cifras', tiles: expect.arrayContaining([
      expect.objectContaining({ etiqueta: 'Handled by AI', valor: '$100.00' }),
      expect.objectContaining({ etiqueta: 'Handled by a person', valor: '$200.00' }),
      expect.objectContaining({ etiqueta: 'Proven', valor: '$300.00' }),
    ]) });
  });
});
