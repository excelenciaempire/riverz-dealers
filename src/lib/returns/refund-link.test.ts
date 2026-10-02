import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
const m=vi.hoisted(()=>({snapshot:vi.fn(),billing:vi.fn(),rpc:vi.fn(),limit:vi.fn()}));
vi.mock('@/lib/inbox/order-actions',()=>({caseOrderSnapshot:m.snapshot}));
vi.mock('@/lib/billing/read-only',async original=>({...await original<typeof import('@/lib/billing/read-only')>(),assertWorkspaceWritable:m.billing}));
vi.mock('@/lib/rate-limit',()=>({limitByKey:m.limit}));
import {prepareReturnRefund,readReturnRefundContext} from './refund-link';
import {returnRefundInput} from './refund-link-contract';
import {BillingReadOnlyError} from '@/lib/billing/read-only';
const ws='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333',event='44444444-4444-4444-8444-444444444444',order='55555555-5555-4555-8555-555555555555',contact='66666666-6666-4666-8666-666666666666',conv='77777777-7777-4777-8777-777777777777',op='88888888-8888-4888-8888-888888888888';
const receipt={id:event,reference:'Warehouse 42',condition:'damaged' as const,quantity:2,recorded_at:'2026-10-01T12:00:00.123456Z'};
const context={case_id:id,order_id:order,contact_id:contact,conversation_id:conv,receipt};
const input={id:op,receipt_id:event,amount:25,reason:'Return checked'};
const preview={order_name:'#42',amount:'25.00',currency:'USD',financial_status:'paid',fulfillment_status:'fulfilled'};
const stored={case_id:id,conversation_id:conv,operation:{id:op,workspace_id:ws,conversation_id:conv,order_id:order,requested_by:actor,action:{type:'refund',amount:25,reason:input.reason},status:'preview',expires_at:'2026-10-01T12:10:00Z',
 preview:{...preview,return_receipt:{version:1,case_id:id,receipt_id:event,reference:receipt.reference,condition:receipt.condition,quantity:receipt.quantity,recorded_at:receipt.recorded_at}}}};
