import {z} from 'zod';
import {whatsappCallId,whatsappPhoneId,whatsappPeer,whatsappSdp} from './whatsapp-calling-contract';

const unix=z.string().regex(/^\d{1,12}$/).transform(Number).refine(value=>Number.isSafeInteger(value)&&value>0&&value<=253402300799);
const event=z.object({id:whatsappCallId,event:z.enum(['connect','terminate']),direction:z.enum(['USER_INITIATED','BUSINESS_INITIATED']),timestamp:unix,
 from:z.string().max(128).optional(),to:z.string().max(128).optional(),from_user_id:z.string().min(1).max(128).optional(),to_user_id:z.string().min(1).max(128).optional(),
 session:z.object({sdp_type:z.enum(['offer','answer']),sdp:z.string()}).passthrough().optional(),status:z.enum(['COMPLETED','FAILED']).optional(),
 biz_opaque_callback_data:z.string().max(512).optional(),
}).passthrough();
export interface WhatsAppCallEvent{
 wabaId:string;phoneNumberId:string;providerCallId:string;direction:'inbound'|'outbound';event:'connect'|'terminate';
 peer:string|null;peerUserId:string|null;timestamp:number;sdp:{type:'offer'|'answer';sdp:string}|null;status:'COMPLETED'|'FAILED'|null;callbackData:string|null;
}
/** Only call after the existing raw-byte Meta signature check. Unknown BSUID
 * peers remain explicit; they must never be guessed from a business number or
 * mapped into a phone-only connector request.
 */
export function parseWhatsAppCallEvents(body:unknown):{events:WhatsAppCallEvent[];invalid:number}{
 const envelope=z.object({object:z.literal('whatsapp_business_account'),entry:z.array(z.object({id:whatsappPhoneId,changes:z.array(z.object({field:z.string(),value:z.unknown()}).passthrough()).max(100)}).passthrough()).max(100)}).passthrough().safeParse(body);
 if(!envelope.success)return {events:[],invalid:1};const events:WhatsAppCallEvent[]=[];let invalid=0;
 let inspected=0;
 outer:for(const entry of envelope.data.entry)for(const change of entry.changes){
  if(change.field!=='calls')continue;
  const value=z.object({metadata:z.object({phone_number_id:whatsappPhoneId}).passthrough(),calls:z.array(z.unknown()).max(100)}).passthrough().safeParse(change.value);
  if(!value.success){invalid++;continue;}
  for(const raw of value.data.calls){
   if(++inspected>100){invalid++;break outer;}
   const parsed=event.safeParse(raw);if(!parsed.success){invalid++;continue;}const call=parsed.data,inbound=call.direction==='USER_INITIATED';
   const peerRaw=inbound?call.from:call.to,peerParsed=whatsappPeer.safeParse(peerRaw?.replace(/^\+/,'')),peerUserId=(inbound?call.from_user_id:call.to_user_id)??null;
   if(!peerParsed.success&&!peerUserId){invalid++;continue;}
   const description=call.session?whatsappSdp.safeParse({type:call.session.sdp_type,sdp:call.session.sdp}):null;
   if(call.event==='connect'&&(!description?.success||description.data.type!==(inbound?'offer':'answer'))){invalid++;continue;}
   if(call.event==='terminate'&&!call.status){invalid++;continue;}
   events.push({wabaId:entry.id,phoneNumberId:value.data.metadata.phone_number_id,providerCallId:call.id,direction:inbound?'inbound':'outbound',event:call.event,
    peer:peerParsed.success?peerParsed.data:null,peerUserId,timestamp:call.timestamp,sdp:call.event==='connect'&&description?.success?description.data:null,status:call.status??null,callbackData:call.biz_opaque_callback_data??null});
  }
 }
 return {events,invalid};
}
export function freshWhatsAppCallOffer(value:WhatsAppCallEvent,now=Date.now()){
 const age=now-value.timestamp*1000;return value.event==='connect'&&age>=-15000&&age<=90000;
}
