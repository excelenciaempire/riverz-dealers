import type { SupabaseClient } from '@supabase/supabase-js';
import type { InboundEvent } from '@/lib/channels/types';
import type { Conversation, Message } from '@/types';
import { isOptInKeyword, isOptOutKeyword } from '@/lib/whatsapp/opt-out';
import { isStoryMentionOrShareOnly } from '@/lib/channels/meta-attachments';
import { esRespuestaAutomatica } from '@/lib/channels/respuesta-automatica';

export function shouldDeferBillingReply(event: InboundEvent, conversation: Conversation): boolean {
  if(event.outbound || event.historical || event.suppressAutoReply || !event.text.trim() && !event.attachments?.length) return false;
  if(isOptInKeyword(event.text) || isOptOutKeyword(event.text))return false;
  if(event.channel==='instagram' && isStoryMentionOrShareOnly(event.text))return false;
  return !esRespuestaAutomatica({texto:event.text,ultimoRemitente:conversation.last_sender_type??null,
    ultimoMensajeAt:conversation.last_message_at??null,recibidoAt:event.receivedAt});
}

export async function deferBillingReply(db: SupabaseClient, event: InboundEvent, conversation: Conversation, message: Message) {
  if(!shouldDeferBillingReply(event,conversation))return;
  const {error}=await db.from('billing_reply_backlog').upsert({
    inbound_message_id:message.id,workspace_id:event.connection.workspace_id,
    conversation_id:conversation.id,connection_id:event.connection.id,
  },{onConflict:'inbound_message_id',ignoreDuplicates:true});
  if(error)throw new Error('billing_reply_deferral_failed');
}