const db={rpc:m.rpc} as unknown as SupabaseClient;
beforeEach(()=>{vi.clearAllMocks();m.billing.mockResolvedValue(undefined);m.limit.mockResolvedValue({success:true});m.snapshot.mockResolvedValue({preview,fingerprint:'a'.repeat(64)});m.rpc.mockImplementation(async name=>({data:name==='read_return_refund_context'?context:stored,error:null}));});
describe('Receipt-linked refund preparation boundary',()=>{
 it('reads server identities, checks billing and the live balance, then prepares without claiming money',async()=>{
  const result=await prepareReturnRefund(db,ws,actor,id,input);expect(result).toMatchObject({case_id:id,conversation_id:conv,operation_id:op,amount:'25.00',currency:'USD',receipt});
  expect(m.snapshot).toHaveBeenCalledExactlyOnceWith(db,ws,contact,order,{type:'refund',amount:25,reason:input.reason});
  expect(m.rpc.mock.calls.map(call=>call[0])).toEqual(['read_return_refund_context','prepare_return_refund_preview']);expect(m.rpc).toHaveBeenLastCalledWith('prepare_return_refund_preview',expect.objectContaining({p_actor_id:actor,p_workspace_id:ws,p_case_id:id,p_receipt_id:event,p_id:op,p_preview:preview}));
 });
 it('rejects a stale receipt before consulting the provider',async()=>{
  await expect(prepareReturnRefund(db,ws,actor,id,{...input,receipt_id:actor})).rejects.toMatchObject({code:'changed'});expect(m.snapshot).not.toHaveBeenCalled();
 });
 it('shares a current actor/business budget across callers before a provider read',async()=>{
  m.limit.mockResolvedValue({success:false});await expect(prepareReturnRefund(db,ws,actor,id,input)).rejects.toMatchObject({code:'limited'});expect(m.snapshot).not.toHaveBeenCalled();expect(m.limit).toHaveBeenCalledExactlyOnceWith(`return-refund-preview:${ws}:${actor}`,{limit:30,windowMs:60000});
 });
 it.each([['readOnly',new BillingReadOnlyError()],['unavailable',new Error('SECRET_DB')]] as const)('denies %s before provider reads',async(code,error)=>{
  m.billing.mockRejectedValue(error);await expect(prepareReturnRefund(db,ws,actor,id,input)).rejects.toMatchObject({code});expect(m.snapshot).not.toHaveBeenCalled();
 });
 it.each(['return_refund_pending','return_refund_changed','return_not_found','PRIVATE_SQL'])('maps current transactional %s without exposing database detail',async message=>{
  m.rpc.mockImplementation(async name=>name==='read_return_refund_context'?{data:context,error:null}:{data:null,error:{message}});
  await expect(prepareReturnRefund(db,ws,actor,id,input)).rejects.toMatchObject({code:{return_refund_pending:'pending',return_refund_changed:'changed',return_not_found:'notFound'}[message]??'unavailable'});
 });
 it('does not prepare when a balance/provider read fails or has no available paid amount',async()=>{
  m.snapshot.mockRejectedValueOnce(Error('PRIVATE_PROVIDER'));await expect(prepareReturnRefund(db,ws,actor,id,input)).rejects.toMatchObject({code:'unavailable'});
  m.snapshot.mockResolvedValueOnce({preview:{...preview,amount:'0.00'},fingerprint:'a'.repeat(64)});await expect(prepareReturnRefund(db,ws,actor,id,input)).rejects.toMatchObject({code:'unavailable'});expect(m.rpc.mock.calls.every(call=>call[0]==='read_return_refund_context')).toBe(true);
 });
 it('strips raw provider/customer fields from the successful DTO',async()=>{
  m.rpc.mockImplementation(async name=>({data:name==='read_return_refund_context'?context:{...stored,operation:{...stored.operation,result:{customer:'PRIVATE'},preview:{...stored.operation.preview,provider_secret:'SECRET'}}},error:null}));
  const result=await prepareReturnRefund(db,ws,actor,id,input);expect(JSON.stringify(result)).not.toMatch(/PRIVATE|SECRET|workspace_id|requested_by/);
 });
 it('rejects mismatched stored receipt, actor, scope, reviewed amount or action',async()=>{
  for(const patch of [{requested_by:conv},{order_id:conv},{workspace_id:conv},{action:{...stored.operation.action,amount:30}},{preview:{...stored.operation.preview,amount:'30.00'}},{preview:{...stored.operation.preview,return_receipt:{...stored.operation.preview.return_receipt,receipt_id:actor}}}]){
   m.rpc.mockImplementation(async name=>({data:name==='read_return_refund_context'?context:{...stored,operation:{...stored.operation,...patch}},error:null}));await expect(prepareReturnRefund(db,ws,actor,id,input)).rejects.toMatchObject({code:'unavailable'});
  }
 });
 it('rejects identity/credential overrides and inexact monetary input before reading',async()=>{
  for(const raw of [{...input,actor_id:actor},{...input,workspace_id:ws},{...input,token:'SECRET'},{...input,amount:0},{...input,amount:0.0000001},{...input,amount:Infinity}])expect(returnRefundInput.safeParse(raw).success).toBe(false);
  await expect(prepareReturnRefund(db,ws,actor,'foreign',input)).rejects.toMatchObject({code:'invalid'});expect(m.rpc).not.toHaveBeenCalled();
 });
 it('does not accept a foreign or expanded context DTO',async()=>{
  for(const data of [{...context,case_id:actor},{...context,secret:'PRIVATE'}]){m.rpc.mockResolvedValueOnce({data,error:null});await expect(readReturnRefundContext(db,ws,actor,id)).rejects.toMatchObject({code:'unavailable'});}
 });
});
