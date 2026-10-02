import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {VoiceCall,WhatsAppConfig} from '@/types';
import {decrypt} from '@/lib/whatsapp/encryption';
import {motorApagado} from '@/lib/workspaces/motor';
import {puertaDeIa} from '@/lib/wallet/puerta';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {pickInboundVoiceAgent,pickVoiceAgent} from './agents';
import {voiceProviderHealth} from './provider-health';
import {createWhatsAppConnector,WhatsAppVoiceError} from './whatsapp-connector';
import {createWhatsAppCallingMeta} from './whatsapp-calling-meta';
import {parseWhatsAppCallEvents,freshWhatsAppCallOffer,type WhatsAppCallEvent} from './whatsapp-call-webhook';
import {whatsappVoiceBinding,savedWhatsAppVoiceBinding,whatsappCallingVersion,whatsappCallingSettingsInput,whatsappParticipantIdentity,type WhatsAppVoiceBinding} from './whatsapp-calling-contract';
import {roomNameForCall} from './livekit';
import {RoomServiceClient} from 'livekit-server-sdk';
import {whatsappVoiceRate} from './whatsapp-calling-rates';
import {voiceWorkerDown} from './readiness';
import {getVoiceModelConfig} from './model-config';
import {reserveVoiceMedia,settleVoiceMedia} from './media-billing';
import type {AiAgent} from '@/lib/ai/types';

