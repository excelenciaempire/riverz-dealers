import {describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {visibleReturnIds} from './access';
const ws='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
describe('Metadata-only current return visibility',()=>{
 it('uses actual actor and exact candidate IDs, rejecting broader or malformed RPC output',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:[id],error:null}),db={rpc} as unknown as SupabaseClient;
  expect(await visibleReturnIds(db,ws,actor,[id])).toEqual(new Set([id]));expect(rpc).toHaveBeenCalledExactlyOnceWith('visible_return_case_ids',{p_workspace_id:ws,p_actor_id:actor,p_ids:[id]});
  rpc.mockResolvedValue({data:[actor],error:null});await expect(visibleReturnIds(db,ws,actor,[id])).rejects.toMatchObject({code:'unavailable'});
 });
 it('rejects an unbounded or malformed selection before any database call',async()=>{
  const rpc=vi.fn(),db={rpc} as unknown as SupabaseClient;for(const ids of [[null],['bad'],Array(201).fill(id)])await expect(visibleReturnIds(db,ws,actor,ids as string[])).rejects.toMatchObject({code:'unavailable'});expect(rpc).not.toHaveBeenCalled();
 });
 it.each([['return_access_forbidden','forbidden'],['PRIVATE_DATABASE_SECRET','unavailable']] as const)('maps %s without copying database errors',async(message,code)=>{
  const rpc=vi.fn().mockResolvedValue({data:null,error:{message}});await expect(visibleReturnIds({rpc} as unknown as SupabaseClient,ws,actor,[])).rejects.toMatchObject({message:code,code});
 });
});
