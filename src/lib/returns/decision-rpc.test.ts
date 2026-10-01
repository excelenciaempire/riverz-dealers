import {describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {decideReturn,loadReturnDecision} from './decision';
const ws='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
const row={id,order_number:'#42',kind:'devolucion',reason:null,status:'aprobada',resolution:'Preserved',updated_at:'2026-10-01T10:00:00.123456+00:00',platform:null,unchanged:false};
describe('One transactional return decision service',()=>{
 it('does one actor-bound RPC without a separate update, preserving omitted notes',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:row,error:null}),db={rpc} as unknown as SupabaseClient;
  expect(await decideReturn(db,ws,actor,{id,status:'aprobada',expected_updated_at:row.updated_at})).toEqual(row);
  expect(rpc).toHaveBeenCalledExactlyOnceWith('decide_return_case',{p_workspace_id:ws,p_actor_id:actor,p_case_id:id,p_status:'aprobada',p_resolution:null,p_replace_resolution:false,p_expected_updated_at:row.updated_at});
 });
 it.each([[null,null],[' Revised ','Revised']] as const)('makes note replacement explicit (%s)',async(input,expected)=>{
  const rpc=vi.fn().mockResolvedValue({data:{...row,resolution:expected},error:null});await decideReturn({rpc} as unknown as SupabaseClient,ws,actor,{id,status:'aprobada',resolution:input});expect(rpc).toHaveBeenCalledWith('decide_return_case',expect.objectContaining({p_replace_resolution:true,p_resolution:expected}));
 });
 it.each([['return_subscription_read_only','readOnly'],['invalid_return_transition','invalidDecision'],['return_access_forbidden','unauthorized'],['return_platform_managed','platformManaged'],['return_decision_changed','decisionChanged'],['PRIVATE_DATABASE_SECRET','saveFailed']] as const)('maps %s privately',async(message,code)=>{
  const rpc=vi.fn().mockResolvedValue({data:null,error:{message}});await expect(decideReturn({rpc} as unknown as SupabaseClient,ws,actor,{id,status:'aprobada'})).rejects.toMatchObject({code});
 });
 it('validates a confirmed response instead of accepting a mismatched case, state or note',async()=>{
  const rpc=vi.fn(),db={rpc} as unknown as SupabaseClient;for(const data of [{...row,id:actor},{...row,status:'resuelta'},{...row,unchanged:'yes'},{...row,provider_secret:'PRIVATE'}]){rpc.mockResolvedValue({data,error:null});await expect(decideReturn(db,ws,actor,{id,status:'aprobada'})).rejects.toMatchObject({code:'saveFailed'});}
 });
 it('reads previews under the real actor rather than a key or supplied identity',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:row,error:null});await loadReturnDecision({rpc} as unknown as SupabaseClient,ws,id,actor);expect(rpc).toHaveBeenCalledExactlyOnceWith('read_return_case_decision',{p_workspace_id:ws,p_actor_id:actor,p_case_id:id});
 });
});
