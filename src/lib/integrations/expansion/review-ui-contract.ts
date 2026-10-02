import {z} from 'zod';
const uuid=z.string().uuid(),id=z.number().int().positive().max(Number.MAX_SAFE_INTEGER),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const reviewShopDomain=z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/);
function wellFormed(value:string){for(let n=0;n<value.length;n++){const code=value.charCodeAt(n);if(code>=0xd800&&code<=0xdbff){const next=value.charCodeAt(++n);if(!(next>=0xdc00&&next<=0xdfff))return false;}else if(code>=0xdc00&&code<=0xdfff)return false;}return true;}
/** Plain reply text only. Never silently rewrite the reviewed public content. */
export const reviewReplyText=z.string().max(4000).refine(value=>!!value.trim()&&wellFormed(value)&&!/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
export const storeReviewProjection=z.object({id,title:z.string().max(4000).nullable(),body:z.string().max(20000),rating:z.number().int().min(1).max(5),hidden:z.boolean(),createdAt:z.string().datetime({offset:true}),updatedAt:z.string().datetime({offset:true}),productExternalId:id.nullable(),productTitle:z.string().max(4000).nullable()}).strict();
export const storeReviewSource=storeReviewProjection.extend({snapshot:hash}).strict();
export const storeReviewRow=storeReviewSource.extend({reply:z.object({blocked:z.boolean(),state:z.enum(['reviewed','dispatching','accepted','uncertain']).nullable(),ownAttemptId:uuid.nullable()}).strict().refine(value=>value.blocked===(value.state!==null)&&(!value.ownAttemptId||value.blocked))}).strict();
const stores=z.array(z.object({id:uuid,shopDomain:reviewShopDomain}).strict()).max(100);
export const storeReviewSettings=z.discriminatedUnion('configured',[
 z.object({configured:z.literal(false),enabled:z.literal(false),stores}).strict(),
 z.object({configured:z.literal(true),connectionId:uuid,shopifyConnectionId:uuid,shopDomain:reviewShopDomain,revision:uuid,enabled:z.boolean(),dailyReplies:z.number().int().min(1).max(1000),stores}).strict(),
]);
export const storeReviewSettingsInput=z.object({shopifyConnectionId:uuid,shopDomain:reviewShopDomain,key:z.string().min(8).max(4096).regex(/^[^\s\u0000-\u001f\u007f]+$/u).optional(),enabled:z.boolean(),dailyReplies:z.number().int().min(1).max(1000)}).strict();
export const reviewReplyInput=z.object({attemptId:uuid,connectionId:uuid,revision:uuid,reviewId:id,snapshot:hash,text:reviewReplyText,confirmed:z.literal(true),reviewedStorefront:z.literal(true)}).strict();
export const reviewReplyReceipt=z.object({attemptId:uuid,connectionId:uuid,reviewId:id,text:reviewReplyText,state:z.enum(['reviewed','dispatching','accepted','uncertain','canceled']),providerConfirmedCreation:z.boolean(),independentPublicationVerified:z.literal(false),emailRequested:z.literal(false),createdAt:z.string().datetime({offset:true}),updatedAt:z.string().datetime({offset:true})}).strict().refine(value=>value.providerConfirmedCreation===(value.state==='accepted'));
export const storeReviewPage=z.discriminatedUnion('configured',[
 z.object({configured:z.literal(false),enabled:z.literal(false),rows:z.array(storeReviewRow).max(0),page:z.literal(1),hasNext:z.literal(false)}).strict(),
 z.object({configured:z.literal(true),connectionId:uuid,revision:uuid,shopDomain:reviewShopDomain,enabled:z.literal(true),rows:z.array(storeReviewRow).max(100),page:z.number().int().min(1).max(50),hasNext:z.boolean()}).strict(),
]);
export type NativeReviewReplyReceipt=z.infer<typeof reviewReplyReceipt>;
