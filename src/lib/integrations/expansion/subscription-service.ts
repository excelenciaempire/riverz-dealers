import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {z} from 'zod';
import {encrypt,decrypt} from '@/lib/channels/encryption';
import {COLUMNAS_TOKEN,tokenVivo} from '@/lib/shopify/token-vivo';
import {shopifyApiVersion} from '@/lib/shopify/oauth';
import {normPhone} from '@/lib/attribution/shopify';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {createRechargeClient,subscriptionSkipObserved,type SubscriptionDelivery,type SubscriptionCharge} from './recharge-client';
import {ExpansionProviderError,privateProviderSecret} from './provider-http';
import {rechargeId,shopifyCustomerId,subscriptionSettings,subscriptionSettingsInput,subscriptionCaseInput,subscriptionCaseRow,subscriptionCasePage,subscriptionPreviewInput,subscriptionPreview,subscriptionActionInput,subscriptionActionReceipt,subscriptionPending,subscriptionChangeObserved,type SubscriptionChange,type NativeSubscriptionReceipt,type NativeSubscription} from './subscription-ui-contract';

const uuid=z.string().uuid(),shop=z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/);
const connectionSchema=z.object({id:uuid,workspace_id:uuid,shopify_connection_id:uuid,shop_domain:shop,recharge_store_id:rechargeId,identifier:z.string().min(1).max(500),encrypted_key:z.string().min(60).max(9000),revision:uuid,enabled:z.boolean(),daily_changes:z.number().int().min(1).max(1000),confirmed_store_mapping:z.literal(true)}).strip();
type Connection=z.infer<typeof connectionSchema>;
const contextSchema=z.object({conversationId:uuid,orderId:uuid,contactId:uuid,providerOrderId:shopifyCustomerId,shopDomain:shop,contactUpdatedAt:z.string().datetime({offset:true}),orderUpdatedAt:z.string().datetime({offset:true}),email:z.string().max(1000).nullable(),phone:z.string().max(100).nullable()}).strict();
const providerNumericId=z.union([shopifyCustomerId,z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]).transform(String);
const liveCustomer=z.object({id:providerNumericId,email:z.string().max(1000).nullable().optional(),phone:z.string().max(100).nullable().optional()}).passthrough();
const delivery=z.object({date:z.string(),addressId:rechargeId,chargeId:rechargeId,lines:z.array(z.object({subscriptionId:rechargeId,isSkippable:z.boolean(),isSkipped:z.boolean(),isPrepaid:z.boolean()}).strict()).max(250)}).strict();
function parse<T>(schema:z.ZodType<T>,raw:unknown):T{const result=schema.safeParse(raw);if(!result.success)throw new ExpansionProviderError('unavailable');return result.data;}
function input<T>(schema:z.ZodType<T>,raw:unknown):T{const result=schema.safeParse(raw);if(!result.success)throw new ExpansionProviderError('invalid');return result.data;}
function allowed(workspaceId:string,actorId:string){if(!SHOW_RIVERZ_IMPROVEMENTS||!uuid.safeParse(workspaceId).success||!uuid.safeParse(actorId).success)throw new ExpansionProviderError('notAllowed');}
const requiredReads=['read_store','read_customers','read_subscriptions'];
function checkAccount(row:Connection,account:Awaited<ReturnType<ReturnType<typeof createRechargeClient>['account']>>,write=false,skip=false){
 if(account.platform!=='shopify'||account.storeId!==row.recharge_store_id||account.identifier!==row.identifier||!requiredReads.every(scope=>account.scopes.includes(scope))||(write&&!account.scopes.includes(skip?'write_orders':'write_subscriptions'))||(skip&&!account.scopes.includes('read_orders')))throw new ExpansionProviderError('notAllowed');
}
/** The reviewed hash includes the exact change and delivery/charge evidence,
 * not merely subscription.updated_at or a browser-supplied customer ID. */
export function subscriptionSnapshot(row:Pick<Connection,'id'|'revision'|'shop_domain'|'recharge_store_id'>,context:z.infer<typeof contextSchema>,externalId:string,current:NativeSubscription,change:SubscriptionChange|null,deliveries:SubscriptionDelivery[]=[],charge:SubscriptionCharge|null=null){
 return createHash('sha256').update(JSON.stringify([1,'recharge',row.id,row.revision,row.shop_domain,row.recharge_store_id,context,externalId,current,change,deliveries,charge])).digest('hex');
}

