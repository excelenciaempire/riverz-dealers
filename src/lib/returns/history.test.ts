/* eslint-disable @typescript-eslint/no-explicit-any -- Scoped Supabase query double. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadReturnHistory, parseReturnHistoryQuery } from './history';
const ws = '11111111-1111-4111-8111-111111111111', caseId = '22222222-2222-4222-8222-222222222222', other = '33333333-3333-4333-8333-333333333333';
const stamp = '2026-10-01T12:00:00.123456Z';
let cases: any[], events: any[], failed: string | undefined, positions: number[], queries: string[];
function database(): SupabaseClient {
  return { async rpc(_name:string,args:any){
    queries.push('returns');
    if(failed)return {data:null,error:{message:'PRIVATE_DATABASE_DETAIL'}};
    const existing=cases.find(row=>row.id===args.p_case_id&&row.workspace_id===args.p_workspace_id);
    if(!existing)return {data:null,error:{message:'return_not_found'}};
    queries.push('return_case_events');const matched=events.filter(row=>row.workspace_id===args.p_workspace_id&&row.case_id===args.p_case_id&&(!args.p_cursor_sequence||row.event_sequence<args.p_cursor_sequence)).sort((a,b)=>b.event_sequence-a.event_sequence);
    if(args.p_cursor_sequence)positions.push(args.p_cursor_sequence);
    const selected=matched.slice(0,20).map(row=>({id:row.id,event_sequence:row.event_sequence,event_type:row.event_type,occurred_at:row.occurred_at,actor_id:row.actor_id,status:row.snapshot.status,previous_status:row.previous_snapshot?.status??null,resolution:row.snapshot.resolution,previous_resolution:row.previous_snapshot?.resolution??null,photo_count:Array.isArray(row.snapshot.photos)?row.snapshot.photos.length:null}));
    return {data:{events:selected,next_cursor:matched.length>20?JSON.stringify({event_sequence:selected[selected.length-1].event_sequence}):null},error:null};
  },from(table: string) {
    queries.push(table);
    const conditions: Array<(row: any) => boolean> = []; let limit = Infinity;
    const read = () => ({ data: (table === 'returns' ? cases : events).filter(row => conditions.every(test => test(row))).sort((a, b) => b.event_sequence - a.event_sequence).slice(0, limit), error: table === failed ? { message: 'private database detail' } : null });
    const q: any = {
      select: () => q, eq: (key: string, value: unknown) => { conditions.push(row => row[key] === value); return q; }, order: () => q,
      limit: (value: number) => { limit = value; return q; },
      lt: (key: string, value: number) => { positions.push(value); conditions.push(row => row[key] < value); return q; },
      maybeSingle: async () => { const result = read(); return { ...result, data: result.data[0] ?? null }; },
      then: (resolve: (value: unknown) => unknown) => resolve(read()),
    }; return q;
  } } as unknown as SupabaseClient;
}
function event(index = 1) { return { id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, event_sequence: index, workspace_id: ws, case_id: caseId, occurred_at: stamp, event_type: 'state_changed', actor_id: null, snapshot: { status: 'recibida', resolution: 'Received', photos: ['private-image-url'], customer_note: 'private customer original' }, previous_snapshot: { status: 'aprobada', resolution: 'Approved', photos: [] } }; }
beforeEach(() => { cases = [{ id: caseId, workspace_id: ws }]; events = [event()]; failed = undefined; positions = []; queries = []; });
describe('scoped return history reads', () => {
  it('serializes states and notes without attachment URLs, customer originals or identity joins', async () => {
    const page = await loadReturnHistory(database(), ws, caseId, other);
    expect(page.events[0]).toMatchObject({ status: 'recibida', previous_status: 'aprobada', resolution: 'Received', previous_resolution: 'Approved', photo_count: 1 });
    expect(JSON.stringify(page)).not.toMatch(/private-image-url|private customer original|workspace_id|snapshot/);
  });
  it('filters events by both business and exact case', async () => {
    events.push({ ...event(2), workspace_id: other }, { ...event(3), case_id: other });
    expect((await loadReturnHistory(database(), ws, caseId, other)).events).toHaveLength(1);
  });
  it('does not read history when the case belongs to another business or was removed', async () => {
    cases[0].workspace_id = other;
    await expect(loadReturnHistory(database(), ws, caseId, other)).rejects.toMatchObject({ code: 'notFound' });
    expect(queries).toEqual(['returns']);
  });
  it.each(['returns', 'return_case_events'])('does not report a failed %s read as empty', async table => {
    failed = table;
    await expect(loadReturnHistory(database(), ws, caseId, other)).rejects.toMatchObject({ code: 'unavailable' });
  });
  it.each(['status', 'photos'])('rejects an inconsistent stored %s', async field => {
    events[0].snapshot[field] = field === 'status' ? 'refunded' : null;
    await expect(loadReturnHistory(database(), ws, caseId, other)).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('paginates forty-three events sharing a microsecond timestamp without gaps or repeats', async () => {
    events = Array.from({ length: 43 }, (_, index) => event(index + 1));
    const found: string[] = []; let cursor: string | undefined;
    do {
      const page = await loadReturnHistory(database(), ws, caseId, other, cursor);
      found.push(...page.events.map(row => row.id)); cursor = page.next_cursor ?? undefined;
      expect(page.events.every(row => row.occurred_at === stamp)).toBe(true);
    } while (cursor);
    expect(found).toHaveLength(43); expect(new Set(found).size).toBe(43);
    expect(positions).toEqual([24, 4]);
  });
  it.each(['cursor=', 'cursor=invalid', 'workspace_id=foreign', 'cursor=x&cursor=y', 'limit=1000'])('rejects manipulated query %s', query => {
    expect(() => parseReturnHistoryQuery(new URLSearchParams(query))).toThrow('invalid');
  });
  it('does not interpolate a malformed cursor into a query', async () => {
    await expect(loadReturnHistory(database(), ws, caseId, other, JSON.stringify({ event_sequence: '10),workspace_id.eq.foreign' }))).rejects.toMatchObject({ code: 'invalid' });
    expect(queries).toEqual([]);
  });
});
