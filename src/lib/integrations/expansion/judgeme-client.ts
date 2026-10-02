import 'server-only';
import {z} from 'zod';
import {ExpansionProviderError,expansionHttp,privateProviderSecret} from './provider-http';
import {reviewReplyText} from './review-ui-contract';
const domain=z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/);
const id=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
// Judge.me calls archived reviews `hidden`. This is not a publication flag;
// neither hidden=false nor updated_at proves a publicly visible reply.
const review=z.object({id,title:z.string().max(4000).nullable().optional(),body:z.string().max(20000),rating:z.number().int().min(1).max(5),hidden:z.boolean(),created_at:z.string().datetime({offset:true}),updated_at:z.string().datetime({offset:true}),product_external_id:id.nullable().optional(),product_title:z.string().max(4000).nullable().optional()}).passthrough();
const page=z.object({current_page:z.number().int().positive(),per_page:z.number().int().min(1).max(100),reviews:z.array(review).max(100)}).passthrough();
export type StoreReview={id:number;title:string|null;body:string;rating:number;hidden:boolean;createdAt:string;updatedAt:string;productExternalId:number|null;productTitle:string|null};
function parse<T>(schema:z.ZodType<T>,value:unknown):T{const result=schema.safeParse(value);if(!result.success)throw new ExpansionProviderError('unavailable');return result.data;}
function project(row:z.infer<typeof review>):StoreReview{
 // Explicit projection: no reviewer email, IP, raw HTML/media or private
 // identity become output. Body remains untrusted plain text for display.
 return {id:row.id,title:row.title??null,body:row.body,rating:row.rating,hidden:row.hidden,createdAt:row.created_at,updatedAt:row.updated_at,productExternalId:row.product_external_id??null,productTitle:row.product_title??null};
}
/** First native review provider: the connected Shopify store with a private
 * server-side API key. Public widget keys/OAuth scopes are not inferred here.
 */
export function createJudgeMeClient(shopDomain:string,privateKey:string,read:typeof fetch=fetch){
 const shop=domain.safeParse(shopDomain);if(!shop.success)throw new ExpansionProviderError('invalid');
 const token=privateProviderSecret(privateKey),request=expansionHttp('judgeme',read),headers={'X-Api-Token':token},query={shop_domain:shop.data};
 return {
  async list(pageNumber:number){
   if(!Number.isInteger(pageNumber)||pageNumber<1||pageNumber>50)throw new ExpansionProviderError('invalid');
   // List the store without product_id: that ID belongs to Judge.me and an
   // invalid filter can silently return the entire store's reviews. A later
   // product selection uses the returned platform ID locally.
   const result=parse(page,await request('/api/v1/reviews',{headers,query:{...query,page:String(pageNumber),per_page:'100'}}));
   if(result.current_page!==pageNumber||result.per_page!==100||new Set(result.reviews.map(row=>row.id)).size!==result.reviews.length)throw new ExpansionProviderError('unavailable');
   return {reviews:result.reviews.map(project),done:result.reviews.length<100};
  },
  async review(reviewId:number){
   if(!id.safeParse(reviewId).success)throw new ExpansionProviderError('invalid');
   const result=parse(z.object({review}).passthrough(),await request(`/api/v1/reviews/${reviewId}`,{headers,query}));
   if(result.review.id!==reviewId)throw new ExpansionProviderError('unavailable');return project(result.review);
  },
  async publicReply(reviewId:number,content:string,authorize:()=>Promise<boolean>){
   if(!id.safeParse(reviewId).success||!reviewReplyText.safeParse(content).success)throw new ExpansionProviderError('invalid');
   // Endpoint's email default is true. Always opt out explicitly. A reply
   // still publishes externally and requires the durable human review guard.
   await request('/api/v1/replies',{method:'POST',headers,query,body:{review_id:reviewId,send_reply_email:false,reply:{content}},authorize,responseKind:'ack',successStatus:200});
   // API documents 200 creation but no response/reply-ID/readback schema.
   // Do not invent an ID or verification by review.updated_at/hidden=false.
   return {providerConfirmedCreation:true as const,reviewId,content,emailRequested:false as const,independentPublicationVerified:false as const};
  },
 };
}
