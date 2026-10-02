import 'server-only';
import {z} from 'zod';
import {ExpansionProviderError,expansionHttp,privateProviderSecret} from './provider-http';
import {nativeSubscription,rechargeId,shopifyCustomerId,subscriptionDate,subscriptionTimestamp,subscriptionChange,type NativeSubscription,type SubscriptionChange,type SubscriptionIdentity} from './subscription-ui-contract';

const id=rechargeId,external=z.object({ecommerce:z.string().max(100).nullable()}).passthrough();
const customer=z.object({id,external_customer_id:external}).passthrough();
const frequency=z.union([z.number().int().min(1).max(10000),z.string().regex(/^[1-9][0-9]{0,3}$/)]);
const subscription=z.object({
 id,customer_id:id,address_id:id,status:z.enum(['active','cancelled','expired']),quantity:z.number().int().min(1).max(10000),
 price:z.string().max(40).regex(/^\d+(?:\.\d{1,6})?$/),external_product_id:external,external_variant_id:external,
 product_title:z.string().max(1000).nullable().optional(),variant_title:z.string().max(1000).nullable().optional(),
 order_interval_frequency:z.number().int().min(1).max(10000),charge_interval_frequency:frequency,order_interval_unit:z.enum(['day','week','month']),
 next_charge_scheduled_at:subscriptionTimestamp.nullable(),is_prepaid:z.boolean(),is_skippable:z.boolean(),updated_at:subscriptionTimestamp,
 cancellation_reason:z.string().max(1000).nullable(),cancellation_reason_comments:z.string().max(1024).nullable(),cancelled_at:subscriptionTimestamp.nullable(),
}).passthrough();
const cursor=z.string().min(1).max(2048).refine(value=>!/[\s\u0000-\u001f\u007f]/u.test(value));
const paging={next_cursor:cursor.nullable().optional(),previous_cursor:cursor.nullable().optional()};
const charge=z.object({id,address_id:id,customer:z.object({id}).passthrough(),scheduled_at:subscriptionTimestamp,status:z.string().min(1).max(100),has_uncommitted_changes:z.boolean(),line_items:z.array(z.object({purchase_item_id:id,purchase_item_type:z.string().min(1).max(100),quantity:z.number().int().min(1).max(10000)}).passthrough()).max(250)}).passthrough();
const deliveryLine=z.object({subscription_id:id,is_skippable:z.boolean(),is_skipped:z.boolean(),is_prepaid:z.boolean()}).passthrough();
const schedule=z.object({customer:z.object({id}).passthrough(),deliveries:z.array(z.object({date:subscriptionDate,orders:z.array(z.object({address_id:id,charge_id:id,line_items:z.array(deliveryLine).max(250)}).passthrough()).max(250)}).passthrough()).max(366)}).passthrough();
export type SubscriptionCharge={id:number;customerId:number;addressId:number;scheduledAt:string;status:string;hasUncommittedChanges:boolean;lines:{itemId:number;type:string;quantity:number}[]};
export type SubscriptionDelivery={date:string;addressId:number;chargeId:number;lines:{subscriptionId:number;isSkippable:boolean;isSkipped:boolean;isPrepaid:boolean}[]};
function parse<T>(schema:z.ZodType<T>,raw:unknown,mutation=false):T{const result=schema.safeParse(raw);if(!result.success)throw new ExpansionProviderError(mutation?'uncertain':'unavailable');return result.data;}
function project(row:z.infer<typeof subscription>):NativeSubscription{
 return parse(nativeSubscription,{id:row.id,customerId:row.customer_id,addressId:row.address_id,status:row.status,quantity:row.quantity,price:row.price,productId:row.external_product_id.ecommerce,variantId:row.external_variant_id.ecommerce,title:row.product_title??null,variantTitle:row.variant_title??null,orderIntervalFrequency:row.order_interval_frequency,chargeIntervalFrequency:row.charge_interval_frequency,orderIntervalUnit:row.order_interval_unit,nextChargeScheduledAt:row.next_charge_scheduled_at,isPrepaid:row.is_prepaid,isSkippable:row.is_skippable,updatedAt:row.updated_at,cancellationReason:row.cancellation_reason,cancellationComments:row.cancellation_reason_comments,cancelledAt:row.cancelled_at});
}
function identity(current:NativeSubscription,expected:SubscriptionIdentity,mutation=false){if(current.id!==expected.id||current.customerId!==expected.customerId||current.addressId!==expected.addressId)throw new ExpansionProviderError(mutation?'uncertain':'notAllowed');return current;}
function validIdentity(expected:SubscriptionIdentity){if(!id.safeParse(expected.id).success||!id.safeParse(expected.customerId).success||!id.safeParse(expected.addressId).success)throw new ExpansionProviderError('invalid');}
function projectCharge(row:z.infer<typeof charge>):SubscriptionCharge{return {id:row.id,customerId:row.customer.id,addressId:row.address_id,scheduledAt:row.scheduled_at,status:row.status,hasUncommittedChanges:row.has_uncommitted_changes,lines:row.line_items.map(line=>({itemId:line.purchase_item_id,type:line.purchase_item_type,quantity:line.quantity}))};}

