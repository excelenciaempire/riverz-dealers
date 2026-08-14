/**
 * WhatsApp durante una llamada de voz.
 *
 * Por teléfono no se puede dictar un link de pago: nadie lo anota bien y el TTS
 * lo deletrea ("hache te te pe ese dos puntos barra barra"). La salida es
 * mandárselo por WhatsApp al MISMO número al que se está llamando, mientras la
 * conversación sigue.
 *
 * El mensaje se escribe también en la bandeja, así el comercio ve en el hilo
 * del cliente lo que el agente le mandó por teléfono.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact, VoiceCall } from '@/types';
import { sendTextMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';

/** Lo que ve el modelo como resultado de la tool. */
export interface ToolResult {
  ok: boolean;
  result?: string;
  error?: string;
}

export async function sendWhatsAppDuringCall(
  db: SupabaseClient,
  call: VoiceCall,
  contact: Contact,
  text: string,
): Promise<ToolResult> {
  // El opt-out de WhatsApp es independiente del de llamadas: que acepte que lo
  // llamen no significa que acepte que le escriban.
  if ((contact as { opted_out?: boolean }).opted_out) {
    return { ok: false, error: 'contact_opted_out' };
  }

  const { data: cfg } = await db
    .from('whatsapp_config')
    .select('phone_number_id, access_token, status')
    .eq('workspace_id', call.workspace_id)
    .maybeSingle();
  const config = cfg as {
    phone_number_id?: string;
    access_token?: string;
    status?: string;
  } | null;
  if (!config?.phone_number_id || !config.access_token) {
    // El modelo lee esto y puede decirle al cliente que se lo manda de otra
    // forma, en vez de prometer un WhatsApp que nunca va a llegar.
    return { ok: false, error: 'whatsapp_not_connected' };
  }

  // Se le escribe al número de la llamada: es el que el cliente tiene a mano.
  const to = sanitizePhoneForMeta(call.phone || contact.phone || '');
  if (!isValidE164(to)) return { ok: false, error: 'invalid_phone' };

  try {
    const res = await sendTextMessage({
      phoneNumberId: config.phone_number_id,
      accessToken: decrypt(config.access_token),
      to,
      text,
    });

    // Reflejarlo en la bandeja. Fail-soft: si esto falla el mensaje YA se envió,
    // y hacer fallar la tool le haría creer al agente que no llegó.
    if (call.conversation_id) {
      await db
        .from('messages')
        .insert({
          // Columnas REALES de `messages` (001 + 143). Antes se escribían
          // nombres que no existen (workspace_id, direction, content,
          // whatsapp_message_id, metadata): el insert fallaba entero y el
          // WhatsApp que el agente mandó por teléfono no aparecía en ningún
          // lado, aunque el cliente sí lo recibía.
          conversation_id: call.conversation_id,
          channel: 'whatsapp',
          sender_type: 'bot',
          content_type: 'text',
          content_text: text,
          message_id: res.messageId,
          status: 'sent',
          origin: 'voice_agent',
        })
        .then(
          () => undefined,
          (e) => console.warn('[voice/send_whatsapp] no se reflejó en la bandeja', e),
        );
    }

    return { ok: true, result: JSON.stringify({ sent: true }) };
  } catch (err) {
    console.error('[voice/send_whatsapp] falló el envío', err);
    return { ok: false, error: 'send_failed' };
  }
}
