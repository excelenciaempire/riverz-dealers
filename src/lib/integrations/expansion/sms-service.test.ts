import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {generateKeyPairSync,sign} from 'node:crypto';
vi.mock('@/lib/ui/improvements-preview',()=>({SHOW_RIVERZ_IMPROVEMENTS:true}));
vi.mock('@/lib/channels/encryption',()=>({encrypt:(value:string)=>'encrypted:'+value,decrypt:(value:string)=>value.replace(/^encrypted:/,'')}));
import {createNativeSmsService} from './sms-service';
import type {NativeSmsReceipt} from './sms-ui-contract';
const ws='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',connection='33333333-3333-4333-8333-333333333333',attempt='55555555-5555-4555-8555-555555555555',contact='66666666-6666-4666-8666-666666666666',conversation='88888888-8888-4888-8888-888888888888',revision='99999999-9999-4999-8999-999999999999',profile='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',organization='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',messageId='cccccccc-cccc-4ccc-8ccc-cccccccccccc',eventId='dddddddd-dddd-4ddd-8ddd-dddddddddddd',peer='+573001234567',phone='+12025550100';
const {privateKey,publicKey}=generateKeyPairSync('ed25519');const signingKey=publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64');
const identity={phoneNumberId:'1293384261075731499',phone,profileId:profile,organizationId:organization};
const stored={connection_id:connection,workspace_id:ws,phone_number_id:identity.phoneNumberId,phone,profile_id:profile,organization_id:organization,encrypted_key:'encrypted:FIXTURE_PRIVATE_SMS_KEY',public_key:signingKey,revision,enabled:true,max_segments:3,daily_segments:100};
const settings={configured:true,connectionId:connection,revision,...identity,enabled:true,maxSegments:3,dailySegments:100};
const input={attemptId:attempt,conversationId:conversation,contactId:contact,connectionId:connection,revision,peer,text:'Fixture approved message',confirmed:true};
const prototypeReceipt:NativeSmsReceipt={attemptId:attempt,conversationId:conversation,contactId:contact,peer,text:input.text,segments:1,state:'reviewed',providerStatus:null,providerParts:null,cost:null,deliveryConfirmed:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
let localReceipt:typeof prototypeReceipt|null=null;
const rpc=vi.fn(),read=vi.fn<typeof fetch>();const db={rpc} as unknown as SupabaseClient;
beforeEach(()=>{
 localReceipt=null;
 rpc.mockReset().mockImplementation(async(name:string,params:Record<string,unknown>)=>{
  if(name==='native_sms_receipt')return {data:localReceipt,error:null};
  if(name==='native_sms_settings_read')return {data:settings,error:null};
  if(name==='native_sms_private_connection')return {data:stored,error:null};
  if(name==='set_native_sms_settings')return {data:{...settings,enabled:params.p_enabled},error:null};
  if(name==='review_native_sms_send'){if(localReceipt)return {data:{claimed:false,receipt:localReceipt},error:null};localReceipt={...prototypeReceipt};return {data:{claimed:true,attemptId:attempt,nonce:params.p_nonce},error:null};}
  if(name==='claim_native_sms_send'){localReceipt={...prototypeReceipt,state:'dispatching'};return {data:true,error:null};}
  if(name==='finish_native_sms_send'){localReceipt={...prototypeReceipt,state:params.p_outcome as NativeSmsReceipt['state'],providerStatus:params.p_status===undefined?null:params.p_status as NativeSmsReceipt['providerStatus'],providerParts:params.p_parts===undefined?null:Number(params.p_parts)};return {data:true,error:null};}
  if(name==='enqueue_native_sms_event')return {data:true,error:null};
  throw new Error('Unexpected fixture RPC '+name);
 });
 read.mockReset().mockImplementation(async(url,init)=>{
  const path=new URL(String(url)).pathname;
  if(path.includes('phone_numbers'))return Response.json({data:{id:identity.phoneNumberId,phone_number:phone,organization_id:organization,messaging_profile_id:profile,country_code:'US',features:{sms:{domestic_two_way:true,international_inbound:true,international_outbound:true}}}});
  if(path.includes('messaging_profiles'))return Response.json({data:{id:profile,organization_id:organization,enabled:true,webhook_api_version:'2',whitelisted_destinations:['*'],mobile_only:false,daily_spend_limit_enabled:true}});
  if(path.includes('messaging_optouts'))return Response.json({data:[],meta:{page_number:1,total_pages:0}});
  if(path==='/v2/messages'&&init?.method==='POST')return Response.json({data:{id:messageId,direction:'outbound',type:'SMS',organization_id:organization,messaging_profile_id:profile,from:{phone_number:phone},to:[{phone_number:peer,status:'queued'}],parts:1,cost:null}});
  throw new Error('Unexpected fixture provider path');
 });
});
const service=()=>createNativeSmsService(db,read);
describe('Native SMS orchestration, fixtures only',()=>{
 it('requeues inbox ingestion through current database authority without accessing provider credentials or sending',async()=>{
  rpc.mockResolvedValueOnce({data:2,error:null});expect(await service().retryInbox(ws,actor,connection)).toEqual({queued:2});
  expect(rpc).toHaveBeenCalledExactlyOnceWith('retry_native_sms_inbox',{p_workspace_id:ws,p_actor_id:actor,p_connection_id:connection,p_limit:20});expect(read).not.toHaveBeenCalled();
 });
 it('rejects unauthorized inbox retries and invalid queue counts without provider requests',async()=>{
  rpc.mockResolvedValueOnce({data:null,error:{message:'expansion_not_allowed'}});await expect(service().retryInbox(ws,actor,connection)).rejects.toMatchObject({code:'notAllowed'});
  for(const count of [-1,21,'2']){rpc.mockResolvedValueOnce({data:count,error:null});await expect(service().retryInbox(ws,actor,connection)).rejects.toMatchObject({code:'unavailable'});}expect(read).not.toHaveBeenCalled();
 });
 it('performs one current provider preflight and one durably claimed POST, preserving queued/unknown cost',async()=>{
  expect(await service().send(ws,actor,input)).toMatchObject({recovered:false,receipt:{state:'accepted',providerStatus:'queued',cost:null,deliveryConfirmed:false}});
  expect(read.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
  const calls=rpc.mock.calls.map(([name])=>name);expect(calls.indexOf('review_native_sms_send')).toBeLessThan(calls.indexOf('claim_native_sms_send'));expect(calls.indexOf('claim_native_sms_send')).toBeLessThan(calls.indexOf('finish_native_sms_send'));
 });
 it('recovers an accepted/uncertain attempt with no provider request or second durable claim',async()=>{for(const state of ['accepted','uncertain'] as const){localReceipt={...prototypeReceipt,state};expect(await service().send(ws,actor,input)).toMatchObject({recovered:true,receipt:{state}});}expect(read).not.toHaveBeenCalled();expect(rpc.mock.calls.some(([name])=>name==='claim_native_sms_send')).toBe(false);});
 it('blocks changed recovery payload before any provider request',async()=>{localReceipt={...prototypeReceipt,state:'accepted'};await expect(service().send(ws,actor,{...input,text:'Other text'})).rejects.toMatchObject({code:'notAllowed'});expect(read).not.toHaveBeenCalled();});
 it('rejects unreviewed sends and multipart overflow before creating an attempt',async()=>{await expect(service().send(ws,actor,{...input,confirmed:false})).rejects.toMatchObject({code:'invalid'});await expect(service().send(ws,actor,{...input,text:'🙂'.repeat(400)})).rejects.toMatchObject({code:'invalid'});expect(rpc).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();});
 it('cancels a proven preflight rejection without calling the provider POST',async()=>{
  const original=rpc.getMockImplementation()!;rpc.mockImplementation(async(name,params)=>name==='claim_native_sms_send'?{data:false,error:null}:original(name,params));
  await expect(service().send(ws,actor,input)).rejects.toMatchObject({code:'notAllowed'});expect(read.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);expect(rpc.mock.calls.find(([name])=>name==='finish_native_sms_send')?.[1]).toMatchObject({p_outcome:'canceled'});
 });
 it('marks a lost database claim response as uncertain, never cancels or sends a provider POST',async()=>{
  const original=rpc.getMockImplementation()!;rpc.mockImplementation(async(name,params)=>{if(name==='claim_native_sms_send'){localReceipt={...prototypeReceipt,state:'dispatching'};return {data:null,error:{message:'PRIVATE_DATABASE_CLAIM_RESPONSE_LOST'}};}return original(name,params);});
  await expect(service().send(ws,actor,input)).rejects.toMatchObject({code:'uncertain'});expect(read.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);expect(rpc.mock.calls.find(([name])=>name==='finish_native_sms_send')?.[1]).toMatchObject({p_outcome:'uncertain'});
 });
 it('does not retry a provider timeout and preserves durable uncertainty for recovery',async()=>{
  const original=read.getMockImplementation()!;read.mockImplementation(async(url,init)=>{if(init?.method==='POST')throw new Error('PRIVATE_PROVIDER_TIMEOUT');return original(url,init);});
  await expect(service().send(ws,actor,input)).rejects.toMatchObject({code:'uncertain'});expect(read.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
  expect(await service().send(ws,actor,input)).toMatchObject({recovered:true,receipt:{state:'uncertain'}});expect(read.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
 });
 it('checks installation permission before reading keys or contacting the provider',async()=>{
  rpc.mockResolvedValue({data:null,error:{message:'expansion_not_allowed'}});await expect(service().saveSettings(ws,actor,{identity,enabled:true,maxSegments:3,dailySegments:100})).rejects.toMatchObject({code:'notAllowed'});expect(read).not.toHaveBeenCalled();expect(rpc).toHaveBeenCalledTimes(1);
 });
 it('can disable a configured connection without any provider request or returning its key',async()=>{
  const result=await service().saveSettings(ws,actor,{identity,enabled:false,maxSegments:3,dailySegments:100});expect(result).toMatchObject({enabled:false});expect(read).not.toHaveBeenCalled();expect(JSON.stringify(result)).not.toContain('PRIVATE_SMS_KEY');expect(rpc.mock.calls.find(([name])=>name==='set_native_sms_settings')?.[1]).toMatchObject({p_encrypted_key:'encrypted:FIXTURE_PRIVATE_SMS_KEY'});
 });
 it('accepts an exact signed account event only after durable queue persistence',async()=>{
  const timestamp=String(Math.floor(Date.now()/1000)),raw=Buffer.from(JSON.stringify({data:{id:eventId,event_type:'message.received',occurred_at:new Date().toISOString(),payload:{id:messageId,type:'SMS',direction:'inbound',organization_id:organization,messaging_profile_id:profile,from:{phone_number:peer},to:[{phone_number:phone}],text:'Fixture inbound',parts:1,cost:null}}}));
  const signature=sign(null,Buffer.concat([Buffer.from(timestamp+'|'),raw]),privateKey).toString('base64');expect(await service().webhook(connection,raw,signature,timestamp)).toEqual({persisted:true,duplicate:false});expect(rpc.mock.calls.at(-1)?.[0]).toBe('enqueue_native_sms_event');expect(read).not.toHaveBeenCalled();
 });
 it('does not persist a forged webhook body',async()=>{await expect(service().webhook(connection,Buffer.from('{}'),'invalid',String(Math.floor(Date.now()/1000)))).rejects.toMatchObject({code:'invalid'});expect(rpc.mock.calls.some(([name])=>name==='enqueue_native_sms_event')).toBe(false);});
});
