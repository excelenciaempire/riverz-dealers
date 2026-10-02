import 'server-only';
import {randomUUID} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {z} from 'zod';
import {encrypt,decrypt} from '@/lib/channels/encryption';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {createTelnyxSmsClient,smsProviderIdentity,type SmsProviderIdentity} from './telnyx-sms-client';
import {ExpansionProviderError,privateProviderSecret} from './provider-http';
import {smsEncoding,smsPhone} from './sms-contract';
import {verifyTelnyxSmsEvent} from './sms-webhook';
import {smsPublicKey as publicKey,smsSettingsInput,smsSettings as settings,smsPeerPolicy,smsReceipt,smsReviewInput as reviewInput} from './sms-ui-contract';
export {smsSettingsInput,smsReceipt,type NativeSmsReceipt} from './sms-ui-contract';
const uuid=z.string().uuid();
const privateConnection=z.object({connection_id:uuid,workspace_id:uuid,phone_number_id:z.string(),phone:smsPhone,profile_id:uuid,organization_id:z.string(),encrypted_key:z.string(),public_key:publicKey,revision:uuid,enabled:z.boolean(),max_segments:z.number().int().min(1).max(10),daily_segments:z.number().int().min(1).max(10000)}).strip();
function parsed<T>(schema:z.ZodType<T>,value:unknown):T{const result=schema.safeParse(value);if(!result.success)throw new ExpansionProviderError('unavailable');return result.data;}
function identity(row:z.infer<typeof privateConnection>):SmsProviderIdentity{return parsed(smsProviderIdentity,{phoneNumberId:row.phone_number_id,phone:row.phone,profileId:row.profile_id,organizationId:row.organization_id});}
function key(row:z.infer<typeof privateConnection>){try{return privateProviderSecret(decrypt(row.encrypted_key));}catch{throw new ExpansionProviderError('unavailable');}}
function allowed(workspaceId?:string,actorId?:string){if(!SHOW_RIVERZ_IMPROVEMENTS||workspaceId!==undefined&&!uuid.safeParse(workspaceId).success||actorId!==undefined&&!uuid.safeParse(actorId).success)throw new ExpansionProviderError('notAllowed');}
/** Merchant-owned Telnyx account; carrier usage is billed by that provider,
 * separately from Riverz plans/AI usage. No account provisioning or test sends.
 * Every mutation is durable and actor-bound; a lost response never triggers a
 * second POST. The public API must authenticate actors before invoking this.
 */