const uuid=z.string().uuid();
const policySchema=z.object({workspace_id:uuid,connection_id:uuid,inbound_enabled:z.boolean(),outbound_enabled:z.boolean(),api_version:whatsappCallingVersion}).strict();
const claimSchema=z.object({claimed:z.literal(true),call:z.object({id:uuid,workspace_id:uuid,direction:z.enum(['inbound','outbound']),context:z.record(z.string(),z.unknown())}).passthrough(),binding:whatsappVoiceBinding,nonce:uuid}).strict();
const noClaimSchema=z.object({claimed:z.literal(false)}).passthrough();
function parsed<T>(schema:z.ZodType<T>,value:unknown):T{const result=schema.safeParse(value);if(!result.success)throw new WhatsAppVoiceError('unavailable');return result.data;}
async function rpc(db:SupabaseClient,name:string,input:Record<string,unknown>){
 const result=await db.rpc(name,input);
 if(result.error)throw new WhatsAppVoiceError(/^whatsapp_voice_(not_found|not_allowed|changed|read_only|capacity_unavailable|connection_unavailable)$/.test(result.error.message)?'notAllowed':'unavailable');return result.data;
}
async function connection(db:SupabaseClient,phoneNumberId:string,wabaId:string){
 const result=await db.from('whatsapp_config').select('*').eq('phone_number_id',phoneNumberId).eq('waba_id',wabaId).eq('status','connected').limit(2);
 if(result.error||result.data?.length!==1)throw new WhatsAppVoiceError('notAllowed');
 const config=result.data[0] as WhatsAppConfig;if(!uuid.safeParse(config.workspace_id).success||!uuid.safeParse(config.id).success)throw new WhatsAppVoiceError('notAllowed');return config;
}
async function workspaceConnection(db:SupabaseClient,workspaceId:string){
 const result=await db.from('whatsapp_config').select('*').eq('workspace_id',workspaceId).eq('status','connected').limit(2);
 if(result.error||result.data?.length!==1)throw new WhatsAppVoiceError('notAllowed');return result.data[0] as WhatsAppConfig;
}
function credentials(config:WhatsAppConfig,apiVersion:z.infer<typeof whatsappCallingVersion>){
 let accessToken:string;try{accessToken=decrypt(config.access_token);}catch{throw new WhatsAppVoiceError('unavailable');}
 return {phoneNumberId:config.phone_number_id,apiVersion,accessToken};
}
async function enabledPolicy(db:SupabaseClient,config:WhatsAppConfig,direction:'inbound'|'outbound'){
 const policy=parsed(policySchema,await rpc(db,'voice_whatsapp_connection_policy',{p_connection_id:config.id}));
 if(policy.workspace_id!==config.workspace_id||policy.connection_id!==config.id||!(direction==='inbound'?policy.inbound_enabled:policy.outbound_enabled))throw new WhatsAppVoiceError('notAllowed');return policy;
}
async function aiAllowed(db:SupabaseClient,workspaceId:string){
 const [wallet,motorOff,health,workerDown,connection]=await Promise.all([puertaDeIa(db,workspaceId),motorApagado(db,workspaceId),voiceProviderHealth(db),voiceWorkerDown(db),db.from('channel_connections').select('config').eq('workspace_id',workspaceId).eq('channel','voice').maybeSingle()]);
 if(!wallet.puede||motorOff||health.aiBlocking||workerDown||connection.error||connection.data?.config?.kill_switch===true)throw new WhatsAppVoiceError('notAllowed');
}
async function inboundContact(db:SupabaseClient,workspaceId:string,peer:string):Promise<string>{
 const find=async()=>db.from('contacts').select('id').eq('workspace_id',workspaceId).eq('channel','whatsapp').eq('external_id',peer).maybeSingle();
 const found=await find();if(found.error)throw new WhatsAppVoiceError('unavailable');if(found.data?.id)return found.data.id;
 const created=await db.from('contacts').insert({workspace_id:workspaceId,channel:'whatsapp',external_id:peer,phone:'+'+peer}).select('id').single();
 if(created.error?.code==='23505'){const winner=await find();if(!winner.error&&winner.data?.id)return winner.data.id;}
 if(created.error||!created.data?.id)throw new WhatsAppVoiceError('unavailable');return created.data.id;
}
function claimed(value:unknown){
 if(noClaimSchema.safeParse(value).success)return null;const result=parsed(claimSchema,value);
 if(result.call.id!==result.binding.callId||result.call.workspace_id!==result.binding.workspaceId||result.call.direction!==result.binding.direction||JSON.stringify(savedWhatsAppVoiceBinding(result.call.context))!==JSON.stringify(result.binding))throw new WhatsAppVoiceError('unavailable');return result;
}
function adapter(db:SupabaseClient,value:{binding:WhatsAppVoiceBinding;nonce:string}){
 return createWhatsAppConnector(async(binding,operation)=>{
  if(JSON.stringify(binding)!==JSON.stringify(value.binding))return false;
  return await rpc(db,'voice_whatsapp_operation_current',{p_call_id:binding.callId,p_nonce:value.nonce,p_operation:operation})===true;
 });
}
function callbackCallId(event:WhatsAppCallEvent){const id=event.callbackData?.startsWith('riverz:')?event.callbackData.slice(7):null;return uuid.safeParse(id).success?id:null;}
async function finishCleanup(db:SupabaseClient,value:{binding:WhatsAppVoiceBinding;nonce:string},acknowledged:boolean){
 if(await rpc(db,'finish_voice_whatsapp_cleanup',{p_call_id:value.binding.callId,p_nonce:value.nonce,p_acknowledged:acknowledged})!==true)throw new WhatsAppVoiceError('uncertain');
}
async function finish(db:SupabaseClient,value:{binding:WhatsAppVoiceBinding;nonce:string},result:'accepted'|'initiated'|'answer_accepted'|'uncertain',providerCallId:string|null=null){
 return rpc(db,'finish_voice_whatsapp_operation',{p_call_id:value.binding.callId,p_nonce:value.nonce,p_result:result,p_provider_call_id:providerCallId});
}
function globalLimit(){return Math.floor(Math.max(1,Math.min(250,Number(process.env.VOICE_GLOBAL_CONCURRENCY_LIMIT)||10)));}
async function cancelPreparedMedia(db:SupabaseClient,value:NonNullable<ReturnType<typeof claimed>>){
  // No connector RPC has run. This is a canceled preflight, not an uncertain
  // dial. A partly completed reservation is reconciled at zero actual usage.
  const canceled=await rpc(db,'cancel_voice_whatsapp_preflight',{p_call_id:value.binding.callId,p_nonce:value.nonce});
  if(canceled===true){const current=await db.from('voice_calls').select('*').eq('id',value.binding.callId).eq('workspace_id',value.binding.workspaceId).maybeSingle();
   if(current.error||!current.data)throw new WhatsAppVoiceError('unavailable');
   await settleVoiceMedia(db,current.data as VoiceCall,0,0);
  }
}
async function prepareMedia(db:SupabaseClient,value:NonNullable<ReturnType<typeof claimed>>,profile:AiAgent){
 try{const model=await getVoiceModelConfig(db);await reserveVoiceMedia(db,value.call,profile.voice_max_call_seconds||300,model.stt_provider);}
 catch{
  await cancelPreparedMedia(db,value);throw new WhatsAppVoiceError('unavailable');
 }
}

