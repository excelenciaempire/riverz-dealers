import {z} from 'zod';

// Provider IDs are opaque strings, not URLs or an invented Base64 alphabet.
export const whatsappCallId=z.string().min(1).max(256).refine(value=>!/[\s\u0000-\u001f\u007f]/u.test(value));
export const whatsappPhoneId=z.string().min(1).max(32).regex(/^\d+$/);
export const whatsappPeer=z.string().regex(/^[1-9]\d{6,14}$/);
export const whatsappCallingVersion=z.enum(['23.0','24.0','25.0','26.0']);
export const WHATSAPP_VOICE_META='__whatsapp_call' as const;
export const whatsappVoiceBinding=z.object({
 version:z.literal(1),callId:z.string().uuid(),workspaceId:z.string().uuid(),connectionId:z.string().uuid(),
 phoneNumberId:whatsappPhoneId,wabaId:whatsappPhoneId,peer:whatsappPeer,
 direction:z.enum(['inbound','outbound']),apiVersion:whatsappCallingVersion,
 providerCallId:whatsappCallId.nullable(),
}).strict().refine(value=>value.direction!=='inbound'||value.providerCallId!==null);
export type WhatsAppVoiceBinding=z.infer<typeof whatsappVoiceBinding>;
export const whatsappCallingSettingsInput=z.object({inboundEnabled:z.boolean(),outboundEnabled:z.boolean(),apiVersion:whatsappCallingVersion}).strict();
export const whatsappSdp=z.object({type:z.enum(['offer','answer']),sdp:z.string().min(5).max(65536).startsWith('v=0').refine(value=>!value.includes('\0'))}).strict();

export function whatsappParticipantIdentity(callId:string){
 if(!z.string().uuid().safeParse(callId).success)throw new Error('invalid_whatsapp_call');
 return `whatsapp-${callId}`;
}
export function savedWhatsAppVoiceBinding(context:Record<string,unknown>|null|undefined):WhatsAppVoiceBinding|null{
 const parsed=whatsappVoiceBinding.safeParse(context?.[WHATSAPP_VOICE_META]);return parsed.success?parsed.data:null;
}
