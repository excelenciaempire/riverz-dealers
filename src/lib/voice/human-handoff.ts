import 'server-only';
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {AccessToken,RoomServiceClient,TrackSource} from 'livekit-server-sdk';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {humanHandoffInput,humanHandoffSnapshot,humanRuntimeRegistration,humanRuntimePoll,humanRuntimeRelease,humanRuntimeAck,humanParticipantIdentity} from './human-handoff-contract';

export class VoiceHandoffError extends Error {
 constructor(public readonly code:'invalid'|'notFound'|'changed'|'readOnly'|'unavailable'){super(code);}
}
const uuid=z.string().uuid(),room=z.string().min(1).max(128).regex(/^[A-Za-z0-9_.-]+$/),identity=z.string().min(1).max(128).regex(/^[A-Za-z0-9_+.:@-]+$/);
export const runtimeSnapshot=z.object({call_id:uuid,worker_id:uuid,id:uuid.nullable(),state:z.enum(['requested','ready','connected','ended','failed','expired']).nullable(),actor_id:uuid.nullable(),expires_at:z.string().datetime({offset:true}).nullable(),room,customer_identity:identity,tools_pending:z.boolean()}).strict()
 .refine(value=>value.id===null?value.state===null&&value.actor_id===null&&value.expires_at===null:value.state!==null&&value.actor_id!==null&&value.expires_at!==null);