async function inbound(db:SupabaseClient,event:WhatsAppCallEvent){
 if(!event.peer||!event.sdp)throw new WhatsAppVoiceError('notAllowed');
 const config=await connection(db,event.phoneNumberId,event.wabaId),policy=await enabledPolicy(db,config,'inbound');whatsappVoiceRate('inbound');
 // Read-only settings; never turn on Meta calling, rewrite hours/holidays or
 // disable SIP as a side effect of an inbound webhook.
 const credential=credentials(config,policy.api_version),settings=await createWhatsAppCallingMeta().settings(credential);
 if(!settings.enabled||!settings.graphCompatible)throw new WhatsAppVoiceError('notAllowed');
 await aiAllowed(db,config.workspace_id);const profile=await pickInboundVoiceAgent(db,config.workspace_id);if(!profile)throw new WhatsAppVoiceError('notAllowed');
 // A stale first offer cannot create a contact/call. Durable duplicate checks
 // remain in SQL; a valid redelivery never starts a second connector attempt.
 if(!freshWhatsAppCallOffer(event))return {ignored:true};
 const contactId=await inboundContact(db,config.workspace_id,event.peer);
 const value=claimed(await rpc(db,'reserve_voice_whatsapp_call',{p_workspace_id:config.workspace_id,p_connection_id:config.id,p_call_id:randomUUID(),p_agent_id:profile.id,p_contact_id:contactId,p_nonce:randomUUID(),p_direction:'inbound',p_provider_call_id:event.providerCallId,p_peer:event.peer,p_event_at:new Date(event.timestamp*1000).toISOString(),p_actor_id:null,p_global_limit:globalLimit()}));
 if(!value)return {ignored:true};
 await prepareMedia(db,value,profile);
 try{await adapter(db,value).accept(value.binding,credential.accessToken,event.sdp);await finish(db,value,'accepted');return {accepted:true};}
 catch{await finish(db,value,'uncertain').catch(()=>undefined);return {uncertain:true};}
}
async function answer(db:SupabaseClient,event:WhatsAppCallEvent){
 if(!event.peer||!event.sdp)throw new WhatsAppVoiceError('notAllowed');
 const value=claimed(await rpc(db,'claim_voice_whatsapp_answer',{p_waba_id:event.wabaId,p_phone_number_id:event.phoneNumberId,p_provider_call_id:event.providerCallId,p_peer:event.peer,p_callback_call_id:callbackCallId(event),p_nonce:randomUUID()}));
 if(!value)return {ignored:true};
 try{await adapter(db,value).connect(value.binding,event.sdp);await finish(db,value,'answer_accepted');return {accepted:true};}
 catch{await finish(db,value,'uncertain').catch(()=>undefined);return {uncertain:true};}
}
async function terminate(db:SupabaseClient,event:WhatsAppCallEvent){
 if(!event.peer)throw new WhatsAppVoiceError('notAllowed');
 const raw=await rpc(db,'claim_voice_whatsapp_termination',{p_waba_id:event.wabaId,p_phone_number_id:event.phoneNumberId,p_provider_call_id:event.providerCallId,p_peer:event.peer,p_direction:event.direction,p_callback_call_id:callbackCallId(event),p_nonce:randomUUID()});
 if(noClaimSchema.safeParse(raw).success)return {ignored:true};
 const value=parsed(z.object({claimed:z.literal(true),call_id:uuid,binding:whatsappVoiceBinding,nonce:uuid}).strict(),raw);
 if(value.call_id!==value.binding.callId)throw new WhatsAppVoiceError('unavailable');
 // USER_INITIATED here means Meta already reported termination. It is not
 // inferred from the direction of the original call, and needs no Meta token.
 try{await adapter(db,value).disconnect(value.binding,'user');await finishCleanup(db,value,true);return {cleaned:true};}
 catch{await finishCleanup(db,value,false).catch(()=>undefined);return {uncertain:true};}
}

