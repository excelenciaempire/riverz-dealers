import 'server-only';
import {createPublicKey,verify} from 'node:crypto';
import {z} from 'zod';
import {ExpansionProviderError} from './provider-http';
import {smsCost,smsMessageId,smsPhone,smsProviderStatus} from './sms-contract';
const envelope=z.object({data:z.object({id:z.string().uuid(),event_type:z.string(),occurred_at:z.string().datetime({offset:true}),payload:z.unknown()}).passthrough()}).passthrough();
const payload=z.object({id:smsMessageId,type:z.literal('SMS'),direction:z.enum(['inbound','outbound']),organization_id:z.string().uuid(),messaging_profile_id:z.string().uuid(),from:z.object({phone_number:smsPhone}).passthrough(),to:z.array(z.object({phone_number:smsPhone,status:z.string().max(64).optional()}).passthrough()).length(1),text:z.string().max(6700).nullable().optional(),autoresponse_type:z.enum(['STOP','START','HELP']).nullable().optional(),parts:z.number().int().min(1).max(10).nullable().optional(),cost:smsCost.nullable().optional()}).passthrough();
function base64(value:unknown,bytes:number):Buffer{
 if(typeof value!=='string')throw new ExpansionProviderError('invalid');const decoded=Buffer.from(value,'base64');
 if(decoded.length!==bytes||decoded.toString('base64')!==value)throw new ExpansionProviderError('invalid');return decoded;
}
/** Signature covers the original timestamp and bytes. JSON is parsed only
 * afterwards, without stringify, charset normalization or newline changes.
 * Event IDs are returned for durable deduplication by the queue layer.
 */
export function verifyTelnyxSmsEvent(rawBody:Uint8Array,signature:unknown,timestamp:unknown,accountPublicKey:unknown,now=Date.now()){
 if(rawBody.byteLength===0||rawBody.byteLength>128*1024||typeof timestamp!=='string'||!/^[1-9]\d{8,12}$/.test(timestamp)||!Number.isFinite(now)||Math.abs(Number(timestamp)*1000-now)>300000)throw new ExpansionProviderError('invalid');
 const sig=base64(signature,64),key=base64(accountPublicKey,32);
 try{
  const publicKey=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),key]),format:'der',type:'spki'});
  if(!verify(null,Buffer.concat([Buffer.from(timestamp+'|','utf8'),Buffer.from(rawBody)]),publicKey,sig))throw new Error('signature');
 }catch{throw new ExpansionProviderError('invalid');}
 let json:unknown;try{json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(rawBody));}catch{throw new ExpansionProviderError('invalid');}
 const parsed=envelope.safeParse(json);if(!parsed.success)throw new ExpansionProviderError('invalid');
 const event=parsed.data.data;if(!['message.received','message.sent','message.finalized'].includes(event.event_type))return null;
 if(event.payload!==null&&typeof event.payload==='object'&&'type' in event.payload&&event.payload.type!=='SMS')return null;
 const p=payload.safeParse(event.payload);if(!p.success)throw new ExpansionProviderError('invalid');const value=p.data;
 if((event.event_type==='message.received')!==(value.direction==='inbound'))throw new ExpansionProviderError('invalid');
 const status=value.direction==='outbound'?smsProviderStatus.safeParse(value.to[0].status):null;
 if(status&&!status.success)throw new ExpansionProviderError('invalid');
 return {eventId:event.id,eventType:event.event_type,occurredAt:event.occurred_at,messageId:value.id,organizationId:value.organization_id,profileId:value.messaging_profile_id,direction:value.direction,
  businessPhone:value.direction==='inbound'?value.to[0].phone_number:value.from.phone_number,peer:value.direction==='inbound'?value.from.phone_number:value.to[0].phone_number,
  text:value.text??'',status:status?.success?status.data:null,optOutAction:value.direction==='inbound'?value.autoresponse_type??null:null,parts:value.parts??null,cost:value.cost??null};
}
