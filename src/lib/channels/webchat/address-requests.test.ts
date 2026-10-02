import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({snapshot:vi.fn(),writable:vi.fn(),limit:vi.fn()}));
vi.mock('@/lib/inbox/order-actions',()=>({caseOrderSnapshot:h.snapshot}));
vi.mock('@/lib/billing/read-only',()=>({assertWorkspaceWritable:h.writable}));
vi.mock('@/lib/rate-limit',()=>({limitByKey:h.limit}));
import { reserveAddressRequest, readAddressRequestReceipt, prepareCaseAddressRequest } from './address-requests';
import { addressRequestInput, addressRequestReceipt, addressRequestMessage } from './address-request-contract';
const ws='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
const connection='44444444-4444-4444-8444-444444444444',order='55555555-5555-4555-8555-555555555555',conv='66666666-6666-4666-8666-666666666666';
const contact='77777777-7777-4777-8777-777777777777',op='88888888-8888-4888-8888-888888888888';
const address={address1:'42 Example',address2:'',city:'Example',province:'',zip:'',countryCode:'US'};
const session={workspaceId:ws,visitorId:'signed',origin:'https://synthetic.example',exp:Date.now()+60000};
const input={id,order_id:order,address,confirmed:true as const,locale:'es' as const};
const received={id,reference:'#42',created_at:'2026-10-01T12:00:00Z',status:'waiting_review' as const,confirmed_at:null,superseded:false};
function database(){
 const rpc=vi.fn<(name:string,args?:Record<string,unknown>)=>Promise<{data:unknown;error:{message:string}|null}>>(async(name:string)=>({data:name==='webchat_address_visitor_contact'?contact:name==='read_case_address_requests'?{requests:[{id,order_id:order,contact_id:contact,conversation_id:conv,reference:'#42',address,created_at:received.created_at}]}:name==='prepare_webchat_address_preview'?null:received,error:null}));
 const query={select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn(async()=>({data:{order_number:'#42'},error:null}))};query.select.mockReturnValue(query);query.eq.mockReturnValue(query);
 const from=vi.fn(()=>query);return{rpc,query,from,db:{rpc,from} as unknown as SupabaseClient};
}
beforeEach(()=>{vi.clearAllMocks();h.writable.mockResolvedValue(undefined);h.limit.mockResolvedValue({success:true});h.snapshot.mockResolvedValue({preview:{shipping_change:{after:address}},fingerprint:'a'.repeat(64)});});
describe('Customer address contracts and services',()=>{
 it.each(['actor_id','workspace_id','source_message_id','amount','approved_by'])('rejects client authority field %s',field=>{expect(addressRequestInput.safeParse({...input,[field]:actor}).success).toBe(false);});
 it.each([{...address,phone:'secret'},{...address,countryCode:'ZZ'},{...address,address1:'bad\ntext'},{...address,city:''}])('rejects invalid or recipient-changing address %j',body=>{expect(addressRequestInput.safeParse({...input,address:body}).success).toBe(false);});
 it('requires explicit consent and coherent verified timestamps',()=>{expect(addressRequestInput.safeParse({...input,confirmed:false}).success).toBe(false);expect(addressRequestReceipt.safeParse({...received,status:'confirmed'}).success).toBe(false);expect(addressRequestReceipt.safeParse({...received,confirmed_at:received.created_at}).success).toBe(false);});
 it.each(['es','en'] as const)('generates a stable quoted customer request in %s',locale=>{expect(addressRequestMessage(locale,'#42',address)).toContain('"#42"');expect(addressRequestMessage(locale,'#42',address)).toContain(JSON.stringify(address));});
 it('reserves against the exact signed contact and order without a provider read',async()=>{
  const d=database();await reserveAddressRequest(d.db,session,connection,input);expect(d.query.eq).toHaveBeenCalledWith('contact_id',contact);expect(d.query.eq).toHaveBeenCalledWith('workspace_id',ws);
  expect(d.rpc).toHaveBeenCalledWith('reserve_webchat_address_request',expect.objectContaining({p_visitor_id:'signed',p_connection_id:connection,p_address:address,p_order_id:order}));expect(h.snapshot).not.toHaveBeenCalled();
 });
 it('never trusts a malformed or foreign public receipt',async()=>{const d=database();d.rpc.mockResolvedValueOnce({data:{...received,id:actor},error:null});await expect(readAddressRequestReceipt(d.db,session,connection,id)).rejects.toThrow('unavailable');});
 it('prepares through the existing verified snapshot using the actual human actor',async()=>{
  const d=database();d.rpc.mockImplementation(async(name:string,args?:Record<string,unknown>)=>({data:name==='read_case_address_requests'?{requests:[{id,order_id:order,contact_id:contact,conversation_id:conv,reference:'#42',address,created_at:received.created_at}]}:args?.p_preview?{operation_id:op,order_id:order,request_id:id}:null,error:null}));
  expect(await prepareCaseAddressRequest(d.db,ws,actor,conv,order,{id:op,request_id:id})).toMatchObject({operation_id:op});
  expect(h.snapshot).toHaveBeenCalledWith(d.db,ws,contact,order,{type:'address',address,reason:'webchat_address_request'});
  expect(d.rpc).toHaveBeenLastCalledWith('prepare_webchat_address_preview',expect.objectContaining({p_actor_id:actor,p_conversation_id:conv,p_id:op}));
 });
 it('recovers the exact old preview without another provider read or writable check',async()=>{
  const d=database();const base=d.rpc.getMockImplementation()!;d.rpc.mockImplementation(async(name:string)=>name==='prepare_webchat_address_preview'?{data:{operation_id:op,order_id:order,request_id:id},error:null}:base(name));
  await prepareCaseAddressRequest(d.db,ws,actor,conv,order,{id:op,request_id:id});expect(h.snapshot).not.toHaveBeenCalled();expect(h.writable).not.toHaveBeenCalled();
 });
 it('rejects a request belonging to another order before a provider read',async()=>{
  const d=database();d.rpc.mockResolvedValueOnce({data:{requests:[{id,order_id:actor,contact_id:contact,conversation_id:conv,reference:'#42',address,created_at:received.created_at}]},error:null});
  await expect(prepareCaseAddressRequest(d.db,ws,actor,conv,order,{id:op,request_id:id})).rejects.toThrow('unavailable');expect(h.snapshot).not.toHaveBeenCalled();
 });
 it('billing and rate failures do not prepare or execute a provider write',async()=>{
  const d=database();h.writable.mockRejectedValue(new Error('read only'));await expect(prepareCaseAddressRequest(d.db,ws,actor,conv,order,{id:op,request_id:id})).rejects.toThrow('readOnly');expect(h.snapshot).not.toHaveBeenCalled();
  h.writable.mockResolvedValue(undefined);h.limit.mockResolvedValue({success:false});await expect(prepareCaseAddressRequest(d.db,ws,actor,conv,order,{id:op,request_id:id})).rejects.toThrow('limited');expect(h.snapshot).not.toHaveBeenCalled();
 });
});