export async function handleSignedWhatsAppCalls(db:SupabaseClient,body:unknown){
 if(!SHOW_RIVERZ_IMPROVEMENTS)return {disabled:true};const parsed=parseWhatsAppCallEvents(body);
 const results={invalid:parsed.invalid,accepted:0,ignored:0,uncertain:0,cleaned:0,retryable:0};
 // If a complete short call appears in one payload, termination wins. It
 // would be wasteful to accept an already-ended physical call.
 const events=[...parsed.events].sort((a,b)=>Number(b.event==='terminate')-Number(a.event==='terminate'));
 for(const event of events){try{
  const result=event.event==='terminate'?await terminate(db,event):event.direction==='inbound'?await inbound(db,event):await answer(db,event);
  if('accepted' in result)results.accepted++;else if('cleaned' in result)results.cleaned++;else if('uncertain' in result)results.uncertain++;else results.ignored++;
 }catch(error){if(error instanceof WhatsAppVoiceError&&error.code==='notAllowed')results.ignored++;else{results.uncertain++;results.retryable++;}}}
 return results;
}

export async function initiateWhatsAppVoiceCall(db:SupabaseClient,workspaceId:string,actorId:string,contactId:string,attemptId:string,expectedPeer:string){
 if(!SHOW_RIVERZ_IMPROVEMENTS||![workspaceId,actorId,contactId,attemptId].every(value=>uuid.safeParse(value).success))throw new WhatsAppVoiceError('notAllowed');
 // Recovery is local and actor-bound. Revoked provider permission must never
 // hide an already attempted call or cause the UI to create another attempt.
 const receipt=await rpc(db,'voice_whatsapp_outbound_receipt',{p_workspace_id:workspaceId,p_actor_id:actorId,p_call_id:attemptId});
 if(receipt!==null){if(!receipt||receipt.contactId!==contactId)throw new WhatsAppVoiceError('notAllowed');return {callId:attemptId,recovered:true as const,receipt};}
 const config=await workspaceConnection(db,workspaceId),policy=await enabledPolicy(db,config,'outbound');whatsappVoiceRate('outbound');await aiAllowed(db,workspaceId);
 // The selected contact is the recipient; callers cannot submit another phone.
 const contact=await db.from('contacts').select('phone,voice_opt_out').eq('id',contactId).eq('workspace_id',workspaceId).maybeSingle();
 const peer=typeof contact.data?.phone==='string'?contact.data.phone.replace(/^\+/,''):null;
 if(contact.error||!peer||peer!==expectedPeer||contact.data?.voice_opt_out===true)throw new WhatsAppVoiceError('notAllowed');
 const credential=credentials(config,policy.api_version),meta=createWhatsAppCallingMeta();
 if(!await meta.outboundAllowed(credential,peer))throw new WhatsAppVoiceError('notAllowed');
 const permissionCheckedAt=Date.now(),profile=await pickVoiceAgent(db,workspaceId);if(!profile)throw new WhatsAppVoiceError('notAllowed');
 const value=claimed(await rpc(db,'reserve_voice_whatsapp_call',{p_workspace_id:workspaceId,p_connection_id:config.id,p_call_id:attemptId,p_agent_id:profile.id,p_contact_id:contactId,p_nonce:randomUUID(),p_direction:'outbound',p_provider_call_id:null,p_peer:peer,p_event_at:null,p_actor_id:actorId,p_global_limit:globalLimit()}));
 if(!value)return {callId:attemptId,recovered:true as const,receipt:await rpc(db,'voice_whatsapp_outbound_receipt',{p_workspace_id:workspaceId,p_actor_id:actorId,p_call_id:attemptId})};
 await prepareMedia(db,value,profile);
 try{
  if(Date.now()-permissionCheckedAt>5000&&!await meta.outboundAllowed(credential,peer))throw new WhatsAppVoiceError('notAllowed');
 }catch(error){
  await cancelPreparedMedia(db,value);throw error instanceof WhatsAppVoiceError?error:new WhatsAppVoiceError('unavailable');
 }
 try{
  const response=await adapter(db,value).dial(value.binding,credential.accessToken);await finish(db,value,'initiated',response.providerCallId);
  const latest=await db.from('voice_calls').select('ended_at').eq('id',value.binding.callId).eq('workspace_id',workspaceId).maybeSingle();
  if(latest.error||!latest.data)throw new WhatsAppVoiceError('uncertain');
  if(latest.data.ended_at)await endWhatsAppVoiceCall(db,value.binding.callId,roomNameForCall(value.binding.callId),whatsappParticipantIdentity(value.binding.callId));
  return {callId:value.binding.callId,initiated:true as const};
 }catch{await finish(db,value,'uncertain').catch(()=>undefined);throw new WhatsAppVoiceError('uncertain');}
}

