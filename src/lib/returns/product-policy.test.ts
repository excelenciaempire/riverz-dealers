import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
const f=vi.hoisted(()=>({enabled:true,rpc:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return f.enabled;}}));
import {attachProductReturnPolicies,readProductReturnPolicy,writeProductReturnPolicy} from './product-policy';
const ws='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',product='33333333-3333-4333-8333-333333333333',agent='44444444-4444-4444-8444-444444444444',id='55555555-5555-4555-8555-555555555555';
const policy={mode:'allow' as const,window_days:30,starts_at:'delivery' as const,remedies:['refund' as const],conditions:'Inspected'};
const snapshot={product_id:product,revision:1,policy,changed_at:'2026-10-01T12:00:00Z'},db={rpc:f.rpc} as unknown as SupabaseClient;
beforeEach(()=>{vi.clearAllMocks();f.enabled=true;f.rpc.mockResolvedValue({data:{snapshot,can_edit:true},error:null});});
describe('Product policy service and current catalog boundary',()=>{
 it('uses only the current actor/workspace/product, then projects a coherent response',async()=>{
  expect(await readProductReturnPolicy(db,ws,actor,product)).toEqual({snapshot,can_edit:true});expect(f.rpc).toHaveBeenCalledExactlyOnceWith('read_product_return_policy',{p_workspace_id:ws,p_actor_id:actor,p_product_id:product});
  f.rpc.mockResolvedValue({data:snapshot,error:null});expect(await writeProductReturnPolicy(db,ws,actor,product,{id,expected_revision:0,policy})).toEqual(snapshot);
  expect(f.rpc).toHaveBeenLastCalledWith('write_product_return_policy',{p_workspace_id:ws,p_actor_id:actor,p_product_id:product,p_id:id,p_expected_revision:0,p_policy:policy});
 });
 it('rejects actor, credential and invalid identity fields before RPC writes',async()=>{
  await expect(writeProductReturnPolicy(db,ws,actor,product,{id,expected_revision:0,policy,actor_id:actor} as never)).rejects.toMatchObject({code:'invalid'});await expect(readProductReturnPolicy(db,ws,actor,'foreign')).rejects.toMatchObject({code:'invalid'});expect(f.rpc).not.toHaveBeenCalled();
 });
 it.each(['product_return_policy_changed','product_return_policy_not_found','product_return_policy_read_only','PRIVATE_SQL'])('maps %s without exposing private error detail',async message=>{
  f.rpc.mockResolvedValue({data:null,error:{message}});await expect(readProductReturnPolicy(db,ws,actor,product)).rejects.toMatchObject({code:{product_return_policy_changed:'changed',product_return_policy_not_found:'notFound',product_return_policy_read_only:'readOnly'}[message]??'unavailable'});
 });
 it('rejects foreign, expanded, wrong-version and modified server replies',async()=>{
  for(const data of [{...snapshot,product_id:actor},{...snapshot,revision:2},{...snapshot,policy:{...policy,window_days:20}},{...snapshot,credential:'SECRET'}]){
   f.rpc.mockResolvedValue({data,error:null});await expect(writeProductReturnPolicy(db,ws,actor,product,{id,expected_revision:0,policy})).rejects.toMatchObject({code:'unavailable'});
  }
 });
 it('performs no additional catalog queries outside comparison',async()=>{
  f.enabled=false;const rows=[{id:product,title:'Original'}];expect(await attachProductReturnPolicies(db,ws,agent,rows)).toBe(rows);expect(f.rpc).not.toHaveBeenCalled();
 });
 it('attaches only exact admitted product snapshots, never an invented absent policy',async()=>{
  f.rpc.mockResolvedValue({data:[snapshot],error:null});expect(await attachProductReturnPolicies(db,ws,agent,[{id:product}])).toEqual([{id:product,return_policy:snapshot}]);
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('read_agent_product_return_policies',{p_workspace_id:ws,p_agent_id:agent,p_product_ids:[product]});
 });
 it.each(['failure','foreign','duplicate','missing','extra','invalid-date'])('marks %s catalog data unavailable instead of claiming no policy exists',async mode=>{
  f.rpc.mockResolvedValue({data:mode==='foreign'?[{...snapshot,product_id:actor}]:mode==='duplicate'?[snapshot,snapshot]:mode==='missing'?[]:mode==='extra'?[{...snapshot,secret:'PRIVATE'}]:mode==='invalid-date'?[{...snapshot,changed_at:null}]:null,error:mode==='failure'?{message:'SECRET'}:null});
  expect(await attachProductReturnPolicies(db,ws,agent,[{id:product}])).toEqual([{id:product,return_policy_unavailable:true}]);
 });
 it('bounds the source read to eighty distinct products and marks excess products unavailable',async()=>{
  const ids=Array.from({length:81},(_,i)=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`);f.rpc.mockResolvedValue({data:ids.slice(0,80).map(product_id=>({product_id,revision:0,policy:null,changed_at:null})),error:null});
  const result=await attachProductReturnPolicies(db,ws,agent,ids.map(id=>({id})));expect(f.rpc.mock.calls[0][1].p_product_ids).toHaveLength(80);expect(result[80]).toEqual({id:ids[80],return_policy_unavailable:true});
 });
});