/** Version-pinned, fixed-origin Recharge client. This grants no customer,
 * account or mutation authority; the caller binds those with live evidence. */
export function createRechargeClient(privateKey:string,read:typeof fetch=fetch){
 const request=expansionHttp('recharge',read),headers={'X-Recharge-Access-Token':privateProviderSecret(privateKey),'X-Recharge-Version':'2021-11'};
 async function all<T>(path:string,query:Record<string,string>,field:string,schema:z.ZodType<T>):Promise<T[]>{
  const result:T[]=[],seenCursors=new Set<string>(),seenIds=new Set<number>();let next:string|undefined;
  // Complete only within a declared local bound; never truncate silently or
  // interpret an exhausted bound as an empty/complete customer account.
  for(let page=0;page<10;page++){
   const envelope=parse(z.object({...paging,[field]:z.array(schema).max(50)}).passthrough(),await request(path,{headers,query:{...query,limit:'50',...(next?{cursor:next}:{})}}));
   const rows=envelope[field] as T[];
   for(const row of rows){const number=(row as {id:number}).id;if(seenIds.has(number))throw new ExpansionProviderError('unavailable');seenIds.add(number);result.push(row);}
   const following=envelope.next_cursor as string|null|undefined;
   if(!following)return result;
   if(seenCursors.has(following)||rows.length===0)throw new ExpansionProviderError('unavailable');seenCursors.add(following);next=following;
  }
  throw new ExpansionProviderError('unavailable');
 }
 return {
  async account(){
   const store=parse(z.object({store:z.object({id,external_platform:z.string().min(1).max(100),identifier:z.string().min(1).max(500)}).passthrough()}).passthrough(),await request('/store',{headers})).store;
   const token=parse(z.object({token_information:z.object({scopes:z.array(z.string().min(1).max(100)).max(100)}).passthrough()}).passthrough(),await request('/token_information',{headers})).token_information;
   if(new Set(token.scopes).size!==token.scopes.length)throw new ExpansionProviderError('unavailable');
   return {storeId:store.id,platform:store.external_platform,identifier:store.identifier,scopes:token.scopes};
  },
  async customerForShopify(externalId:string){
   if(!shopifyCustomerId.safeParse(externalId).success)throw new ExpansionProviderError('invalid');
   const rows=await all('/customers',{external_customer_id:externalId},'customers',customer);
   if(rows.some(row=>row.external_customer_id.ecommerce!==externalId)||rows.length>1)throw new ExpansionProviderError('notAllowed');
   return rows.length?{id:rows[0].id,externalCustomerId:externalId}:null;
  },
  async customer(customerId:number,externalId:string){
   if(!id.safeParse(customerId).success||!shopifyCustomerId.safeParse(externalId).success)throw new ExpansionProviderError('invalid');
   const row=parse(z.object({customer}).passthrough(),await request(`/customers/${customerId}`,{headers})).customer;
   if(row.id!==customerId||row.external_customer_id.ecommerce!==externalId)throw new ExpansionProviderError('notAllowed');return {id:row.id,externalCustomerId:externalId};
  },
  async subscriptions(customerId:number){
   if(!id.safeParse(customerId).success)throw new ExpansionProviderError('invalid');
   const rows=await all('/subscriptions',{customer_id:String(customerId)},'subscriptions',subscription);
   if(rows.some(row=>row.customer_id!==customerId))throw new ExpansionProviderError('notAllowed');return rows.map(project);
  },
  async subscription(expected:SubscriptionIdentity){validIdentity(expected);return identity(project(parse(z.object({subscription}).passthrough(),await request(`/subscriptions/${expected.id}`,{headers})).subscription),expected);},
  async deliveries(customerId:number){
   if(!id.safeParse(customerId).success)throw new ExpansionProviderError('invalid');
   const row=parse(z.object({deliverySchedule:schedule}).passthrough(),await request(`/customers/${customerId}/delivery_schedule`,{headers})).deliverySchedule;
   if(row.customer.id!==customerId)throw new ExpansionProviderError('notAllowed');
   const result:SubscriptionDelivery[]=[],seen=new Set<string>();
   for(const delivery of row.deliveries)for(const order of delivery.orders){
    const key=`${delivery.date}:${order.address_id}:${order.charge_id}`;
    if(seen.has(key)||new Set(order.line_items.map(line=>line.subscription_id)).size!==order.line_items.length)throw new ExpansionProviderError('unavailable');seen.add(key);
    result.push({date:delivery.date,addressId:order.address_id,chargeId:order.charge_id,lines:order.line_items.map(line=>({subscriptionId:line.subscription_id,isSkippable:line.is_skippable,isSkipped:line.is_skipped,isPrepaid:line.is_prepaid}))});
   }
   if(result.length>1000)throw new ExpansionProviderError('unavailable');return result;
  },
  async charge(chargeId:number,expected:SubscriptionIdentity){
   validIdentity(expected);if(!id.safeParse(chargeId).success)throw new ExpansionProviderError('invalid');
   const row=projectCharge(parse(z.object({charge}).passthrough(),await request(`/charges/${chargeId}`,{headers})).charge);
   if(row.id!==chargeId||row.customerId!==expected.customerId||row.addressId!==expected.addressId||row.lines.filter(line=>line.type==='subscription'&&line.itemId===expected.id).length!==1)throw new ExpansionProviderError('notAllowed');return row;
  },
  async change(current:NativeSubscription,input:unknown,authorize:()=>Promise<boolean>){
   if(!nativeSubscription.safeParse(current).success)throw new ExpansionProviderError('invalid');
   const checked=subscriptionChange.safeParse(input);if(!checked.success)throw new ExpansionProviderError('invalid');const change=checked.data,base=`/subscriptions/${current.id}`;
   if(change.type==='skip')throw new ExpansionProviderError('invalid');
   if(change.type==='activate'?current.status!=='cancelled':current.status!=='active')throw new ExpansionProviderError('notAllowed');
   let path=base,method:'PUT'|'POST'='POST',body:Record<string,unknown>;
   switch(change.type){
    case 'quantity':if(change.quantity===current.quantity)throw new ExpansionProviderError('invalid');method='PUT';body={quantity:change.quantity};break;
    case 'cadence':if(change.unit===current.orderIntervalUnit&&change.orderFrequency===current.orderIntervalFrequency&&String(change.chargeFrequency)===String(current.chargeIntervalFrequency))throw new ExpansionProviderError('invalid');method='PUT';body={order_interval_unit:change.unit,order_interval_frequency:change.orderFrequency,charge_interval_frequency:change.chargeFrequency};break;
    case 'date':if(current.nextChargeScheduledAt?.slice(0,10)===change.date)throw new ExpansionProviderError('invalid');path+='/set_next_charge_date';body={date:change.date};break;
    case 'cancel':path+='/cancel';body={cancellation_reason:change.reason,cancellation_reason_comments:change.comments,send_email:false};break;
    case 'activate':path+='/activate';body={};break;
   }
   const raw=await request(path,{method,headers,body,authorize,successStatus:200});
   // Parse failures after a provider write are uncertain, never safe retries.
   try{return {providerAccepted:true as const,subscription:identity(project(parse(z.object({subscription}).passthrough(),raw,true).subscription),current,true)};}catch{throw new ExpansionProviderError('uncertain');}
  },
  async skip(current:NativeSubscription,source:SubscriptionCharge,input:SubscriptionChange,authorize:()=>Promise<boolean>){
   if(!nativeSubscription.safeParse(current).success||input.type!=='skip'||!subscriptionChange.safeParse(input).success)throw new ExpansionProviderError('invalid');
   if(current.status!=='active'||!current.isSkippable||current.isPrepaid||source.id!==input.chargeId||source.customerId!==current.customerId||source.addressId!==current.addressId||source.scheduledAt.slice(0,10)!==input.date||source.status!=='queued'||source.hasUncommittedChanges||source.lines.filter(line=>line.type==='subscription'&&line.itemId===current.id).length!==1)throw new ExpansionProviderError('notAllowed');
   const raw=await request(`/charges/${input.chargeId}/skip`,{method:'POST',headers,body:{purchase_item_ids:[current.id]},authorize,successStatus:200});
   const result=projectCharge(parse(z.object({charge}).passthrough(),raw,true).charge);
   if(result.id!==source.id||result.customerId!==source.customerId||result.addressId!==source.addressId||result.scheduledAt.slice(0,10)!==input.date)throw new ExpansionProviderError('uncertain');return {providerAccepted:true as const,charge:result};
  },
 };
}

