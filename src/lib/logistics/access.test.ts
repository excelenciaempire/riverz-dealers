import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
vi.mock('@/lib/mcp/access', () => ({ userAccess: vi.fn() }));
import { userAccess } from '@/lib/mcp/access';
import { logisticsAccess, visibleLogisticsCalls, visibleLogisticsConversations } from './access';
const ws='11111111-1111-4111-8111-111111111111', actor='22222222-2222-4222-8222-222222222222',
  contact='33333333-3333-4333-8333-333333333333', conversation='44444444-4444-4444-8444-444444444444',
  source='55555555-5555-4555-8555-555555555555', call='66666666-6666-4666-8666-666666666666', connection='77777777-7777-4777-8777-777777777777';
function database(rows: Record<string, Array<Record<string,unknown>>>, failed?: string) {
  const reads: Array<{ table:string; columns:string }> = [];
  const db = { from: (table:string) => {
    let columns='';const filters: Array<(row: Record<string,unknown>)=>boolean> = [];
    const result = () => ({data: (rows[table]??[]).filter(row=>filters.every(filter=>filter(row))),error: table===failed?{message:'database failed'}:null});
    const query={select: (value:string)=>{columns=value;reads.push({table,columns});return query;},
      eq:(key:string,value:unknown)=>{filters.push(row=>row[key]===value);return query;},
      in:(key:string,values:unknown[])=>{filters.push(row=>values.includes(row[key]));return query;},
      is:(key:string,value:unknown)=>{filters.push(row=>row[key]===value);return query;},
      order:()=>query,limit:()=>query,contains:()=>query,
      maybeSingle:async()=>({...result(),data:result().data[0]??null}),
      then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(result()).then(resolve)};
    return query;
  }} as unknown as SupabaseClient;
  return {db,reads};
}
const caseRow=(id=conversation,channel='whatsapp',conn:string|null=null)=>({id,workspace_id:ws,contact_id:contact,channel,connection_id:conn,deleted_at:null});
const callRow=()=>({id:call,workspace_id:ws,contact_id:contact,conversation_id:conversation,order_id:'42',origin_context:{conversation_id:source}});
beforeEach(()=>{vi.resetAllMocks();vi.mocked(userAccess).mockResolvedValue({admin:true,sections:null});});
describe('Current logistics actor and case boundaries',()=>{
  it('rejects missing identity and current removed/invalid memberships before data reads',async()=>{
    const {db,reads}=database({});await expect(logisticsAccess(db,ws,'')).rejects.toThrow('logistics_access_forbidden');
    vi.mocked(userAccess).mockResolvedValue(null);await expect(logisticsAccess(db,ws,actor)).rejects.toThrow('logistics_access_forbidden');expect(reads).toEqual([]);
  });
  it('separates Orders, Inbox, Voice and administrative writes',async()=>{
    const {db}=database({});vi.mocked(userAccess).mockResolvedValue({admin:false,sections:['/pedidos']});
    expect(await logisticsAccess(db,ws,actor)).toEqual({inbox:false,voice:false});await expect(logisticsAccess(db,ws,actor,true)).rejects.toThrow();
    vi.mocked(userAccess).mockResolvedValue({admin:true,sections:['/bandeja','/voz']});await expect(logisticsAccess(db,ws,actor)).rejects.toThrow();
  });
  it('does not query histories without their section permissions',async()=>{
    const {db,reads}=database({});vi.mocked(userAccess).mockResolvedValue({admin:false,sections:['/pedidos']});
    expect(await visibleLogisticsConversations(db,ws,actor,[conversation])).toEqual(new Set());
    expect(await visibleLogisticsCalls(db,ws,actor,'42')).toEqual(new Set());expect(reads).toEqual([]);
  });
  it.each(['gmail','outlook','zoho'])('protects the actual connection owner of %s, including against workspace admins',async channel=>{
    const rows={conversations:[caseRow(conversation,channel,connection)],contacts:[{id:contact,workspace_id:ws}],channel_connections:[{id:connection,created_by:source,workspace_id:ws,channel}]};
    const {db}=database(rows);expect(await visibleLogisticsConversations(db,ws,actor,[conversation],contact)).toEqual(new Set());
    rows.channel_connections[0].created_by=actor;expect(await visibleLogisticsConversations(db,ws,actor,[conversation],contact)).toEqual(new Set([conversation]));
    rows.channel_connections[0].workspace_id=source;expect(await visibleLogisticsConversations(db,ws,actor,[conversation],contact)).toEqual(new Set());
  });
  it('excludes deleted cases, mismatched contacts and contacts from another workspace',async()=>{
    const rows={conversations:[caseRow()],contacts:[{id:contact,workspace_id:source}]};const {db}=database(rows);
    expect(await visibleLogisticsConversations(db,ws,actor,[conversation],contact)).toEqual(new Set());rows.contacts[0].workspace_id=ws;rows.conversations[0].deleted_at='deleted' as unknown as null;
    expect(await visibleLogisticsConversations(db,ws,actor,[conversation],contact)).toEqual(new Set());
    await expect(visibleLogisticsConversations(db,ws,actor,Array(101).fill(conversation))).rejects.toThrow();
  });
  it('checks both the call case and its private source case before allowing the summary',async()=>{
    const rows={voice_calls:[callRow()],conversations:[caseRow(),caseRow(source,'gmail',connection)],contacts:[{id:contact,workspace_id:ws}],channel_connections:[{id:connection,created_by:source,workspace_id:ws,channel:'gmail'}]};
    const {db,reads}=database(rows);expect(await visibleLogisticsCalls(db,ws,actor,'42')).toEqual(new Set());
    expect(reads.filter(row=>row.table==='voice_calls').every(row=>!row.columns.includes('summary'))).toBe(true);
    rows.channel_connections[0].created_by=actor;expect(await visibleLogisticsCalls(db,ws,actor,'42')).toEqual(new Set([call]));
    rows.channel_connections[0].created_by=source;expect(await visibleLogisticsCalls(db,ws,actor,'42',[call])).toEqual(new Set());
  });
  it('requires a current same-workspace contact for calls without a conversation',async()=>{
    const rows={voice_calls:[{...callRow(),conversation_id:null,origin_context:null}],contacts:[{id:contact,workspace_id:source}]};const {db}=database(rows);
    expect(await visibleLogisticsCalls(db,ws,actor,'42')).toEqual(new Set());rows.contacts[0].workspace_id=ws;
    expect(await visibleLogisticsCalls(db,ws,actor,'42')).toEqual(new Set([call]));
  });
  it('fails closed on a failed connection read or malformed source provenance',async()=>{
    const rows={voice_calls:[callRow()],conversations:[caseRow(),caseRow(source,'gmail',connection)],contacts:[{id:contact,workspace_id:ws}]};
    await expect(visibleLogisticsCalls(database(rows,'channel_connections').db,ws,actor,'42')).rejects.toThrow();
    rows.voice_calls[0].origin_context.conversation_id='invalid';await expect(visibleLogisticsCalls(database(rows).db,ws,actor,'42')).rejects.toThrow('logistics_call_context_invalid');
  });
});
