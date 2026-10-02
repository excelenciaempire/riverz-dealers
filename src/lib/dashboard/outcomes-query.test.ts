import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { readOutcomes, readThread } from './outcomes-query';
const ws = '00000000-0000-4000-8000-000000000001', actor = '00000000-0000-4000-8000-000000000002';
const c = '00000000-0000-4000-8000-000000000003', privateCase = '00000000-0000-4000-8000-000000000004';
const customer = '00000000-0000-4000-8000-000000000005', bot = '00000000-0000-4000-8000-000000000006';
const human = '00000000-0000-4000-8000-000000000007';
const range = { start: '2026-09-20T00:00:00Z', end: '2026-09-30T00:00:00Z' };
function fixture({ oldHuman = false, changedScope = false, deletedBot = false, noScope = false } = {}) {
  let scopeCalls = 0;
  const reads: Array<{ table: string; ids: string[] | null }> = [];
  const tables: Record<string, Array<Record<string, unknown>>> = {
    conversations: [c, privateCase].map(id => ({ id, channel: 'gmail', status: 'open', needs_human_at: null,
      needs_human_reason: null, last_message_at: '2026-09-25T10:01:00Z', contacts: { name: id === c ? 'Synthetic visible' : 'Synthetic private' } })),
    messages: [c, privateCase].flatMap(id => [
      { id: customer, conversation_id: id, sender_type: 'customer', origin: null, status: 'delivered', created_at: '2026-09-25T10:00:00Z', deleted_at: null },
      { id: bot, conversation_id: id, sender_type: 'bot', origin: 'ai_agent', status: 'sent', created_at: '2026-09-25T10:01:00Z', deleted_at: deletedBot ? '2026-09-26T00:00Z' : null },
      ...(oldHuman ? [{ id: human, conversation_id: id, sender_type: 'agent', origin: null, status: 'sent', created_at: '2026-09-01T10:00:00Z', deleted_at: null }] : []),
    ]),
    conversation_outcomes: [{ conversation_id: c, last_message_id: bot, category: 'tracking', verified_at: '2026-09-25T10:02:00Z' }],
    workspace_subscriptions: [],
  };
  const db = {
    rpc: async () => ({ data: noScope || changedScope && ++scopeCalls > 1 ? [] : [c] }),
    from(table: string) {
      let ids: string[] | null = null, idColumn = 'id', from = 0, to = 999, omitDeleted = false, single = false;
      const query = {
        select: () => query, order: () => query,
        eq: (key: string, value: string) => { if (key === 'id' || key === 'conversation_id') { ids = [value]; idColumn = key; } return query; },
        in: (key: string, values: string[]) => { ids = values; idColumn = key; return query; },
        is: () => { omitDeleted = true; return query; },
        range: (start: number, end: number) => { from = start; to = end; return query; },
        maybeSingle: () => { single = true; return query; },
        then: (resolve: (result: unknown) => unknown) => {
          reads.push({ table, ids });
          const result = (tables[table] ?? []).filter(row => (!ids || ids.includes(row[idColumn] as string)) && (!omitDeleted || !row.deleted_at)).slice(from, to + 1);
          return Promise.resolve({ data: single ? result[0] ?? null : result, error: null }).then(resolve);
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { db, reads };
}
describe('permission-filtered resolution reports', () => {
  it('loads names and histories only for current visible IDs', async () => {
    const { db, reads } = fixture();
    const report = await readOutcomes(db, ws, range, actor);
    expect(report).toMatchObject({ attended: 1, verified: 1, cases: [{ id: c, name: 'Synthetic visible' }] });
    expect(JSON.stringify(report)).not.toContain('Synthetic private');
    for (const read of reads.filter(r => r.table !== 'workspace_subscriptions')) expect(read.ids).toEqual([c]);
  });
  it('preserves a human reply before the window instead of claiming an AI-only resolution', async () => {
    const { db } = fixture({ oldHuman: true });
    expect(await readOutcomes(db, ws, range, actor)).toMatchObject({ attended: 1, verified: 0, human: 1 });
  });
  it('does not rely on deleted bot evidence', async () => {
    const { db } = fixture({ deletedBot: true });
    expect(await readOutcomes(db, ws, range, actor)).toMatchObject({ attended: 0, verified: 0, rate: null });
  });
  it('withholds a report when current access changes during the read', async () => {
    const { db } = fixture({ changedScope: true });
    await expect(readOutcomes(db, ws, range, actor)).rejects.toThrow('dashboard_scope_changed');
  });
  it('never loads a guessed private thread or empty-scope history', async () => {
    const { db, reads } = fixture();
    expect(await readThread(db, ws, privateCase, actor)).toBeNull(); expect(reads).toHaveLength(0);
    const empty = fixture({ noScope: true });
    expect(await readOutcomes(empty.db, ws, range, actor)).toMatchObject({ attended: 0, cases: [], pending: [] });
    expect(empty.reads.map(r => r.table)).toEqual(['workspace_subscriptions']);
  });
});