export function createNativeSmsService(db:SupabaseClient,read:typeof fetch=fetch){
 async function rpc(name:string,input:Record<string,unknown>){const result=await db.rpc(name,input);if(result.error)throw new ExpansionProviderError(/^expansion_(not_allowed|changed|limit)$/.test(result.error.message)?'notAllowed':result.error.message==='invalid_expansion'?'invalid':'unavailable');return result.data;}
 async function connection(id:string){if(!uuid.safeParse(id).success)throw new ExpansionProviderError('invalid');const value=await rpc('native_sms_private_connection',{p_connection_id:id});if(value===null)throw new ExpansionProviderError('notAllowed');return parsed(privateConnection,value);}
 async function receipt(workspaceId:string,actorId:string,attemptId:string){allowed(workspaceId,actorId);if(!uuid.safeParse(attemptId).success)throw new ExpansionProviderError('invalid');const raw=await rpc('native_sms_receipt',{p_workspace_id:workspaceId,p_actor_id:actorId,p_attempt_id:attemptId});return raw===null?null:parsed(smsReceipt,raw);}
 return {
  async settings(workspaceId:string,actorId:string){allowed(workspaceId,actorId);return parsed(settings,await rpc('native_sms_settings_read',{p_workspace_id:workspaceId,p_actor_id:actorId}));},
  async saveSettings(workspaceId:string,actorId:string,input:unknown){
   allowed(workspaceId,actorId);const check=smsSettingsInput.safeParse(input);if(!check.success)throw new ExpansionProviderError('invalid');const body=check.data;
   // Check current installation authority before decrypting an existing key
   // or making any provider request. Disabling always works without a provider.
   const existing=parsed(settings,await rpc('native_sms_settings_read',{p_workspace_id:workspaceId,p_actor_id:actorId}));
   if(existing.configured&&JSON.stringify({phoneNumberId:existing.phoneNumberId,phone:existing.phone,profileId:existing.profileId,organizationId:existing.organizationId})!==JSON.stringify(body.identity))throw new ExpansionProviderError('notAllowed');
   const old=existing.configured?await connection(existing.connectionId):null;
   const secret=body.key!==undefined?privateProviderSecret(body.key):old?key(old):null,signingKey=body.publicKey??old?.public_key;
   if(!secret||!signingKey)throw new ExpansionProviderError('invalid');
   if(body.enabled)await createTelnyxSmsClient(secret,read).verifyAccount(body.identity);
   return parsed(settings,await rpc('set_native_sms_settings',{p_workspace_id:workspaceId,p_actor_id:actorId,p_connection_id:existing.configured?existing.connectionId:randomUUID(),p_revision:randomUUID(),p_identity:body.identity,p_encrypted_key:encrypt(secret),p_public_key:signingKey,p_enabled:body.enabled,p_max_segments:body.maxSegments,p_daily_segments:body.dailySegments}));
  },
  async peerPolicy(workspaceId:string,actorId:string,connectionId:string,peer:string){
   allowed(workspaceId,actorId);if(!uuid.safeParse(connectionId).success||!smsPhone.safeParse(peer).success)throw new ExpansionProviderError('invalid');
   return parsed(smsPeerPolicy,await rpc('native_sms_peer_policy',{p_workspace_id:workspaceId,p_actor_id:actorId,p_connection_id:connectionId,p_peer:peer}));
  },
  async consent(workspaceId:string,actorId:string,connectionId:string,peer:string,consented:boolean,evidence:string){
   allowed(workspaceId,actorId);if(!uuid.safeParse(connectionId).success||!smsPhone.safeParse(peer).success||typeof consented!=='boolean'||typeof evidence!=='string'||!evidence.trim()||evidence.length>1000)throw new ExpansionProviderError('invalid');
   if(await rpc('native_sms_consent',{p_workspace_id:workspaceId,p_actor_id:actorId,p_connection_id:connectionId,p_peer:peer,p_allowed:consented,p_evidence:evidence})!==true)throw new ExpansionProviderError('unavailable');return {saved:true as const};
  },
  receipt,
  async retryInbox(workspaceId:string,actorId:string,connectionId:string){
   allowed(workspaceId,actorId);if(!uuid.safeParse(connectionId).success)throw new ExpansionProviderError('invalid');const count=await rpc('retry_native_sms_inbox',{p_workspace_id:workspaceId,p_actor_id:actorId,p_connection_id:connectionId,p_limit:20});if(typeof count!=='number'||!Number.isInteger(count)||count<0||count>20)throw new ExpansionProviderError('unavailable');return {queued:count};
  },
  async send(workspaceId:string,actorId:string,input:unknown){
   allowed(workspaceId,actorId);const check=reviewInput.safeParse(input);if(!check.success)throw new ExpansionProviderError('invalid');const body=check.data;
   const old=await receipt(workspaceId,actorId,body.attemptId);
   if(old){if(old.conversationId!==body.conversationId||old.contactId!==body.contactId||old.peer!==body.peer||old.text!==body.text)throw new ExpansionProviderError('notAllowed');return {recovered:true as const,receipt:old};}
   const row=await connection(body.connectionId);if(row.workspace_id!==workspaceId||row.revision!==body.revision||!row.enabled)throw new ExpansionProviderError('notAllowed');
   const nonce=randomUUID(),segments=smsEncoding(body.text)!.segments;
   const review=parsed(z.discriminatedUnion('claimed',[z.object({claimed:z.literal(true),attemptId:uuid,nonce:uuid}).strict(),z.object({claimed:z.literal(false),receipt:smsReceipt}).strict()]),await rpc('review_native_sms_send',{p_workspace_id:workspaceId,p_actor_id:actorId,p_attempt_id:body.attemptId,p_connection_id:body.connectionId,p_conversation_id:body.conversationId,p_contact_id:body.contactId,p_revision:body.revision,p_peer:body.peer,p_body:body.text,p_segments:segments,p_nonce:nonce}));
   if(!review.claimed)return {recovered:true as const,receipt:review.receipt};
   if(review.attemptId!==body.attemptId||review.nonce!==nonce)throw new ExpansionProviderError('unavailable');
   let claimed=false,claimMayHaveCommitted=false;
   try{
    const result=await createTelnyxSmsClient(key(row),read).send(identity(row),{from:row.phone,to:body.peer,text:body.text,type:'SMS'},async()=>{claimMayHaveCommitted=true;claimed=await rpc('claim_native_sms_send',{p_attempt_id:body.attemptId,p_nonce:nonce})===true;claimMayHaveCommitted=false;return claimed;});
    if(await rpc('finish_native_sms_send',{p_attempt_id:body.attemptId,p_nonce:nonce,p_outcome:'accepted',p_provider_id:result.id,p_status:result.status,p_parts:result.parts,p_cost:result.cost})!==true)throw new ExpansionProviderError('uncertain');
    const current=await receipt(workspaceId,actorId,body.attemptId);if(!current)throw new ExpansionProviderError('uncertain');return {recovered:false as const,receipt:current};
   }catch(error){
    // If the durable claim happened, the network result may be unknown.
    // Cancellation is allowed only for the proven pre-POST state.
    await rpc('finish_native_sms_send',{p_attempt_id:body.attemptId,p_nonce:nonce,p_outcome:claimed||claimMayHaveCommitted?'uncertain':'canceled'}).catch(()=>undefined);
    if(claimed||claimMayHaveCommitted)throw new ExpansionProviderError('uncertain');throw error instanceof ExpansionProviderError?error:new ExpansionProviderError('unavailable');
   }
  },
  async webhook(connectionId:string,raw:Uint8Array,signature:unknown,timestamp:unknown){
   allowed();const row=await connection(connectionId);if(!row.enabled)throw new ExpansionProviderError('notAllowed');
   const event=verifyTelnyxSmsEvent(raw,signature,timestamp,row.public_key);if(!event)return {ignored:true as const};
   // A signed account event is not automatically this tenant's event.
   if(event.organizationId!==row.organization_id||event.profileId!==row.profile_id||event.businessPhone!==row.phone)throw new ExpansionProviderError('notAllowed');
   const result=await rpc('enqueue_native_sms_event',{p_connection_id:connectionId,p_event:event});if(typeof result!=='boolean')throw new ExpansionProviderError('unavailable');return {persisted:true as const,duplicate:!result};
  },
 };
}
