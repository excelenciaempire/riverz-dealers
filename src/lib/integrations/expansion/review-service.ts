import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {z} from 'zod';
import {encrypt,decrypt} from '@/lib/channels/encryption';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {createJudgeMeClient,type StoreReview} from './judgeme-client';
import {ExpansionProviderError,privateProviderSecret} from './provider-http';
import {reviewShopDomain,storeReviewSettings,storeReviewSettingsInput,storeReviewRow,storeReviewPage,reviewReplyInput,reviewReplyReceipt} from './review-ui-contract';
export {storeReviewSettingsInput,reviewReplyInput} from './review-ui-contract';
const uuid=z.string().uuid();
const privateConnection=z.object({id:uuid,workspace_id:uuid,shopify_connection_id:uuid,shop_domain:reviewShopDomain,encrypted_key:z.string().min(60).max(9000),revision:uuid,enabled:z.boolean(),daily_replies:z.number().int().min(1).max(1000)}).strip();
function parse<T>(schema:z.ZodType<T>,raw:unknown):T{const result=schema.safeParse(raw);if(!result.success)throw new ExpansionProviderError('unavailable');return result.data;}
function allowed(workspaceId:string,actorId:string){if(!SHOW_RIVERZ_IMPROVEMENTS||!uuid.safeParse(workspaceId).success||!uuid.safeParse(actorId).success)throw new ExpansionProviderError('notAllowed');}
/** Account/identity are bound in current SQL authority. A snapshot is evidence
 * of the exact observed review, never of an existing/publicly visible reply. */