export async function whatsappVoiceContext(db:SupabaseClient,call:VoiceCall){
 const reference=savedWhatsAppVoiceBinding(call.context);if(!reference||reference.callId!==call.id||reference.workspaceId!==call.workspace_id)throw new WhatsAppVoiceError('notAllowed');
 const current=await rpc(db,'voice_whatsapp_call_context',{p_call_id:call.id});
 const value=parsed(z.object({call:z.object({id:uuid,workspace_id:uuid,context:z.record(z.string(),z.unknown())}).passthrough(),binding:whatsappVoiceBinding,state:z.string(),nonce:uuid}).strict(),current);
 if(value.call.id!==call.id||value.call.workspace_id!==call.workspace_id||JSON.stringify(value.binding)!==JSON.stringify(reference))throw new WhatsAppVoiceError('notAllowed');
 return {transport:'whatsapp' as const,customer_identity:whatsappParticipantIdentity(call.id),workspace_id:call.workspace_id,room_name:roomNameForCall(call.id),direction:reference.direction};
}
export async function observeWhatsAppVoiceCustomer(db:SupabaseClient,callId:string,room:string,customerIdentity:string){
 if(!SHOW_RIVERZ_IMPROVEMENTS||!uuid.safeParse(callId).success||room!==roomNameForCall(callId)||customerIdentity!==whatsappParticipantIdentity(callId))throw new WhatsAppVoiceError('notAllowed');
 const raw=await rpc(db,'voice_whatsapp_call_context',{p_call_id:callId});
 const value=parsed(z.object({call:z.object({id:uuid,workspace_id:uuid}).passthrough(),binding:whatsappVoiceBinding,state:z.string(),nonce:uuid}).strict(),raw);
 if(value.binding.callId!==callId||value.call.id!==callId||value.call.workspace_id!==value.binding.workspaceId)throw new WhatsAppVoiceError('notAllowed');
 const url=process.env.LIVEKIT_URL,key=process.env.LIVEKIT_API_KEY,secret=process.env.LIVEKIT_API_SECRET;
 if(!url||!key||!secret)throw new WhatsAppVoiceError('unavailable');const host=new URL(url);
 if(host.protocol!=='wss:'||!host.hostname.endsWith('.livekit.cloud')||host.port||host.username||host.password||host.pathname!=='/'||host.search||host.hash)throw new WhatsAppVoiceError('unavailable');
 const participant=await new RoomServiceClient(url.replace(/^wss:/,'https:'),key,secret,{requestTimeout:4,failover:false}).getParticipant(room,customerIdentity);
 if(participant.identity!==customerIdentity||participant.kind!==7||participant.permission?.hidden===true||participant.attributes['riverz.call']!==callId||participant.attributes['riverz.workspace']!==value.binding.workspaceId||participant.attributes['riverz.transport']!=='whatsapp')throw new WhatsAppVoiceError('notAllowed');
 if(await rpc(db,'mark_voice_whatsapp_connected',{p_call_id:callId,p_room:room,p_customer_identity:customerIdentity})!==true)throw new WhatsAppVoiceError('unavailable');return {observed:true as const};
}

