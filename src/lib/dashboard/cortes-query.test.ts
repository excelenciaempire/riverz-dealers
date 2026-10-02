import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
vi.mock('./outcomes-query', () => ({ readOutcomes: async () => ({ attended: 1, verified: 1, rate: 1 }) }));
import { leerCortes } from './cortes';
const ws = '00000000-0000-4000-8000-000000000001', actor = '00000000-0000-4000-8000-000000000002', id = '00000000-0000-4000-8000-000000000003';
const range = { desde: new Date('2026-09-20T00:00:00Z'), hasta: new Date('2026-09-30T00:00:00Z') };
function fixture(fail = false, changed = false) {
  const calls: Array<{ table: string; ids: string[] | null; end: string | null }> = []; let scope = 0;
  const data: Record<string, unknown[]> = {
    conversations: [{ id, channel: 'whatsapp', status: 'open', needs_human_at: null, needs_human_reason: null,
      assigned_agent_id: actor, csat: 1, created_at: '2026-09-25T10:00:00Z' }],
    ai_replies: ['sent', 'skipped', 'failed', 'queued'].map(status => ({ conversation_id: id, agent_id: actor, status, skip_reason: status === 'skipped' ? 'requires_human' : null })),
    ai_agents: [{ id: actor, name: 'Synthetic assistant', is_active: true, business_hours: null }],
    messages: [{ conversation_id: id, sender_type: 'customer', created_at: '2026-09-25T10:00:00Z', origin: null, status: 'received' },
      { conversation_id: id, sender_type: 'bot', created_at: '2026-09-25T10:00:01Z', origin: 'ai_agent', status: 'failed' },
      { conversation_id: id, sender_type: 'bot', created_at: '2026-09-25T10:01:00Z', origin: 'ai_agent', status: 'sent' }],
  };
  const db = { rpc: async () => ({ data: changed && ++scope > 1 ? [] : [id] }), from(table: string) {
    const call = { table, ids: null as string[] | null, end: null as string | null }; calls.push(call);
    const query = { select: () => query, eq: () => query, is: () => query, order: () => query, gte: () => query, range: () => query,
      in: (_key: string, ids: string[]) => { call.ids = ids; return query; },
      lt: (_key: string, end: string) => { call.end = end; return query; },
      then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: fail && table === 'messages' ? null : data[table], error: null }).then(resolve),
    }; return query;
  } } as unknown as SupabaseClient;
  return { db, calls };
}
describe('current authorized channel and assistant cuts', () => {
  it('uses visible case batches and an exclusive end; queued output is not abstention', async () => {
    const { db, calls } = fixture(); const result = await leerCortes(db, ws, range, 'UTC', actor);
    expect(result.agentes).toMatchObject([{ respondio: 1, seAbstuvo: 1, fallo: 1, otrosEstados: 1 }]);
    expect(result.ia).toMatchObject({ atendidas: 1, resueltas: 1 });
    expect(result.respuesta.ia).toBe(60);
    for (const call of calls.filter(c => c.table !== 'ai_agents')) expect(call).toMatchObject({ ids: [id], end: range.hasta.toISOString() });
  });
  it('does not turn missing message data into zero response time', async () => {
    await expect(leerCortes(fixture(true).db, ws, range, 'UTC', actor)).rejects.toThrow('dashboard_source_unavailable');
  });
  it('withholds output after case scope changes', async () => {
    await expect(leerCortes(fixture(false, true).db, ws, range, 'UTC', actor)).rejects.toThrow('dashboard_scope_changed');
  });
});