/** Compare the exact dated delivery and preserve every other item. A charge's
 * overall skipped status does not prove an individual subscription was skipped. */
export function subscriptionSkipObserved(change:Extract<SubscriptionChange,{type:'skip'}>,current:SubscriptionIdentity,before:SubscriptionDelivery[],after:SubscriptionDelivery[]){
 const select=(rows:SubscriptionDelivery[])=>rows.filter(row=>row.date===change.date&&row.addressId===current.addressId&&row.chargeId===change.chargeId);
 const a=select(before),b=select(after);if(a.length!==1||b.length!==1)return false;
 const target=a[0].lines.filter(line=>line.subscriptionId===current.id),next=b[0].lines.filter(line=>line.subscriptionId===current.id);
 if(target.length!==1||next.length!==1||!target[0].isSkippable||target[0].isSkipped||target[0].isPrepaid||!next[0].isSkipped||next[0].isPrepaid||a[0].lines.length!==b[0].lines.length)return false;
 return a[0].lines.filter(line=>line.subscriptionId!==current.id).every(line=>b[0].lines.filter(other=>other.subscriptionId===line.subscriptionId&&other.isSkipped===line.isSkipped&&other.isSkippable===line.isSkippable&&other.isPrepaid===line.isPrepaid).length===1);
}
