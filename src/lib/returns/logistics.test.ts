import {describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {readReturnLogistics,recordReturnLogistics} from './logistics';
import {returnLogisticsInput} from './logistics-contract';
const ws='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333',event='44444444-4444-4444-8444-444444444444',stamp='2026-10-01T10:00:00.123456Z';
const input={id:event,kind:'guide' as const,payload:{carrier:'Example',tracking_number:'42'},expected_updated_at:stamp};
const result={event_id:event,status:'aprobada',unchanged:false,updated_at:stamp};
const page={case_id:id,status:'aprobada',updated_at:stamp,platform:null,events:[],next_cursor:null};
describe('Shared return logistics service',()=>{
 it('binds writes only to the server-selected business, real actor and case',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:result,error:null});expect(await recordReturnLogistics({rpc} as unknown as SupabaseClient,ws,actor,id,input)).toEqual(result);
  expect(rpc).toHaveBeenCalledExactlyOnceWith('record_return_logistics',{p_workspace_id:ws,p_actor_id:actor,p_case_id:id,p_id:event,p_kind:'guide',p_payload:input.payload,p_expected_updated_at:stamp});
 });
 it('reads only a validated case-bound DTO and metadata cursor',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:page,error:null});expect(await readReturnLogistics({rpc} as unknown as SupabaseClient,ws,actor,id,'{"event_sequence":42}')).toEqual(page);
  expect(rpc).toHaveBeenCalledExactlyOnceWith('read_return_logistics',{p_workspace_id:ws,p_actor_id:actor,p_case_id:id,p_cursor_sequence:42});
 });
 it.each([['invalid_return_logistics','invalid'],['return_access_forbidden','forbidden'],['return_not_found','notFound'],['return_platform_managed','platformManaged'],['return_decision_changed','changed'],['return_logistics_conflict','changed'],['return_subscription_read_only','readOnly'],['return_logistics_limit','limit'],['PRIVATE_SECRET','unavailable']] as const)('maps %s without leaking internals',async(message,code)=>{
  const rpc=vi.fn().mockResolvedValue({data:null,error:{message}});await expect(recordReturnLogistics({rpc} as unknown as SupabaseClient,ws,actor,id,input)).rejects.toMatchObject({code});
 });
 it('rejects unknown credentials or identity fields, invalid amounts and invented provider confirmation',()=>{
  for(const raw of [{...input,actor_id:actor},{...input,payload:{...input.payload,token:'SECRET'}},{...input,kind:'carrier_confirmed'},
   {...input,kind:'receipt',payload:{reference:'42',quantity:1.5,condition:'accepted',received_at:stamp,note:''}}])expect(returnLogisticsInput.safeParse(raw).success).toBe(false);
 });
 it('rejects wrong identifiers, extra response keys and malformed cursors',async()=>{
  const rpc=vi.fn(),db={rpc} as unknown as SupabaseClient;
  for(const data of [{...result,event_id:actor},{...result,unchanged:'yes'},{...result,secret:'SECRET'}]){rpc.mockResolvedValue({data,error:null});await expect(recordReturnLogistics(db,ws,actor,id,input)).rejects.toMatchObject({code:'unavailable'});}
  rpc.mockResolvedValue({data:{...page,case_id:actor},error:null});await expect(readReturnLogistics(db,ws,actor,id)).rejects.toMatchObject({code:'unavailable'});
  rpc.mockClear();await expect(readReturnLogistics(db,ws,actor,id,'{"event_sequence":0}')).rejects.toMatchObject({code:'invalid'});await expect(recordReturnLogistics(db,'foreign',actor,id,input)).rejects.toMatchObject({code:'invalid'});expect(rpc).not.toHaveBeenCalled();
 });
});
