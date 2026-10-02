import {z} from 'zod';

export const rechargeId=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const shopifyCustomerId=z.string().regex(/^[1-9][0-9]{0,19}$/);
export const subscriptionDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{
 const parsed=new Date(`${value}T00:00:00Z`);return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
});
export const subscriptionTimestamp=z.union([subscriptionDate,z.string().datetime({offset:true})]);
const frequency=z.union([z.number().int().min(1).max(10000),z.string().regex(/^[1-9][0-9]{0,3}$/)]);
export const nativeSubscription=z.object({
 id:rechargeId,customerId:rechargeId,addressId:rechargeId,status:z.enum(['active','cancelled','expired']),
 quantity:z.number().int().min(1).max(10000),price:z.string().max(40).regex(/^\d+(?:\.\d{1,6})?$/),
 productId:z.string().max(100).nullable(),variantId:z.string().max(100).nullable(),
 title:z.string().max(1000).nullable(),variantTitle:z.string().max(1000).nullable(),
 orderIntervalFrequency:z.number().int().min(1).max(10000),chargeIntervalFrequency:frequency,
 orderIntervalUnit:z.enum(['day','week','month']),nextChargeScheduledAt:subscriptionTimestamp.nullable(),
 isPrepaid:z.boolean(),isSkippable:z.boolean(),updatedAt:subscriptionTimestamp,
 cancellationReason:z.string().max(1000).nullable(),cancellationComments:z.string().max(1024).nullable(),cancelledAt:subscriptionTimestamp.nullable(),
}).strict();
function plain(value:string){return !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)&&value.trim().length>0&&value.isWellFormed();}
export const subscriptionChange=z.discriminatedUnion('type',[
 z.object({type:z.literal('quantity'),quantity:z.number().int().min(1).max(100)}).strict(),
 z.object({type:z.literal('cadence'),unit:z.enum(['day','week','month']),orderFrequency:z.number().int().min(1).max(1000),chargeFrequency:z.number().int().min(1).max(1000)}).strict(),
 z.object({type:z.literal('date'),date:subscriptionDate}).strict(),
 z.object({type:z.literal('cancel'),reason:z.string().max(1000).refine(plain),comments:z.string().max(1024).refine(value=>value===''||plain(value))}).strict(),
 z.object({type:z.literal('activate')}).strict(),
 z.object({type:z.literal('skip'),chargeId:rechargeId,date:subscriptionDate}).strict(),
]);
export type NativeSubscription=z.infer<typeof nativeSubscription>;
export type SubscriptionChange=z.infer<typeof subscriptionChange>;
export type SubscriptionIdentity=Pick<NativeSubscription,'id'|'customerId'|'addressId'>;

const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),shopDomain=z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/);
const stores=z.array(z.object({id:uuid,shopDomain}).strict()).max(100);
export const subscriptionSettings=z.discriminatedUnion('configured',[
 z.object({configured:z.literal(false),enabled:z.literal(false),stores}).strict(),
 z.object({configured:z.literal(true),connectionId:uuid,shopifyConnectionId:uuid,shopDomain,storeId:rechargeId,identifier:z.string().min(1).max(500),revision:uuid,enabled:z.boolean(),dailyChanges:z.number().int().min(1).max(1000),stores}).strict(),
]);
export const subscriptionSettingsInput=z.object({shopifyConnectionId:uuid,shopDomain,storeId:rechargeId,identifier:z.string().min(1).max(500),key:z.string().min(8).max(4096).regex(/^[^\s\u0000-\u001f\u007f]+$/u).optional(),enabled:z.boolean(),dailyChanges:z.number().int().min(1).max(1000),confirmedStoreMapping:z.literal(true)}).strict();
export const subscriptionCaseInput=z.object({conversationId:uuid,orderId:uuid}).strict();
export const subscriptionPreviewInput=subscriptionCaseInput.extend({subscriptionId:rechargeId,change:subscriptionChange}).strict();
export const subscriptionActionInput=subscriptionCaseInput.extend({attemptId:uuid,connectionId:uuid,revision:uuid,subscriptionId:rechargeId,snapshot:hash,change:subscriptionChange,confirmed:z.literal(true),reviewedBillingEffects:z.literal(true)}).strict();
export const subscriptionPending=subscriptionCaseInput.extend({attemptId:uuid,connectionId:uuid,subscriptionId:rechargeId}).strict();
export const subscriptionCaseRow=z.object({subscription:nativeSubscription,snapshot:hash,blocked:z.boolean(),ownAttemptId:uuid.nullable(),skipOptions:z.array(z.object({chargeId:rechargeId,date:subscriptionDate,otherItems:z.number().int().min(0).max(249)}).strict()).max(366)}).strict();
export const subscriptionCasePage=z.discriminatedUnion('configured',[
 z.object({configured:z.literal(false),enabled:z.literal(false),rows:z.array(subscriptionCaseRow).max(0)}).strict(),
 z.object({configured:z.literal(true),enabled:z.literal(true),connectionId:uuid,revision:uuid,shopDomain,customerId:rechargeId.nullable(),rows:z.array(subscriptionCaseRow).max(500),complete:z.literal(true)}).strict(),
]);
export const subscriptionPreview=z.object({connectionId:uuid,revision:uuid,shopDomain,conversationId:uuid,orderId:uuid,subscriptionId:rechargeId,snapshot:hash,before:nativeSubscription,change:subscriptionChange,otherChargeItems:z.number().int().min(0).max(249)}).strict();
export const subscriptionActionReceipt=z.object({attemptId:uuid,connectionId:uuid,revision:uuid,snapshot:hash,conversationId:uuid,orderId:uuid,subscriptionId:rechargeId,change:subscriptionChange,before:nativeSubscription,state:z.enum(['reviewed','dispatching','accepted','observed','uncertain','canceled']),providerAccepted:z.boolean(),desiredStateObserved:z.boolean(),causalityVerified:z.literal(false),emailRequested:z.literal(false),createdAt:z.string().datetime({offset:true}),updatedAt:z.string().datetime({offset:true})}).strict().refine(row=>(row.state!=='observed'||row.desiredStateObserved&&row.providerAccepted)&&(row.state!=='accepted'||row.providerAccepted));
export type NativeSubscriptionReceipt=z.infer<typeof subscriptionActionReceipt>;

/** Equality is a readback observation, never proof that our write caused it. */
export function subscriptionChangeObserved(change:SubscriptionChange,before:NativeSubscription,after:NativeSubscription){
 if(after.id!==before.id||after.customerId!==before.customerId||after.addressId!==before.addressId)return false;
 switch(change.type){
  case 'quantity':return after.status==='active'&&after.quantity===change.quantity;
  case 'cadence':return after.status==='active'&&after.orderIntervalUnit===change.unit&&after.orderIntervalFrequency===change.orderFrequency&&String(after.chargeIntervalFrequency)===String(change.chargeFrequency);
  case 'date':return after.status==='active'&&after.nextChargeScheduledAt?.slice(0,10)===change.date;
  case 'cancel':return after.status==='cancelled'&&after.cancellationReason===change.reason&&after.cancellationComments===change.comments;
  case 'activate':return after.status==='active';
  case 'skip':return false; // Requires the exact delivery item, not subscription.updated_at.
 }
}