export function createNativeSubscriptionService(db:SupabaseClient,read:typeof fetch=fetch){
 async function rpc(name:string,args:Record<string,unknown>){const result=await db.rpc(name,args);if(result.error)throw new ExpansionProviderError(/^expansion_(not_allowed|changed|limit)$/.test(result.error.message)?'notAllowed':result.error.message==='invalid_expansion'?'invalid':'unavailable');return result.data;}
 async function connection(workspaceId:string,actorId:string,section:'/ajustes'|'/bandeja'){
  const raw=await rpc('native_subscriptions_private_connection',{p_workspace_id:workspaceId,p_actor_id:actorId,p_section:section});if(raw===null)return null;
  const row=parse(connectionSchema,raw);if(row.workspace_id!==workspaceId)throw new ExpansionProviderError('notAllowed');return row;
 }
 function provider(row:Connection){try{return createRechargeClient(privateProviderSecret(decrypt(row.encrypted_key)),read);}catch{throw new ExpansionProviderError('unavailable');}}
 async function liveIdentity(workspaceId:string,actorId:string,row:Connection,caseInput:z.infer<typeof subscriptionCaseInput>){
  const context=parse(contextSchema,await rpc('native_subscriptions_case_context',{p_workspace_id:workspaceId,p_actor_id:actorId,p_conversation_id:caseInput.conversationId,p_order_id:caseInput.orderId}));
  if(context.conversationId!==caseInput.conversationId||context.orderId!==caseInput.orderId||context.shopDomain!==row.shop_domain)throw new ExpansionProviderError('notAllowed');
  // Select the explicitly installed connection, never the last connected shop.
  const selected=await db.from('shopify_connections').select(`${COLUMNAS_TOKEN},workspace_id,status,platform`).eq('id',row.shopify_connection_id).eq('workspace_id',workspaceId).eq('shop_domain',row.shop_domain).eq('platform','shopify').eq('status','active').maybeSingle();
  if(selected.error||!selected.data||selected.data.id!==row.shopify_connection_id||selected.data.shop_domain!==row.shop_domain)throw new ExpansionProviderError('notAllowed');
  const {accessToken}=await tokenVivo(db,selected.data as Parameters<typeof tokenVivo>[1]),version=shopifyApiVersion();if(!/^\d{4}-(01|04|07|10)$/.test(version))throw new ExpansionProviderError('unavailable');
  async function shopRead(path:string){
   try{
    const response=await read(`https://${row.shop_domain}/admin/api/${version}${path}`,{headers:{Accept:'application/json','X-Shopify-Access-Token':accessToken},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
    if(!response.ok||!response.body)throw new Error('shop_unavailable');const reader=response.body.getReader(),chunks:Uint8Array[]=[],limit=512*1024;let size=0;
    try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>limit)throw new Error('shop_body_limit');chunks.push(next.value);}}catch(error){await reader.cancel().catch(()=>undefined);throw error;}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   }catch{throw new ExpansionProviderError('unavailable');}
  }
  const order=parse(z.object({order:z.object({id:providerNumericId,customer:z.object({id:providerNumericId}).passthrough().nullable()}).passthrough()}).passthrough(),await shopRead(`/orders/${context.providerOrderId}.json?fields=id,customer`)).order;
  if(order.id!==context.providerOrderId||!order.customer)throw new ExpansionProviderError('notAllowed');
  // Current customer contact details, not an order's old/shipping email/phone.
  const customer=parse(z.object({customer:liveCustomer}).passthrough(),await shopRead(`/customers/${order.customer.id}.json?fields=id,email,phone`)).customer;
  const email=context.email?.trim().toLowerCase(),phone=normPhone(context.phone);
  if(customer.id!==order.customer.id||!((!!email&&customer.email?.trim().toLowerCase()===email)||(!!phone&&normPhone(customer.phone)===phone)))throw new ExpansionProviderError('notAllowed');
  return {context,externalId:customer.id};
 }
 async function source(workspaceId:string,actorId:string,caseInput:z.infer<typeof subscriptionCaseInput>,change:SubscriptionChange|null=null){
  const row=await connection(workspaceId,actorId,'/bandeja');if(!row)return null;if(!row.enabled)throw new ExpansionProviderError('notAllowed');
  const live=await liveIdentity(workspaceId,actorId,row,caseInput),api=provider(row),account=await api.account();checkAccount(row,account,change!==null,change?.type==='skip');
  const customer=await api.customerForShopify(live.externalId);if(!customer)return {row,api,...live,customer:null,subscriptions:[]};
  const subscriptions=await api.subscriptions(customer.id);return {row,api,...live,customer,subscriptions};
 }
 async function cache(workspaceId:string,actorId:string,observed:NonNullable<Awaited<ReturnType<typeof source>>>,caseInput:z.infer<typeof subscriptionCaseInput>,rows:{subscription:NativeSubscription;snapshot:string;deliveries:SubscriptionDelivery[]}[]){
  return parse(z.array(subscriptionCaseRow.omit({skipOptions:true})).max(500),await rpc('cache_native_case_subscriptions',{p_workspace_id:workspaceId,p_actor_id:actorId,p_connection_id:observed.row.id,p_revision:observed.row.revision,p_conversation_id:caseInput.conversationId,p_order_id:caseInput.orderId,p_shopify_customer_id:observed.externalId,p_context:observed.context,p_rows:rows}));
 }
 async function preview(workspaceId:string,actorId:string,raw:unknown,ownAttemptId?:string){
  allowed(workspaceId,actorId);const body=input(subscriptionPreviewInput,raw),observed=await source(workspaceId,actorId,body,body.change);if(!observed?.customer)throw new ExpansionProviderError('notAllowed');
  const current=observed.subscriptions.find(item=>item.id===body.subscriptionId);if(!current)throw new ExpansionProviderError('notAllowed');
  if(body.change.type==='activate'?current.status!=='cancelled':current.status!=='active')throw new ExpansionProviderError('notAllowed');
  if(subscriptionChangeObserved(body.change,current,current))throw new ExpansionProviderError('invalid');
  let deliveries:SubscriptionDelivery[]=[],charge:SubscriptionCharge|null=null;
  if(body.change.type==='skip'){
   const change=body.change;deliveries=await observed.api.deliveries(current.customerId);charge=await observed.api.charge(change.chargeId,current);
   const exact=deliveries.filter(item=>item.date===change.date&&item.addressId===current.addressId&&item.chargeId===change.chargeId);
   const line=exact.length===1?exact[0].lines.find(item=>item.subscriptionId===current.id):null;
   if(!line||line.isSkipped||!line.isSkippable||line.isPrepaid||current.isPrepaid||!current.isSkippable||charge.status!=='queued'||charge.hasUncommittedChanges||charge.scheduledAt.slice(0,10)!==body.change.date)throw new ExpansionProviderError('notAllowed');
   // Only the reviewed charge's delivery is retained; preserve all its items.
   deliveries=exact;
  }
  const snapshot=subscriptionSnapshot(observed.row,observed.context,observed.externalId,current,body.change,deliveries,charge),rows=await cache(workspaceId,actorId,observed,body,[{subscription:current,snapshot,deliveries}]);
  if(rows.length!==1||rows[0].blocked&&(!ownAttemptId||rows[0].ownAttemptId!==ownAttemptId))throw new ExpansionProviderError('notAllowed');
  return {quote:parse(subscriptionPreview,{connectionId:observed.row.id,revision:observed.row.revision,shopDomain:observed.row.shop_domain,conversationId:body.conversationId,orderId:body.orderId,subscriptionId:current.id,snapshot,before:current,change:body.change,otherChargeItems:charge?charge.lines.length-1:0}),observed,current,deliveries,charge};
 }
 async function receipt(workspaceId:string,actorId:string,attemptId:string){allowed(workspaceId,actorId);input(uuid,attemptId);const raw=await rpc('native_subscription_action_receipt',{p_workspace_id:workspaceId,p_actor_id:actorId,p_attempt_id:attemptId});return raw===null?null:parse(subscriptionActionReceipt,raw);}
 async function observe(workspaceId:string,actorId:string,old:NativeSubscriptionReceipt){
  if(!['accepted','uncertain'].includes(old.state))return old;
  const row=await connection(workspaceId,actorId,'/bandeja');if(!row||row.id!==old.connectionId)throw new ExpansionProviderError('notAllowed');
  const details=parse(z.object({nonce:uuid,snapshot:z.string(),shopifyCustomerId,deliveries:z.array(delivery).max(1000),revision:uuid}).strict(),await rpc('native_subscription_action_private',{p_workspace_id:workspaceId,p_actor_id:actorId,p_attempt_id:old.attemptId}));
  const live=await liveIdentity(workspaceId,actorId,row,old);if(live.externalId!==details.shopifyCustomerId)throw new ExpansionProviderError('notAllowed');
  const api=provider(row);checkAccount(row,await api.account());await api.customer(old.before.customerId,live.externalId);const current=await api.subscription(old.before);
  let matched=subscriptionChangeObserved(old.change,old.before,current);
  if(old.change.type==='skip'){
   const after=await api.deliveries(current.customerId);
   matched=subscriptionSkipObserved(old.change,current,details.deliveries,after)&&current.status===old.before.status&&current.quantity===old.before.quantity&&current.price===old.before.price&&current.variantId===old.before.variantId&&current.orderIntervalUnit===old.before.orderIntervalUnit&&current.orderIntervalFrequency===old.before.orderIntervalFrequency&&String(current.chargeIntervalFrequency)===String(old.before.chargeIntervalFrequency);
  }
  if(matched&&await rpc('finish_native_subscription_action',{p_attempt_id:old.attemptId,p_nonce:details.nonce,p_outcome:'observed',p_provider_accepted:old.providerAccepted})!==true)throw new ExpansionProviderError('uncertain');
  const latest=await receipt(workspaceId,actorId,old.attemptId);if(!latest)throw new ExpansionProviderError('uncertain');return latest;
 }
 return {
  async settings(workspaceId:string,actorId:string){allowed(workspaceId,actorId);return parse(subscriptionSettings,await rpc('native_subscriptions_settings_read',{p_workspace_id:workspaceId,p_actor_id:actorId}));},
  async saveSettings(workspaceId:string,actorId:string,raw:unknown){
   allowed(workspaceId,actorId);const body=input(subscriptionSettingsInput,raw),current=parse(subscriptionSettings,await rpc('native_subscriptions_settings_read',{p_workspace_id:workspaceId,p_actor_id:actorId}));
   if(current.configured&&(current.shopifyConnectionId!==body.shopifyConnectionId||current.shopDomain!==body.shopDomain||current.storeId!==body.storeId||current.identifier!==body.identifier))throw new ExpansionProviderError('notAllowed');
   if((body.enabled||!current.configured)&&!current.stores.some(store=>store.id===body.shopifyConnectionId&&store.shopDomain===body.shopDomain))throw new ExpansionProviderError('notAllowed');
   const old=current.configured?await connection(workspaceId,actorId,'/ajustes'):null;if(current.configured&&old?.id!==current.connectionId)throw new ExpansionProviderError('notAllowed');
   let encryptedKey=old?.encrypted_key;if(body.key!==undefined)encryptedKey=encrypt(privateProviderSecret(body.key));if(!encryptedKey)throw new ExpansionProviderError('invalid');
   const connectionId=current.configured?current.connectionId:randomUUID(),revision=randomUUID();
   if(body.enabled){const row={id:connectionId,workspace_id:workspaceId,shopify_connection_id:body.shopifyConnectionId,shop_domain:body.shopDomain,recharge_store_id:body.storeId,identifier:body.identifier,encrypted_key:encryptedKey,revision,enabled:true,daily_changes:body.dailyChanges,confirmed_store_mapping:true as const};checkAccount(row,await provider(row).account());}
   return parse(subscriptionSettings,await rpc('set_native_subscriptions_settings',{p_workspace_id:workspaceId,p_actor_id:actorId,p_connection_id:connectionId,p_shopify_connection_id:body.shopifyConnectionId,p_shop_domain:body.shopDomain,p_store_id:body.storeId,p_identifier:body.identifier,p_revision:revision,p_encrypted_key:encryptedKey,p_enabled:body.enabled,p_daily_changes:body.dailyChanges,p_confirmed_mapping:true}));
  },
  async page(workspaceId:string,actorId:string,raw:unknown){
   allowed(workspaceId,actorId);const body=input(subscriptionCaseInput,raw),observed=await source(workspaceId,actorId,body);if(!observed)return parse(subscriptionCasePage,{configured:false,enabled:false,rows:[]});
   const rows=await cache(workspaceId,actorId,observed,body,observed.subscriptions.map(current=>({subscription:current,snapshot:subscriptionSnapshot(observed.row,observed.context,observed.externalId,current,null),deliveries:[]})));
   const deliveries=observed.customer?await observed.api.deliveries(observed.customer.id):[];
   const display=rows.map(row=>({...row,skipOptions:row.subscription.status==='active'&&row.subscription.isSkippable&&!row.subscription.isPrepaid?deliveries.filter(delivery=>delivery.addressId===row.subscription.addressId&&delivery.lines.some(line=>line.subscriptionId===row.subscription.id&&line.isSkippable&&!line.isSkipped&&!line.isPrepaid)).map(delivery=>({chargeId:delivery.chargeId,date:delivery.date,otherItems:delivery.lines.length-1})):[]}));
   return parse(subscriptionCasePage,{configured:true,enabled:true,connectionId:observed.row.id,revision:observed.row.revision,shopDomain:observed.row.shop_domain,customerId:observed.customer?.id??null,rows:display,complete:true});
  },
  async preview(workspaceId:string,actorId:string,raw:unknown){return (await preview(workspaceId,actorId,raw)).quote;},
  receipt,
  async abandon(workspaceId:string,actorId:string,raw:unknown){allowed(workspaceId,actorId);const body=input(subscriptionPending,raw);return parse(z.object({abandoned:z.boolean()}).strict(),await rpc('abandon_native_subscription_attempt',{p_workspace_id:workspaceId,p_actor_id:actorId,p_attempt_id:body.attemptId,p_connection_id:body.connectionId,p_conversation_id:body.conversationId,p_order_id:body.orderId,p_subscription_id:body.subscriptionId}));},
  async reconcile(workspaceId:string,actorId:string,attemptId:string){const old=await receipt(workspaceId,actorId,attemptId);return old?observe(workspaceId,actorId,old):null;},
  async execute(workspaceId:string,actorId:string,raw:unknown){
   allowed(workspaceId,actorId);const body=input(subscriptionActionInput,raw),old=await receipt(workspaceId,actorId,body.attemptId);
   if(old){if(old.connectionId!==body.connectionId||old.revision!==body.revision||old.snapshot!==body.snapshot||old.conversationId!==body.conversationId||old.orderId!==body.orderId||old.subscriptionId!==body.subscriptionId||JSON.stringify(old.change)!==JSON.stringify(body.change))throw new ExpansionProviderError('notAllowed');return {recovered:true,receipt:old};}
   const nonce=randomUUID(),review=parse(z.discriminatedUnion('claimed',[z.object({claimed:z.literal(true),attemptId:uuid,nonce:uuid}).strict(),z.object({claimed:z.literal(false),receipt:subscriptionActionReceipt}).strict()]),await rpc('review_native_subscription_action',{p_workspace_id:workspaceId,p_actor_id:actorId,p_attempt_id:body.attemptId,p_connection_id:body.connectionId,p_revision:body.revision,p_conversation_id:body.conversationId,p_order_id:body.orderId,p_subscription_id:body.subscriptionId,p_snapshot:body.snapshot,p_change:body.change,p_confirmed_billing:true,p_nonce:nonce}));
   if(!review.claimed)return {recovered:true,receipt:review.receipt};if(review.attemptId!==body.attemptId||review.nonce!==nonce)throw new ExpansionProviderError('unavailable');
   let claimed=false,claimMayHaveCommitted=false;
   try{
    const fresh=await preview(workspaceId,actorId,{conversationId:body.conversationId,orderId:body.orderId,subscriptionId:body.subscriptionId,change:body.change},body.attemptId);
    if(fresh.quote.connectionId!==body.connectionId||fresh.quote.revision!==body.revision||fresh.quote.snapshot!==body.snapshot)throw new ExpansionProviderError('notAllowed');
    const authorize=async()=>{claimMayHaveCommitted=true;claimed=await rpc('claim_native_subscription_action',{p_attempt_id:body.attemptId,p_nonce:nonce})===true;claimMayHaveCommitted=false;return claimed;};
    if(body.change.type==='skip'){if(!fresh.charge)throw new ExpansionProviderError('notAllowed');await fresh.observed.api.skip(fresh.current,fresh.charge,body.change,authorize);}else await fresh.observed.api.change(fresh.current,body.change,authorize);
    if(await rpc('finish_native_subscription_action',{p_attempt_id:body.attemptId,p_nonce:nonce,p_outcome:'accepted',p_provider_accepted:true})!==true)throw new ExpansionProviderError('uncertain');
    const saved=await receipt(workspaceId,actorId,body.attemptId);if(!saved)throw new ExpansionProviderError('uncertain');
    // Readback failure preserves accepted/uncertain authority. It never repeats
    // an external operation or calls a billing/provider write during recovery.
    const result=await observe(workspaceId,actorId,saved).catch(()=>saved);return {recovered:false,receipt:result};
   }catch(cause){await rpc('finish_native_subscription_action',{p_attempt_id:body.attemptId,p_nonce:nonce,p_outcome:claimed||claimMayHaveCommitted?'uncertain':'canceled',p_provider_accepted:false}).catch(()=>undefined);if(claimed||claimMayHaveCommitted)throw new ExpansionProviderError('uncertain');throw cause instanceof ExpansionProviderError?cause:new ExpansionProviderError('unavailable');}
  },
 };
}
