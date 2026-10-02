import 'server-only';
import type {VoiceCall} from '@/types';
import {WHATSAPP_VOICE_META,savedWhatsAppVoiceBinding} from './whatsapp-calling-contract';

export function whatsappVoiceRate(direction:'inbound'|'outbound'){
 const name=direction==='inbound'?'VOICE_WHATSAPP_INBOUND_USD_PER_MIN':'VOICE_WHATSAPP_OUTBOUND_USD_PER_MIN';
 const raw=process.env[name],rate=raw?.trim()?Number(raw):NaN;
 if(!Number.isFinite(rate)||rate<0)throw new Error('wallet_whatsapp_voice_rate_not_configured');return rate;
}
export function whatsappTelephonyRateForCall(call:Pick<VoiceCall,'id'|'workspace_id'|'direction'|'context'>):number|null{
 if(!call.context||!(WHATSAPP_VOICE_META in call.context))return null;
 const reference=savedWhatsAppVoiceBinding(call.context);
 if(!reference||reference.callId!==call.id||reference.workspaceId!==call.workspace_id||reference.direction!==call.direction)throw new Error('wallet_invalid_whatsapp_voice_binding');
 return whatsappVoiceRate(call.direction);
}
