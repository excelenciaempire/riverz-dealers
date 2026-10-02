import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {encrypt} from '@/lib/channels/encryption';
import {createNativeSubscriptionService} from './subscription-service';
import type {NativeSubscriptionReceipt} from './subscription-ui-contract';
const flag=vi.hoisted(()=>({enabled:true}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return flag.enabled;}}));
vi.mock('@/lib/shopify/token-vivo',()=>({COLUMNAS_TOKEN:'id,shop_domain,access_token',tokenVivo:vi.fn(async()=>({accessToken:'fictional-shopify-key',renovado:false}))}));
vi.mock('@/lib/shopify/oauth',()=>({shopifyApiVersion:()=> '2026-07'}));
const ws='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',connection='33333333-3333-4333-8333-333333333333',attempt='55555555-5555-4555-8555-555555555555',shop='66666666-6666-4666-8666-666666666666',revision='88888888-8888-4888-8888-888888888888',conversation='99999999-9999-4999-8999-999999999999',order='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',contact='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',domain='fixture-store.myshopify.com';
const context={conversationId:conversation,orderId:order,contactId:contact,providerOrderId:'444',shopDomain:domain,contactUpdatedAt:'2026-10-02T10:00:00Z',orderUpdatedAt:'2026-10-02T10:00:00Z',email:'customer@example.invalid',phone:null};
const initial={id:111,customer_id:22,address_id:33,status:'active',quantity:2,price:'12.50',external_product_id:{ecommerce:'444'},external_variant_id:{ecommerce:'555'},product_title:'Product',variant_title:null,order_interval_frequency:1,charge_interval_frequency:'1',order_interval_unit:'month',next_charge_scheduled_at:'2026-10-20',is_prepaid:false,is_skippable:true,updated_at:'2026-10-02T10:00:00Z',cancellation_reason:null,cancellation_reason_comments:null,cancelled_at:null};
const read=vi.fn<typeof fetch>(),rpc=vi.fn(),from=vi.fn();
let row:Record<string,unknown>,raw=structuredClone(initial),saved:NativeSubscriptionReceipt|null=null,nonce='',scopes:string[],storeId:number,identifier:string,externalId:string,customerEmail:string,selectedShopId:string,claimed:boolean,claimRpcError:boolean,lostAck:boolean,wrongAck:boolean,updateProvider:boolean,cacheBlocked:boolean,readbackUnavailable:boolean,configured:boolean;
const db={rpc,from} as unknown as SupabaseClient;
const service=()=>createNativeSubscriptionService(db,read);
const caseInput={conversationId:conversation,orderId:order};
const change={type:'quantity' as const,quantity:3};
const writes=()=>read.mock.calls.filter(([,init])=>init?.method==='POST'||init?.method==='PUT');
const settingsInput={shopifyConnectionId:shop,shopDomain:domain,storeId:7,identifier:'store-id',enabled:true,dailyChanges:50,confirmedStoreMapping:true as const};
function settings(){return configured?{configured:true,connectionId:connection,shopifyConnectionId:shop,shopDomain:domain,storeId:7,identifier:'store-id',revision,enabled:row.enabled,dailyChanges:50,stores:[{id:shop,shopDomain:domain}]}:{configured:false,enabled:false,stores:[{id:shop,shopDomain:domain}]};}
beforeEach(()=>{
 flag.enabled=true;raw=structuredClone(initial);saved=null;nonce='';scopes=['read_store','read_customers','read_subscriptions','write_subscriptions'];storeId=7;identifier='store-id';externalId='999';customerEmail=context.email;selectedShopId=shop;claimed=true;claimRpcError=false;lostAck=false;wrongAck=false;updateProvider=true;cacheBlocked=false;readbackUnavailable=false;configured=true;
 row={id:connection,workspace_id:ws,shopify_connection_id:shop,shop_domain:domain,recharge_store_id:7,identifier:'store-id',encrypted_key:encrypt('fictional-recharge-key'),revision,enabled:true,daily_changes:50,confirmed_store_mapping:true};
 read.mockReset().mockImplementation(async(url,init)=>{
  const path=new URL(String(url)).pathname;
  if(String(url).startsWith(`https://${domain}`))return Response.json(path.includes('/orders/')?{order:{id:444,customer:{id:999}}}:{customer:{id:999,email:customerEmail,phone:null}});
  if(path==='/store')return Response.json({store:{id:storeId,external_platform:'shopify',identifier}});
  if(path==='/token_information')return Response.json({token_information:{scopes}});
  if(path==='/customers')return Response.json({customers:[{id:22,external_customer_id:{ecommerce:externalId},email:'private@example.invalid'}]});
  if(path==='/customers/22')return Response.json({customer:{id:22,external_customer_id:{ecommerce:externalId}}});
  if(path==='/subscriptions')return Response.json({subscriptions:[raw]});
  if(path==='/customers/22/delivery_schedule')return Response.json({deliverySchedule:{customer:{id:22},deliveries:[]}});
  if(init?.method==='PUT'){
   if(updateProvider)raw={...raw,quantity:JSON.parse(String(init.body)).quantity};
   if(lostAck)throw new Error('PRIVATE_PROVIDER_TOKEN');return Response.json(wrongAck?{subscription:{...raw,id:112}}:{subscription:raw});
  }
  if(path==='/subscriptions/111'){if(readbackUnavailable)throw new Error('private');return Response.json({subscription:raw});}
  throw new Error('unhandled fictional request');
 });
 rpc.mockReset().mockImplementation(async(name,args)=>{
  if(name==='native_subscriptions_settings_read')return {data:settings(),error:null};
  if(name==='native_subscriptions_private_connection')return {data:row,error:null};
  if(name==='native_subscriptions_case_context')return {data:context,error:null};
  if(name==='cache_native_case_subscriptions')return {data:args.p_rows.map((item:{subscription:unknown;snapshot:string})=>({subscription:item.subscription,snapshot:item.snapshot,blocked:cacheBlocked,ownAttemptId:null})),error:null};
  if(name==='native_subscription_action_receipt')return {data:saved,error:null};
  if(name==='review_native_subscription_action'){
   const cached=rpc.mock.calls.filter(([key])=>key==='cache_native_case_subscriptions').at(-1)?.[1].p_rows[0];nonce=args.p_nonce;
   saved={attemptId:args.p_attempt_id,connectionId:connection,revision,snapshot:args.p_snapshot,conversationId:conversation,orderId:order,subscriptionId:111,change:args.p_change,before:cached.subscription,state:'reviewed',providerAccepted:false,desiredStateObserved:false,causalityVerified:false,emailRequested:false,createdAt:'2026-10-02T10:00:00Z',updatedAt:'2026-10-02T10:00:00Z'};
   return {data:{claimed:true,attemptId:attempt,nonce},error:null};
  }
  if(name==='claim_native_subscription_action'){if(saved&&claimed)saved.state='dispatching';if(claimRpcError)return {data:null,error:{message:'private transport'}};return {data:claimed,error:null};}
  if(name==='finish_native_subscription_action'){
   if(!saved)return {data:false,error:null};
   saved.providerAccepted=saved.providerAccepted||args.p_provider_accepted;
   saved.state=args.p_outcome==='observed'&&!saved.providerAccepted?'uncertain':args.p_outcome;
   saved.desiredStateObserved=saved.desiredStateObserved||args.p_outcome==='observed';return {data:true,error:null};
  }
  if(name==='native_subscription_action_private')return {data:{nonce,snapshot:saved?.snapshot,shopifyCustomerId:'999',deliveries:[],revision},error:null};
  if(name==='set_native_subscriptions_settings'){row={...row,encrypted_key:args.p_encrypted_key,enabled:args.p_enabled};configured=true;return {data:settings(),error:null};}
  throw new Error('unhandled fictional rpc');
 });
 from.mockReset().mockImplementation(()=>{const query={select:vi.fn(()=>query),eq:vi.fn(()=>query),maybeSingle:vi.fn(async()=>({data:{id:selectedShopId,shop_domain:domain,access_token:'private',workspace_id:ws,status:'active',platform:'shopify'},error:null}))};return query;});
});
async function prepared(){const quote=await service().preview(ws,actor,{...caseInput,subscriptionId:111,change});return {...caseInput,attemptId:attempt,connectionId:quote.connectionId,revision:quote.revision,subscriptionId:111,snapshot:quote.snapshot,change,confirmed:true as const,reviewedBillingEffects:true as const};}
describe('Native Recharge service, fictional databases and providers only',()=>{
 it('does nothing when public improvement flag is off',async()=>{flag.enabled=false;await expect(service().page(ws,actor,caseInput)).rejects.toMatchObject({code:'notAllowed'});expect(read).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();});
 it('exposes only current subscription fields and case binding',async()=>{const page=await service().page(ws,actor,caseInput);expect(page).toMatchObject({configured:true,complete:true,customerId:22,rows:[{subscription:{id:111,customerId:22,addressId:33},blocked:false}]});expect(JSON.stringify(page)).not.toMatch(/customer@example|private@example|encrypted|fictional-recharge-key/);expect(writes()).toHaveLength(0);});
 it('selects the exact installed Shopify connection and verifies the current customer',async()=>{await service().page(ws,actor,caseInput);const query=from.mock.results[0].value;expect(query.eq).toHaveBeenCalledWith('id',shop);expect(query.eq).toHaveBeenCalledWith('workspace_id',ws);expect(read.mock.calls.map(([url])=>String(url))).toContain(`https://${domain}/admin/api/2026-07/customers/999.json?fields=id,email,phone`);});
 it.each(['store','identifier','external','contact','shop','scope'] as const)('rejects mismatched current %s evidence before any provider write',async reason=>{if(reason==='store')storeId=8;if(reason==='identifier')identifier='another-store';if(reason==='external')externalId='998';if(reason==='contact')customerEmail='different@example.invalid';if(reason==='shop')selectedShopId=attempt;if(reason==='scope')scopes=['read_store'];await expect(service().page(ws,actor,caseInput)).rejects.toMatchObject({code:'notAllowed'});expect(writes()).toHaveLength(0);});
 it('requires current write scope for review but does not require it to read subscriptions',async()=>{scopes=scopes.filter(value=>value!=='write_subscriptions');await service().page(ws,actor,caseInput);await expect(service().preview(ws,actor,{...caseInput,subscriptionId:111,change})).rejects.toMatchObject({code:'notAllowed'});expect(writes()).toHaveLength(0);});
 it('produces exact before/after review with no provider mutation',async()=>{const quote=await service().preview(ws,actor,{...caseInput,subscriptionId:111,change});expect(quote).toMatchObject({before:{quantity:2,price:'12.50'},change:{type:'quantity',quantity:3},otherChargeItems:0,shopDomain:domain});expect(writes()).toHaveLength(0);});
 it('rejects a blocked subscription before creating another attempt',async()=>{cacheBlocked=true;await expect(service().preview(ws,actor,{...caseInput,subscriptionId:111,change})).rejects.toMatchObject({code:'notAllowed'});expect(rpc.mock.calls.some(([name])=>name==='review_native_subscription_action')).toBe(false);});
 it('rechecks the exact live state and cancels only the unclaimed attempt for a changed quote',async()=>{const body=await prepared();raw={...raw,quantity:4};await expect(service().execute(ws,actor,body)).rejects.toMatchObject({code:'notAllowed'});expect(writes()).toHaveLength(0);expect(saved).toMatchObject({state:'canceled'});});
 it.each([{confirmed:false},{reviewedBillingEffects:false},{change:{type:'quantity',quantity:3,price:0}}])('rejects changed or missing human confirmation',async patch=>{const body=await prepared();read.mockClear();rpc.mockClear();await expect(service().execute(ws,actor,{...body,...patch})).rejects.toMatchObject({code:'invalid'});expect(read).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();});
 it('claims once, then reports acceptance and separately observed desired state',async()=>{const body=await prepared();const result=await service().execute(ws,actor,body);expect(result.receipt).toMatchObject({state:'observed',providerAccepted:true,desiredStateObserved:true,causalityVerified:false,emailRequested:false});expect(writes()).toHaveLength(1);expect(rpc.mock.calls.filter(([name])=>name==='claim_native_subscription_action')).toHaveLength(1);});
 it('does not confuse accepted HTTP result with the requested state',async()=>{const body=await prepared();updateProvider=false;const result=await service().execute(ws,actor,body);expect(result.receipt).toMatchObject({state:'accepted',providerAccepted:true,desiredStateObserved:false});expect(writes()).toHaveLength(1);});
 it('preserves a known acknowledgement when readback is unavailable',async()=>{const body=await prepared();readbackUnavailable=true;const result=await service().execute(ws,actor,body);expect(result.receipt).toMatchObject({state:'accepted',providerAccepted:true,desiredStateObserved:false});expect(writes()).toHaveLength(1);});
 it('recovers an exact replay from its receipt without a second provider call',async()=>{const body=await prepared();await service().execute(ws,actor,body);read.mockClear();const result=await service().execute(ws,actor,body);expect(result.recovered).toBe(true);expect(read).not.toHaveBeenCalled();});
 it('rejects attempt-ID reuse with changed billing values',async()=>{const body=await prepared();await service().execute(ws,actor,body);read.mockClear();await expect(service().execute(ws,actor,{...body,change:{type:'quantity',quantity:4}})).rejects.toMatchObject({code:'notAllowed'});expect(read).not.toHaveBeenCalled();});
 it('a denied claim cancels only the provably unclaimed attempt and sends nothing',async()=>{const body=await prepared();claimed=false;await expect(service().execute(ws,actor,body)).rejects.toMatchObject({code:'notAllowed'});expect(writes()).toHaveLength(0);expect(saved).toMatchObject({state:'canceled'});});
 it('a lost claim acknowledgement stays uncertain without an external provider write',async()=>{const body=await prepared();claimRpcError=true;await expect(service().execute(ws,actor,body)).rejects.toMatchObject({code:'uncertain'});expect(writes()).toHaveLength(0);expect(saved).toMatchObject({state:'uncertain'});});
 it.each(['lost','wrong'] as const)('retains %s mutation acknowledgement as uncertainty and recovers only by GET',async problem=>{const body=await prepared();lostAck=problem==='lost';wrongAck=problem==='wrong';await expect(service().execute(ws,actor,body)).rejects.toMatchObject({code:'uncertain'});expect(saved).toMatchObject({state:'uncertain',providerAccepted:false});expect(writes()).toHaveLength(1);const result=await service().reconcile(ws,actor,attempt);expect(result).toMatchObject({state:'uncertain',providerAccepted:false,desiredStateObserved:true,causalityVerified:false});expect(writes()).toHaveLength(1);});
 it('does not reconcile an in-flight provider call or release its claim',async()=>{const body=await prepared();await service().execute(ws,actor,body);if(!saved)throw new Error('fixture');saved.state='dispatching';saved.providerAccepted=false;read.mockClear();expect(await service().reconcile(ws,actor,attempt)).toMatchObject({state:'dispatching'});expect(read).not.toHaveBeenCalled();});
 it('does not guess another provider customer during uncertainty recovery',async()=>{const body=await prepared();lostAck=true;await expect(service().execute(ws,actor,body)).rejects.toMatchObject({code:'uncertain'});externalId='998';await expect(service().reconcile(ws,actor,attempt)).rejects.toMatchObject({code:'notAllowed'});expect(writes()).toHaveLength(1);});
 it('stops settings without decrypting an unreadable stored credential',async()=>{row.encrypted_key='x'.repeat(80);const result=await service().saveSettings(ws,actor,{...settingsInput,enabled:false});expect(result).toMatchObject({enabled:false});expect(read).not.toHaveBeenCalled();const args=rpc.mock.calls.find(([name])=>name==='set_native_subscriptions_settings')?.[1];expect(args.p_encrypted_key).toBe('x'.repeat(80));});
 it('never validates an installation by billing or canceling a real subscription',async()=>{configured=false;await service().saveSettings(ws,actor,{...settingsInput,key:'fictional-recharge-key'});expect(read.mock.calls.map(([url])=>new URL(String(url)).pathname)).toEqual(['/store','/token_information']);expect(writes()).toHaveLength(0);});
 it('rejects a forged or changed installation before provider validation',async()=>{await expect(service().saveSettings(ws,actor,{...settingsInput,storeId:8,key:'fictional-recharge-key'})).rejects.toMatchObject({code:'notAllowed'});expect(read).not.toHaveBeenCalled();});
});