export function storeReviewSnapshot(shopDomain:string,review:StoreReview){return createHash('sha256').update(JSON.stringify([1,'judgeme',shopDomain,review.id,review.title,review.body,review.rating,review.hidden,review.createdAt,review.updatedAt,review.productExternalId,review.productTitle])).digest('hex');}
export function createNativeReviewService(db:SupabaseClient,read:typeof fetch=fetch){
 async function rpc(name:string,args:Record<string,unknown>){const result=await db.rpc(name,args);if(result.error)throw new ExpansionProviderError(/^expansion_(not_allowed|changed|limit)$/.test(result.error.message)?'notAllowed':result.error.message==='invalid_expansion'?'invalid':'unavailable');return result.data;}
 async function connection(workspaceId:string,actorId:string,section:'/ajustes'|'/productos'){
  const row=await rpc('native_reviews_private_connection',{p_workspace_id:workspaceId,p_actor_id:actorId,p_section:section});if(row===null)return null;
  const current=parse(privateConnection,row);if(current.workspace_id!==workspaceId)throw new ExpansionProviderError('notAllowed');return current;
 }
 function client(row:z.infer<typeof privateConnection>){try{return createJudgeMeClient(row.shop_domain,privateProviderSecret(decrypt(row.encrypted_key)),read);}catch{throw new ExpansionProviderError('unavailable');}}
 async function receipt(workspaceId:string,actorId:string,attemptId:string){allowed(workspaceId,actorId);if(!uuid.safeParse(attemptId).success)throw new ExpansionProviderError('invalid');const row=await rpc('native_review_reply_receipt',{p_workspace_id:workspaceId,p_actor_id:actorId,p_attempt_id:attemptId});return row===null?null:parse(reviewReplyReceipt,row);}
 return {
  async settings(workspaceId:string,actorId:string){allowed(workspaceId,actorId);return parse(storeReviewSettings,await rpc('native_reviews_settings_read',{p_workspace_id:workspaceId,p_actor_id:actorId}));},
  async saveSettings(workspaceId:string,actorId:string,input:unknown){
   allowed(workspaceId,actorId);const check=storeReviewSettingsInput.safeParse(input);if(!check.success)throw new ExpansionProviderError('invalid');const body=check.data;
   const current=parse(storeReviewSettings,await rpc('native_reviews_settings_read',{p_workspace_id:workspaceId,p_actor_id:actorId}));
   if(current.configured&&(current.shopifyConnectionId!==body.shopifyConnectionId||current.shopDomain!==body.shopDomain))throw new ExpansionProviderError('notAllowed');
   // Reject a forged current-store selection before decrypting or provider GET.
   if((body.enabled||!current.configured)&&!current.stores.some(store=>store.id===body.shopifyConnectionId&&store.shopDomain===body.shopDomain))throw new ExpansionProviderError('notAllowed');
   const old=current.configured?await connection(workspaceId,actorId,'/ajustes'):null;
   if(current.configured&&(!old||old.id!==current.connectionId))throw new ExpansionProviderError('notAllowed');
   let encryptedKey=old?.encrypted_key;
   if(body.key!==undefined)encryptedKey=encrypt(privateProviderSecret(body.key));
   if(!encryptedKey)throw new ExpansionProviderError('invalid');
   if(body.enabled){const selected={id:current.configured?current.connectionId:randomUUID(),workspace_id:workspaceId,shopify_connection_id:body.shopifyConnectionId,shop_domain:body.shopDomain,encrypted_key:encryptedKey,revision:randomUUID(),enabled:true,daily_replies:body.dailyReplies};await client(selected).list(1);}
   // Read access was checked; publication permission is NOT tested by sending.
   return parse(storeReviewSettings,await rpc('set_native_reviews_settings',{p_workspace_id:workspaceId,p_actor_id:actorId,p_connection_id:current.configured?current.connectionId:randomUUID(),p_shopify_connection_id:body.shopifyConnectionId,p_shop_domain:body.shopDomain,p_revision:randomUUID(),p_encrypted_key:encryptedKey,p_enabled:body.enabled,p_daily_replies:body.dailyReplies}));
  },
  async page(workspaceId:string,actorId:string,pageNumber:number){
   allowed(workspaceId,actorId);if(!Number.isInteger(pageNumber)||pageNumber<1||pageNumber>50)throw new ExpansionProviderError('invalid');
   const row=await connection(workspaceId,actorId,'/productos');if(!row)return parse(storeReviewPage,{configured:false,enabled:false,rows:[],page:1,hasNext:false});if(!row.enabled)throw new ExpansionProviderError('notAllowed');
   const result=await client(row).list(pageNumber),rows=result.reviews.map(review=>({...review,snapshot:storeReviewSnapshot(row.shop_domain,review)}));
   const observed=parse(z.array(storeReviewRow).max(100),await rpc('cache_native_store_reviews',{p_workspace_id:workspaceId,p_actor_id:actorId,p_connection_id:row.id,p_revision:row.revision,p_rows:rows}));
   return parse(storeReviewPage,{configured:true,connectionId:row.id,revision:row.revision,shopDomain:row.shop_domain,enabled:true,rows:observed,page:pageNumber,hasNext:!result.done});
  },
  receipt,
  async reply(workspaceId:string,actorId:string,input:unknown){
   allowed(workspaceId,actorId);const check=reviewReplyInput.safeParse(input);if(!check.success)throw new ExpansionProviderError('invalid');const body=check.data;
   const old=await receipt(workspaceId,actorId,body.attemptId);if(old){if(old.connectionId!==body.connectionId||old.reviewId!==body.reviewId||old.text!==body.text)throw new ExpansionProviderError('notAllowed');return {recovered:true as const,receipt:old};}
   const row=await connection(workspaceId,actorId,'/productos');if(!row||row.id!==body.connectionId||row.revision!==body.revision||!row.enabled)throw new ExpansionProviderError('notAllowed');
   const nonce=randomUUID(),review=parse(z.discriminatedUnion('claimed',[z.object({claimed:z.literal(true),attemptId:uuid,nonce:uuid}).strict(),z.object({claimed:z.literal(false),receipt:reviewReplyReceipt}).strict()]),await rpc('review_native_store_reply',{p_workspace_id:workspaceId,p_actor_id:actorId,p_attempt_id:body.attemptId,p_connection_id:body.connectionId,p_revision:body.revision,p_review_id:body.reviewId,p_snapshot:body.snapshot,p_content:body.text,p_reviewed_publication:body.reviewedStorefront,p_nonce:nonce}));
   if(!review.claimed)return {recovered:true as const,receipt:review.receipt};if(review.attemptId!==body.attemptId||review.nonce!==nonce)throw new ExpansionProviderError('unavailable');
   let claimed=false,claimMayHaveCommitted=false;
   try{
    const provider=client(row),current=await provider.review(body.reviewId);if(current.hidden||storeReviewSnapshot(row.shop_domain,current)!==body.snapshot)throw new ExpansionProviderError('notAllowed');
    // Re-cache the exact current source. SQL rechecks actor/store/installation;
    // the final claim checks the same revision immediately before the one POST.
    await rpc('cache_native_store_reviews',{p_workspace_id:workspaceId,p_actor_id:actorId,p_connection_id:row.id,p_revision:row.revision,p_rows:[{...current,snapshot:body.snapshot}]});
    await provider.publicReply(body.reviewId,body.text,async()=>{claimMayHaveCommitted=true;claimed=await rpc('claim_native_store_reply',{p_attempt_id:body.attemptId,p_nonce:nonce})===true;claimMayHaveCommitted=false;return claimed;});
    if(await rpc('finish_native_store_reply',{p_attempt_id:body.attemptId,p_nonce:nonce,p_outcome:'accepted'})!==true)throw new ExpansionProviderError('uncertain');
    const result=await receipt(workspaceId,actorId,body.attemptId);if(!result)throw new ExpansionProviderError('uncertain');return {recovered:false as const,receipt:result};
   }catch(cause){await rpc('finish_native_store_reply',{p_attempt_id:body.attemptId,p_nonce:nonce,p_outcome:claimed||claimMayHaveCommitted?'uncertain':'canceled'}).catch(()=>undefined);if(claimed||claimMayHaveCommitted)throw new ExpansionProviderError('uncertain');throw cause instanceof ExpansionProviderError?cause:new ExpansionProviderError('unavailable');}
  },
 };
}
