import 'server-only';
import {createHash,createECDH} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {z} from 'zod';
import {encrypt,decrypt} from '@/lib/channels/encryption';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {browserPushSubscription,pushNotice,type BrowserPushSubscription} from './push-contract';
import {sendBrowserPush} from './push-transport';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const envelope=z.object({workspace_id:z.string().uuid(),user_id:z.string().uuid(),endpoint_hash:z.string().regex(/^[0-9a-f]{64}$/),subscription:browserPushSubscription}).strict();
export function browserPushKeys() {
 const publicKey=process.env.BROWSER_PUSH_VAPID_PUBLIC_KEY,privateKey=process.env.BROWSER_PUSH_VAPID_PRIVATE_KEY;
 if(!publicKey||!privateKey||!/^[A-Za-z0-9_-]{87}$/.test(publicKey)||!/^[A-Za-z0-9_-]{43}$/.test(privateKey)||Buffer.from(publicKey,'base64url')[0]!==4)return null;
 try{const pair=createECDH('prime256v1');pair.setPrivateKey(Buffer.from(privateKey,'base64url'));if(pair.getPublicKey().toString('base64url')!==publicKey)return null;}catch{return null;}
 return {publicKey,privateKey};
}
export function sealBrowserPush(workspaceId:string,userId:string,subscription:BrowserPushSubscription) {
 const endpointHash=hash(subscription.endpoint);
 return {endpointHash,ciphertext:encrypt(JSON.stringify(envelope.parse({workspace_id:workspaceId,user_id:userId,endpoint_hash:endpointHash,subscription})))};
}
function openBrowserPush(job:z.infer<typeof jobSchema>) {
 if(!/^[0-9a-f]{24}:[0-9a-f]+:[0-9a-f]{32}$/.test(job.ciphertext)||job.ciphertext.length>12000)throw new Error('push_unavailable');
 const value=envelope.parse(JSON.parse(decrypt(job.ciphertext)));
 if(value.workspace_id!==job.workspace_id||value.user_id!==job.user_id||value.endpoint_hash!==job.endpoint_hash||hash(value.subscription.endpoint)!==job.endpoint_hash)throw new Error('push_unavailable');
 return value.subscription;
}
export async function manageBrowserPush(db:SupabaseClient,workspaceId:string,userId:string,operation:'save'|'remove',endpoint:string,locale?:'es'|'en',subscription?:BrowserPushSubscription) {
 const sealed=subscription?sealBrowserPush(workspaceId,userId,subscription):null;
 const result=await db.rpc('manage_browser_push',{p_workspace_id:workspaceId,p_user_id:userId,p_endpoint_hash:hash(endpoint),p_operation:operation,p_ciphertext:sealed?.ciphertext??null,p_locale:locale??null});
 if(result.error)throw new Error(['browser_push_forbidden','browser_push_limit','invalid_browser_push_context'].includes(result.error.message)?result.error.message:'browser_push_unavailable');
 return z.object({enabled:z.boolean(),expires_at:z.string().datetime({offset:true}).optional()}).strict().parse(result.data);
}
const jobSchema=z.object({id:z.string().uuid(),lease_id:z.string().uuid(),subscription_id:z.string().uuid(),workspace_id:z.string().uuid(),user_id:z.string().uuid(),
 endpoint_hash:z.string().regex(/^[0-9a-f]{64}$/),ciphertext:z.string().max(12000),notice:pushNotice}).strict();
/** Provider acceptance is not delivery. Uncertain attempts are never replayed. */
export async function dispatchBrowserPush(db:SupabaseClient) {
 const keys=browserPushKeys();if(!SHOW_RIVERZ_IMPROVEMENTS||!keys)return {enabled:false,claimed:0,acknowledged:0,uncertain:0,dropped:0};
 const claimed=await db.rpc('claim_browser_push_notices');if(claimed.error)throw new Error('browser_push_unavailable');
 const jobs=z.array(jobSchema).max(10).parse(claimed.data),counts={enabled:true,claimed:jobs.length,acknowledged:0,uncertain:0,dropped:0};
 // At most two simultaneous sockets; receipts carry the durable one-attempt lease.
 for(let index=0;index<jobs.length;index+=2)await Promise.all(jobs.slice(index,index+2).map(async job=>{
  let state:'acknowledged'|'uncertain'|'dropped'='dropped',code:number|null=null;
  try {
   const subscription=openBrowserPush(job);
   const current=await db.rpc('browser_push_receipt_current',{p_receipt_id:job.id});
   if(current.error||current.data!==true)throw new Error('push_not_current');
   // Once transport is invoked, failure is uncertain even if no acknowledgment arrives.
   state='uncertain';code=await sendBrowserPush(subscription,job.notice,keys);
   if(code>=200&&code<300)state='acknowledged';else if(code===404||code===410)state='dropped';
  }catch{/* Keep private provider errors, endpoints and keys out of logs and metadata. */}
  const finished=await db.rpc('finish_browser_push_notice',{p_id:job.id,p_lease_id:job.lease_id,p_state:state,p_status_code:code});
  if(finished.error||finished.data!==true)throw new Error('browser_push_receipt_unconfirmed');
  counts[state]++;
 }));
 return counts;
}
