import 'server-only';
import {ConnectorClient,DisconnectWhatsAppCallRequest_DisconnectReason,RoomAgentDispatch,SessionDescription} from 'livekit-server-sdk';
import {z} from 'zod';
import {roomNameForCall,VOICE_AGENT_NAME} from './livekit';
import {whatsappCallId,whatsappSdp,whatsappVoiceBinding,whatsappParticipantIdentity,type WhatsAppVoiceBinding} from './whatsapp-calling-contract';

export class WhatsAppVoiceError extends Error{
 constructor(public readonly code:'invalid'|'notAllowed'|'unavailable'|'uncertain'){super(`whatsapp_voice_${code}`);}
}
type ConnectorPort=Pick<ConnectorClient,'acceptWhatsAppCall'|'dialWhatsAppCall'|'connectWhatsAppCall'|'disconnectWhatsAppCall'>;
type Authorization=(binding:WhatsAppVoiceBinding,operation:'accept'|'dial'|'connect'|'disconnect')=>Promise<boolean>;
const tokenSchema=z.string().min(1).max(8192).refine(value=>!/[\s\0]/.test(value));
function binding(value:unknown){const result=whatsappVoiceBinding.safeParse(value);if(!result.success)throw new WhatsAppVoiceError('invalid');return result.data;}
function token(value:unknown){const result=tokenSchema.safeParse(value);if(!result.success)throw new WhatsAppVoiceError('unavailable');return result.data;}
function sdp(value:unknown,type:'offer'|'answer'){
 const result=whatsappSdp.safeParse(value);if(!result.success||result.data.type!==type)throw new WhatsAppVoiceError('invalid');
 return new SessionDescription(result.data);
}
function client():ConnectorPort{
 const url=process.env.LIVEKIT_URL,key=process.env.LIVEKIT_API_KEY,secret=process.env.LIVEKIT_API_SECRET;
 if(!url||!key||!secret)throw new WhatsAppVoiceError('unavailable');
 let host:URL;try{host=new URL(url);}catch{throw new WhatsAppVoiceError('unavailable');}
 if(host.protocol!=='wss:'||!host.hostname.endsWith('.livekit.cloud')||host.username||host.password||host.port||host.pathname!=='/'||host.search||host.hash)throw new WhatsAppVoiceError('unavailable');
 // A timeout can occur after Meta started a call. No SDK region failover or
 // transport retry may silently initiate a second physical call.
 return new ConnectorClient(url.replace(/^wss:/,'https:'),key,secret,{requestTimeout:10,failover:false});
}

/** Internal adapter only. The service must authorize against the durable
 * call/connection and, for outbound, current Meta permission before each RPC.
 * Acknowledgement means accepted by the connector, never answered/media ready.
 */
export function createWhatsAppConnector(authorize:Authorization,port?:ConnectorPort){
 async function allowed(value:unknown,operation:Parameters<Authorization>[1]){
  const parsed=binding(value);if(!await authorize(parsed,operation))throw new WhatsAppVoiceError('notAllowed');return parsed;
 }
 async function once<T>(run:(sdk:ConnectorPort)=>Promise<T>):Promise<T>{
  const sdk=port??client();try{return await run(sdk);}catch{throw new WhatsAppVoiceError('uncertain');}
 }
 function options(value:WhatsAppVoiceBinding,accessToken:string){
  return {whatsappPhoneNumberId:value.phoneNumberId,whatsappApiKey:token(accessToken),whatsappCloudApiVersion:value.apiVersion,
   roomName:roomNameForCall(value.callId),participantIdentity:whatsappParticipantIdentity(value.callId),whatsappBizOpaqueCallbackData:`riverz:${value.callId}`,
   participantAttributes:{'riverz.call':value.callId,'riverz.workspace':value.workspaceId,'riverz.transport':'whatsapp'},
   agents:[new RoomAgentDispatch({agentName:VOICE_AGENT_NAME,metadata:JSON.stringify({call_id:value.callId,workspace_id:value.workspaceId,transport:'whatsapp'})})]};
 }
 return {
  async accept(value:unknown,accessToken:string,offer:unknown){
   const parsed=binding(value);if(parsed.direction!=='inbound'||!parsed.providerCallId)throw new WhatsAppVoiceError('invalid');
   const description=sdp(offer,'offer'),request=options(parsed,accessToken);await allowed(parsed,'accept');
   const result=await once(sdk=>sdk.acceptWhatsAppCall({...request,whatsappCallId:parsed.providerCallId!,sdp:description,waitUntilAnswered:false,timeout:10}));
   if(result.roomName!==request.roomName)throw new WhatsAppVoiceError('uncertain');return {accepted:true as const,roomName:request.roomName};
  },
  async dial(value:unknown,accessToken:string){
   const parsed=binding(value);if(parsed.direction!=='outbound'||parsed.providerCallId!==null)throw new WhatsAppVoiceError('invalid');
   const request=options(parsed,accessToken);await allowed(parsed,'dial');
   const result=await once(sdk=>sdk.dialWhatsAppCall({...request,whatsappToPhoneNumber:parsed.peer,ringingTimeout:30}));
   if(result.roomName!==request.roomName||!whatsappCallId.safeParse(result.whatsappCallId).success)throw new WhatsAppVoiceError('uncertain');
   return {initiated:true as const,providerCallId:result.whatsappCallId,roomName:request.roomName};
  },
  async connect(value:unknown,answer:unknown){
   const parsed=binding(value);if(parsed.direction!=='outbound'||!parsed.providerCallId)throw new WhatsAppVoiceError('invalid');
   const description=sdp(answer,'answer');await allowed(parsed,'connect');
   await once(sdk=>sdk.connectWhatsAppCall(parsed.providerCallId!,description));return {accepted:true as const};
  },
  async disconnect(value:unknown,reason:'user'|'business',accessToken?:string){
   const parsed=binding(value);if(!parsed.providerCallId||!['user','business'].includes(reason))throw new WhatsAppVoiceError('invalid');
   const access=reason==='user'?'':token(accessToken);await allowed(parsed,'disconnect');
   await once(sdk=>sdk.disconnectWhatsAppCall(parsed.providerCallId!,access,reason==='user'?DisconnectWhatsAppCallRequest_DisconnectReason.USER_INITIATED:DisconnectWhatsAppCallRequest_DisconnectReason.BUSINESS_INITIATED));
   return {disconnected:true as const};
  },
 };
}
