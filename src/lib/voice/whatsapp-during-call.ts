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
import { sendTemplateMessage, sendTextMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';

/** Lo que ve el modelo como resultado de la tool. */
export interface ToolResult {
  ok: boolean;
  result?: string;
  error?: string;
}

/**
 * Con qué plantilla se le escribe a alguien fuera de la ventana de 24 h.
 *
 * Una por escenario, y no una sola genérica, porque el encabezado es lo único
 * que el cliente lee antes de decidir si abre el mensaje: «aquí tienes el link
 * para completar tu compra» y «aquí tienes el seguimiento de tu pedido» no se
 * pueden decir con la misma frase sin sonar a mensaje automático.
 *
 * Todas comparten la MISMA forma de variables —{{1}} nombre, {{2}} contenido en
 * una sola línea— para que elegir una no cambie cómo se arman los parámetros.
 * Y todas son UTILITY: Meta retiene las MARKETING en silencio, y esto no es
 * promoción sino la continuación por escrito de algo que el cliente acaba de
 * pedir por teléfono.
 */
export const PLANTILLAS_LLAMADA = {
  link_de_pago: 'llamada_link_de_pago',
  transferencia: 'llamada_datos_transferencia',
  resumen_pedido: 'llamada_resumen_pedido',
  info_producto: 'llamada_info_producto',
  seguimiento_envio: 'llamada_seguimiento_envio',
  otro: 'seguimiento_llamada',
} as const;

export type EscenarioWhatsApp = keyof typeof PLANTILLAS_LLAMADA;

function plantillaPara(escenario?: string | null): string {
  const k = (escenario ?? '') as EscenarioWhatsApp;
  return PLANTILLAS_LLAMADA[k] ?? PLANTILLAS_LLAMADA.otro;
}

/**
 * ¿Se le puede mandar texto libre a este contacto?
 *
 * Meta sólo lo permite dentro de las 24 h posteriores al último mensaje QUE
 * ESCRIBIÓ EL CLIENTE. Fuera de esa ventana el envío se acepta con un `wamid` y
 * falla después, por webhook, con el error 131047 «Re-engagement message» — o
 * sea que el `POST` devuelve 200 y la tool le contesta al agente que salió
 * bien. Pasó en producción el 2026-08-28: el agente dijo «ya te lo mandé», el
 * cliente colgó esperando el link, y el mensaje nunca llegó.
 *
 * Por eso se decide ANTES de mandar, no después: el resultado tardío no sirve
 * para elegir el camino.
 */
async function ventanaAbierta(
  db: SupabaseClient,
  conversationId: string | null,
): Promise<boolean> {
  if (!conversationId) return false;
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .gt('created_at', desde)
    .limit(1);
  return ((data ?? []) as unknown[]).length > 0;
}

/**
 * El texto del agente, en una sola línea.
 *
 * Un parámetro de plantilla con un salto de línea lo rechaza Meta entero, así
 * que los links van separados por un punto medio en vez de por renglones.
 */
function enUnaLinea(texto: string): string {
  return texto
    .replace(/\s*\n+\s*/g, ' · ')
    .replace(/\s{4,}/g, ' ')
    .trim()
    .slice(0, 900);
}

/**
 * El hilo de WhatsApp de este contacto: el que ya existe, o uno nuevo.
 *
 * Se reusa el que haya para que el mensaje caiga en la misma conversación que
 * el comercio ya conoce, en vez de abrir un hilo suelto por cada llamada.
 * Devuelve null si no se pudo: el envío ya salió y no se va a deshacer por no
 * poder anotarlo.
 */
async function hiloDeWhatsApp(
  db: SupabaseClient,
  call: VoiceCall,
): Promise<string | null> {
  try {
    const { data: existente } = await db
      .from('conversations')
      .select('id')
      .eq('workspace_id', call.workspace_id)
      .eq('contact_id', call.contact_id)
      .eq('channel', 'whatsapp')
      .is('deleted_at', null)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (existente) return (existente as { id: string }).id;

    const { data: conexion } = await db
      .from('channel_connections')
      .select('id')
      .eq('workspace_id', call.workspace_id)
      .eq('channel', 'whatsapp')
      .limit(1)
      .maybeSingle();

    const { data: creada } = await db
      .from('conversations')
      .insert({
        workspace_id: call.workspace_id,
        contact_id: call.contact_id,
        channel: 'whatsapp',
        connection_id: (conexion as { id: string } | null)?.id ?? null,
        status: 'open',
        last_sender_type: 'bot',
      })
      .select('id')
      .single();
    return (creada as { id: string } | null)?.id ?? null;
  } catch (e) {
    console.warn('[voice/send_whatsapp] no se pudo resolver el hilo', e);
    return null;
  }
}

export async function sendWhatsAppDuringCall(
  db: SupabaseClient,
  call: VoiceCall,
  contact: Contact,
  text: string,
  /** Qué pidió el cliente. Sólo decide la plantilla cuando la ventana está
   *  cerrada; dentro de las 24 h se manda el texto tal cual. */
  escenario?: string | null,
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

  // El hilo va PRIMERO: hace falta para saber si la ventana de 24 h está
  // abierta, que es lo que decide si se puede mandar texto libre o hay que ir
  // por plantilla.
  //
  // Va al hilo de WhatsApp del contacto, NO al de la llamada: durante la
  // llamada `call.conversation_id` todavía es null —la conversación de voz se
  // crea recién al final, con la transcripción— así que la condición de antes
  // no se cumplía nunca y el mensaje se enviaba sin dejar rastro en ningún
  // lado.
  const conversationId = await hiloDeWhatsApp(db, call);
  const abierta = await ventanaAbierta(db, conversationId);
  const accessToken = decrypt(config.access_token);

  try {
    const res = abierta
      ? await sendTextMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to,
          text,
        })
      : await sendTemplateMessage({
          // Fuera de la ventana Meta SÓLO acepta plantillas. El texto libre se
          // aceptaba con un wamid y fallaba después por webhook (131047), así
          // que el agente creía que había salido.
          phoneNumberId: config.phone_number_id,
          accessToken,
          to,
          templateName: plantillaPara(escenario),
          language: 'es',
          params: [
            (contact.name ?? '').trim().split(/\s+/)[0] || 'Hola',
            enUnaLinea(text),
          ],
        });

    // Reflejarlo en la bandeja. Fail-soft: si esto falla el mensaje YA se envió,
    // y hacer fallar la tool le haría creer al agente que no llegó.
    if (conversationId) {
      await db
        .from('messages')
        .insert({
          // Columnas REALES de `messages` (001 + 143). Antes se escribían
          // nombres que no existen (workspace_id, direction, content,
          // whatsapp_message_id, metadata): el insert fallaba entero y el
          // WhatsApp que el agente mandó por teléfono no aparecía en ningún
          // lado, aunque el cliente sí lo recibía.
          conversation_id: conversationId,
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