const grantContext=z.object({id:uuid,call_id:uuid,workspace_id:uuid,actor_id:uuid,room,customer_identity:identity,expires_at:z.string().datetime({offset:true})}).strict();
function fail(message:string):never {
 const codes:Record<string,VoiceHandoffError['code']>={invalid_voice_handoff:'invalid',voice_handoff_not_found:'notFound',voice_handoff_changed:'changed',voice_handoff_read_only:'readOnly',voice_handoff_unavailable:'unavailable'};
 throw new VoiceHandoffError(codes[message]??'unavailable');
}
function parse<T>(schema:z.ZodType<T>,value:unknown):T{const parsed=schema.safeParse(value);if(!parsed.success)throw new VoiceHandoffError('unavailable');return parsed.data;}
function scope(workspaceId:string,actorId:string,callId:string){if(![workspaceId,actorId,callId].every(value=>uuid.safeParse(value).success))throw new VoiceHandoffError('invalid');return {p_workspace_id:workspaceId,p_actor_id:actorId,p_call_id:callId};}
async function rpc(db:SupabaseClient,name:string,input:Record<string,unknown>){const result=await db.rpc(name,input);if(result.error)fail(result.error.message);return result.data;}
function snapshot(value:unknown,workspaceId:string,actorId:string,callId:string){const saved=parse(humanHandoffSnapshot,value);if(saved.workspace_id!==workspaceId||saved.actor_id!==actorId||saved.call_id!==callId)throw new VoiceHandoffError('unavailable');return saved;}
function livekit(){
 const url=process.env.LIVEKIT_URL,key=process.env.LIVEKIT_API_KEY,secret=process.env.LIVEKIT_API_SECRET;
 if(!url||!key||!secret)throw new VoiceHandoffError('unavailable');
 const parsed=new URL(url);if(parsed.protocol!=='wss:'||parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/')throw new VoiceHandoffError('unavailable');
 return {url,key,secret,client:new RoomServiceClient(url.replace(/^wss:/,'https:'),key,secret,{requestTimeout:4,failover:false})};
}
async function observeCustomer(client:RoomServiceClient,roomName:string,customerIdentity:string){
 // Participant kind SIP=3 in the pinned LiveKit protocol. Never accept an agent
 // or a browser that merely chooses the customer's identity.
 const participant=await client.getParticipant(roomName,customerIdentity);
 if(participant.identity!==customerIdentity||participant.kind!==3||participant.attributes['sip.callStatus']!=='active')throw new VoiceHandoffError('changed');
}
export async function readHumanHandoff(db:SupabaseClient,workspaceId:string,actorId:string,callId:string){return snapshot(await rpc(db,'voice_human_snapshot',scope(workspaceId,actorId,callId)),workspaceId,actorId,callId);}
export async function requestHumanHandoff(db:SupabaseClient,workspaceId:string,actorId:string,input:unknown){
 const parsed=humanHandoffInput.safeParse(input);if(!parsed.success)throw new VoiceHandoffError('invalid');const {callId,id}=parsed.data;
 return snapshot(await rpc(db,'request_voice_human_handoff',{...scope(workspaceId,actorId,callId),p_id:id}),workspaceId,actorId,callId);
}
export async function manageHumanHandoff(db:SupabaseClient,workspaceId:string,actorId:string,input:unknown,operation:'renew'|'end'){
 const parsed=humanHandoffInput.safeParse(input);if(!parsed.success)throw new VoiceHandoffError('invalid');const {callId,id}=parsed.data;
 const value=await rpc(db,'manage_voice_human_handoff',{...scope(workspaceId,actorId,callId),p_id:id,p_operation:operation});
 if(operation==='end'&&z.object({released:z.literal(true)}).strict().safeParse(value).success)return {released:true} as const;
 return snapshot(value,workspaceId,actorId,callId);
}
export async function createHumanHandoffGrant(db:SupabaseClient,workspaceId:string,actorId:string,input:unknown){
 const parsed=humanHandoffInput.safeParse(input);if(!parsed.success)throw new VoiceHandoffError('invalid');const {callId,id}=parsed.data,args={...scope(workspaceId,actorId,callId),p_id:id};
 const context=parse(grantContext,await rpc(db,'voice_human_grant_context',args));
 if(context.id!==id||context.call_id!==callId||context.workspace_id!==workspaceId||context.actor_id!==actorId)throw new VoiceHandoffError('unavailable');
 const config=livekit();await observeCustomer(config.client,context.room,context.customer_identity);
 const current=parse(grantContext,await rpc(db,'voice_human_grant_context',args));
 if(JSON.stringify(current)!==JSON.stringify(context))throw new VoiceHandoffError('changed');
 const ttl=Math.min(30,Math.floor((Date.parse(context.expires_at)-Date.now())/1000));if(ttl<5)throw new VoiceHandoffError('changed');
 const token=new AccessToken(config.key,config.secret,{ttl,identity:humanParticipantIdentity(id),attributes:{'riverz.handoff':id,'riverz.actor':actorId}});
 token.addGrant({roomJoin:true,room:context.room,canPublish:true,canPublishSources:[TrackSource.MICROPHONE],canSubscribe:true,canPublishData:false,canUpdateOwnMetadata:false,canSubscribeMetrics:false,canManageAgentSession:false});
 // Only this explicit join operation returns a short-lived credential. Logs,
 // database snapshots, URLs and browser storage never carry this token.
 return {id,callId,url:config.url,token:await token.toJwt(),customerIdentity:context.customer_identity,expiresAt:new Date(Date.now()+ttl*1000).toISOString()};
}
export async function registerHumanRuntime(db:SupabaseClient,input:unknown){
 const parsed=humanRuntimeRegistration.safeParse(input);if(!parsed.success)throw new VoiceHandoffError('invalid');const value=parsed.data,config=livekit();
 await observeCustomer(config.client,value.room,value.customerIdentity);
 return parse(z.literal(true),await rpc(db,'register_voice_human_runtime',{p_call_id:value.callId,p_worker_id:value.workerId,p_room:value.room,p_customer_identity:value.customerIdentity}));
}
export async function pollHumanRuntime(db:SupabaseClient,input:unknown){
 const parsed=humanRuntimePoll.safeParse(input);if(!parsed.success)throw new VoiceHandoffError('invalid');const value=parsed.data;
 const saved=parse(runtimeSnapshot,await rpc(db,'poll_voice_human_runtime',{p_call_id:value.callId,p_worker_id:value.workerId}));
 if(saved.call_id!==value.callId||saved.worker_id!==value.workerId)throw new VoiceHandoffError('unavailable');return saved;
}
export async function ackHumanRuntime(db:SupabaseClient,input:unknown){
 const parsed=humanRuntimeAck.safeParse(input);if(!parsed.success)throw new VoiceHandoffError('invalid');const value=parsed.data;
 if(value.phase==='connected'){
  const current=await pollHumanRuntime(db,{callId:value.callId,workerId:value.workerId});
  if(current.id!==value.id||!current.actor_id||!['ready','connected'].includes(current.state??''))throw new VoiceHandoffError('changed');
  const config=livekit();await observeCustomer(config.client,current.room,current.customer_identity);
  const participant=await config.client.getParticipant(current.room,humanParticipantIdentity(value.id));
  if(participant.kind!==0||participant.identity!==humanParticipantIdentity(value.id)||participant.attributes['riverz.handoff']!==value.id||participant.attributes['riverz.actor']!==current.actor_id)throw new VoiceHandoffError('changed');
 }
 return parse(z.boolean(),await rpc(db,'ack_voice_human_handoff',{p_call_id:value.callId,p_worker_id:value.workerId,p_id:value.id,p_phase:value.phase}));
}
export async function releaseHumanRuntime(db:SupabaseClient,input:unknown){
 const parsed=humanRuntimeRelease.safeParse(input);if(!parsed.success)throw new VoiceHandoffError('invalid');const value=parsed.data;
 const current=await pollHumanRuntime(db,{callId:value.callId,workerId:value.workerId});
 if(current.id!==value.id||!['ended','failed','expired'].includes(current.state??''))throw new VoiceHandoffError('changed');
 await livekit().client.removeParticipant(current.room,humanParticipantIdentity(value.id),{revokeTokenTs:BigInt(Math.floor(Date.now()/1000)+1)});
 return true;
}
export async function beginControlledVoiceTool(db:SupabaseClient,callId:string){
 if(!SHOW_RIVERZ_IMPROVEMENTS)return null;if(!uuid.safeParse(callId).success)throw new VoiceHandoffError('invalid');
 return parse(uuid,await rpc(db,'begin_controlled_voice_tool',{p_call_id:callId}));
}
export async function finishControlledVoiceTool(db:SupabaseClient,callId:string,slotId:string){return parse(z.boolean(),await rpc(db,'finish_controlled_voice_tool',{p_call_id:callId,p_slot_id:slotId}));}