export async function endWhatsAppVoiceCall(db:SupabaseClient,callId:string,room:string,customerIdentity:string){
 if(!SHOW_RIVERZ_IMPROVEMENTS)throw new WhatsAppVoiceError('notAllowed');
 const raw=await rpc(db,'claim_voice_whatsapp_business_end',{p_call_id:callId,p_room:room,p_customer_identity:customerIdentity,p_nonce:randomUUID()});
 if(noClaimSchema.safeParse(raw).success)return {claimed:false as const};
 const value=parsed(z.object({claimed:z.literal(true),call_id:uuid,binding:whatsappVoiceBinding,nonce:uuid}).strict(),raw);
 if(value.call_id!==callId||value.binding.callId!==callId)throw new WhatsAppVoiceError('unavailable');
 try{
  const config=await db.from('whatsapp_config').select('*').eq('id',value.binding.connectionId).eq('workspace_id',value.binding.workspaceId).maybeSingle();
  if(config.error||!config.data||config.data.phone_number_id!==value.binding.phoneNumberId||config.data.waba_id!==value.binding.wabaId)throw new WhatsAppVoiceError('uncertain');
  const credential=credentials(config.data as WhatsAppConfig,value.binding.apiVersion);
  await adapter(db,value).disconnect(value.binding,'business',credential.accessToken);await finishCleanup(db,value,true);return {accepted:true as const};}
 catch{await finishCleanup(db,value,false).catch(()=>undefined);throw new WhatsAppVoiceError('uncertain');}
}

const settingsResult=z.object({inbound_enabled:z.boolean(),outbound_enabled:z.boolean(),api_version:whatsappCallingVersion,connection_id:uuid.optional()}).strict();
function configuredRates(){const rates={inbound:false,outbound:false};for(const direction of ['inbound','outbound'] as const){try{whatsappVoiceRate(direction);rates[direction]=true;}catch{/* No guessed rates. */}}return rates;}
function settingsResponse(value:unknown){const policy=parsed(settingsResult,value);return {inboundEnabled:policy.inbound_enabled,outboundEnabled:policy.outbound_enabled,apiVersion:policy.api_version,ratesConfigured:configuredRates()};}
export async function readWhatsAppVoiceSettings(db:SupabaseClient,workspaceId:string,actorId:string){
 if(!SHOW_RIVERZ_IMPROVEMENTS)throw new WhatsAppVoiceError('notAllowed');
 return settingsResponse(await rpc(db,'voice_whatsapp_settings_read',{p_workspace_id:workspaceId,p_actor_id:actorId}));
}
export async function saveWhatsAppVoiceSettings(db:SupabaseClient,workspaceId:string,actorId:string,input:unknown){
 if(!SHOW_RIVERZ_IMPROVEMENTS)throw new WhatsAppVoiceError('notAllowed');const policy=parsed(whatsappCallingSettingsInput,input);
 if(policy.inboundEnabled)whatsappVoiceRate('inbound');if(policy.outboundEnabled)whatsappVoiceRate('outbound');
 // Riverz's opt-in only. It never enables Meta calling/SIP or sends a request.
 return settingsResponse(await rpc(db,'set_voice_whatsapp_settings',{p_workspace_id:workspaceId,p_actor_id:actorId,p_inbound:policy.inboundEnabled,p_outbound:policy.outboundEnabled,p_version:policy.apiVersion}));
}
const receiptSchema=z.object({callId:uuid,contactId:uuid,state:z.enum(['starting','initiated','accepted','connecting','connected','terminated','uncertain']),status:z.string().max(32),cleanupState:z.enum(['not_requested','pending','acknowledged','uncertain']),providerEnded:z.boolean()}).strict();
export async function readWhatsAppVoiceReceipt(db:SupabaseClient,workspaceId:string,actorId:string,callId:string){
 if(!SHOW_RIVERZ_IMPROVEMENTS)throw new WhatsAppVoiceError('notAllowed');
 const result=await rpc(db,'voice_whatsapp_outbound_receipt',{p_workspace_id:workspaceId,p_actor_id:actorId,p_call_id:callId});
 if(result===null)return null;return parsed(receiptSchema,result);
}
