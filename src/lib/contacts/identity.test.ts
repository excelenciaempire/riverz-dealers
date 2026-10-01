import { beforeEach,describe,expect,it,vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { verifiedContactIds,verifiedConversationIds } from './identity';
const ws='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
const rpc=vi.fn(),db={rpc} as unknown as SupabaseClient;
beforeEach(()=>{vi.clearAllMocks();rpc.mockResolvedValue({data:[id,other],error:null});});
describe('Verified family reads',()=>{
  it.each(['system','human'] as const)('binds %s reads to explicit business and identity',async source=>{
    expect(await verifiedContactIds(db,ws,id,source)).toEqual([id,other]);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(source==='system'?'verified_contact_family':'contact_identity_family',{p_workspace_id:ws,p_contact_id:id});
  });
  it.each([null,[],[other],[id,'not-an-id'],Array(51).fill(id)])('does not expand malformed results',async data=>{
    rpc.mockResolvedValue({data,error:null});expect(await verifiedContactIds(db,ws,id)).toEqual([id]);
  });
  it('never falls back to raw pointer traversal after a private failure',async()=>{
    rpc.mockRejectedValueOnce(new Error('private SQL'));expect(await verifiedContactIds(db,ws,id)).toEqual([id]);
    rpc.mockResolvedValueOnce({data:[id,other],error:{message:'private SQL'}});expect(await verifiedContactIds(db,ws,id)).toEqual([id]);
  });
  it('does not query a missing or malformed business',async()=>{
    expect(await verifiedContactIds(db,undefined,id)).toEqual([id]);expect(await verifiedContactIds(db,'invalid',id)).toEqual([id]);expect(rpc).not.toHaveBeenCalled();
  });
});
describe('Verified model history',()=>{
  const conversation={id:ws,workspace_id:ws,contact_id:id},eq=vi.fn(),where=vi.fn();
  let data:unknown,error:unknown;
  const query={select:()=>query,eq:(...args:unknown[])=>{eq(...args);return query;},in:(...args:unknown[])=>{where(...args);return query;},is:()=>query,limit:async()=>({data,error})};
  const database={rpc,from:()=>query} as unknown as SupabaseClient;
  beforeEach(()=>{data=[{id:other,workspace_id:ws,contact_id:id}];error=null;});
  it('scopes every conversation read and retains the current conversation',async()=>{
    expect(await verifiedConversationIds(database,conversation)).toEqual([ws,other]);expect(eq).toHaveBeenCalledWith('workspace_id',ws);expect(where).toHaveBeenCalledWith('contact_id',[id,other]);
  });
  it.each(['workspace','contact','id','error','unbounded'])('rejects a %s result rather than mixing customer history',async kind=>{
    if(kind==='workspace')data=[{id:other,workspace_id:id,contact_id:id}];
    if(kind==='contact')data=[{id:other,workspace_id:ws,contact_id:ws}];
    if(kind==='id')data=[{id:'invalid',workspace_id:ws,contact_id:id}];
    if(kind==='error')error={message:'private SQL'};
    if(kind==='unbounded')data=Array(201).fill({id:other,workspace_id:ws,contact_id:id});
    expect(await verifiedConversationIds(database,conversation)).toEqual([ws]);
  });
});
