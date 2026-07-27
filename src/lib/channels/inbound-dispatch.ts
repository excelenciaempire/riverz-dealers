import type { SupabaseClient } from '@supabase/supabase-js';
import type { Channel, Contact, Conversation, Message } from '@/types';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { dispatchInboundToFlows } from '@/lib/flows/engine';

/**
 * Automatizaciones y flujos sobre el camino de entrada UNIFICADO.
 *
 * Antes vivían sólo en el webhook legacy de WhatsApp
 * (`/api/whatsapp/webhook`), mientras que la IA vive sólo en el webhook
 * unificado (`/api/channels/[channel]/webhook` → `inbox-writer`). Los dos
 * caminos no se cruzaban nunca, así que QUIÉN respondía dependía de qué URL
 * estuviera registrada en Meta, no de ninguna opción del producto:
 *
 *   - por el legacy: disparaban automatizaciones y flujos, y la IA NUNCA
 *     entraba (ese archivo no importa nada de IA);
 *   - por el unificado: entraba la IA, y las automatizaciones de mensaje
 *     entrante y los flujos por palabra clave no disparaban jamás.
 *
 * Y en el resto de los canales (Instagram, Messenger, Gmail, Outlook,
 * Mercado Libre) las automatizaciones de entrada simplemente no existían.
 *
 * Regla de arbitraje (la del producto): las automatizaciones, plantillas y
 * campañas ENVÍAN; la IA CONVERSA. Cuando el cliente responde, entra la IA
 * con el contexto de lo que acaba de pasar — por eso una automatización que
 * respondió NO la silencia. La única excepción es un flujo que consumió el
 * mensaje: ahí el cliente está contestando a un guion interactivo (un
 * `collect_input`, un botón), y meter a la IA encima rompería el flujo.
 *
 * Devuelve `true` si un flujo consumió el mensaje ⇒ el llamador no debe
 * despachar la IA. Nunca lanza.
 */
export async function dispatchAutomationsAndFlows(
  db: SupabaseClient,
  args: {
    workspaceId: string;
    channel: Channel;
    conversation: Conversation;
    contact: Contact;
    message: Message;
    /** Primer mensaje entrante de este contacto (dispara los triggers de relación). */
    isFirstInboundMessage: boolean;
    /** El contacto se acaba de crear con este mensaje. */
    contactWasCreated: boolean;
  },
): Promise<boolean> {
  const text = args.message.content_text ?? '';
  let flowConsumed = false;

  // ── Flujos ──
  // Se esperan (no fire-and-forget) porque necesitamos saber si consumieron
  // el mensaje antes de decidir si habla la IA. Están indexados por usuario,
  // no por espacio de trabajo, así que resolvemos el dueño del hilo.
  try {
    const ownerUserId = (args.conversation as { user_id?: string | null }).user_id ?? null;
    if (ownerUserId) {
      const flowResult = await dispatchInboundToFlows({
        userId: ownerUserId,
        contactId: args.contact.id,
        conversationId: args.conversation.id,
        message: {
          kind: 'text',
          text,
          // Idempotencia del motor de flujos: sin id externo usamos el de la
          // fila, que también es único por mensaje.
          meta_message_id: args.message.message_id ?? args.message.id,
        },
        isFirstInboundMessage: args.isFirstInboundMessage,
      });
      flowConsumed = Boolean(flowResult?.consumed);
    }
  } catch (err) {
    console.error('[flows] dispatch failed:', err);
  }

  // ── Automatizaciones ──
  // Fire-and-forget: una automatización lenta no debe demorar el 200 OK al
  // webhook ni la respuesta de la IA.
  const triggers: Array<
    'new_contact_created' | 'first_inbound_message' | 'new_message_received' | 'keyword_match'
  > = [];
  // Los triggers de CONTENIDO se suprimen si un flujo ya consumió el mensaje
  // (mismo criterio que tenía el webhook legacy).
  if (!flowConsumed) triggers.push('new_message_received', 'keyword_match');
  // Los de RELACIÓN son sobre QUIÉN escribe, no sobre qué dijo: disparan igual.
  if (args.contactWasCreated) triggers.unshift('new_contact_created');
  if (args.isFirstInboundMessage) triggers.unshift('first_inbound_message');

  for (const triggerType of triggers) {
    void runAutomationsForTrigger({
      workspaceId: args.workspaceId,
      triggerType,
      contactId: args.contact.id,
      context: { message_text: text, conversation_id: args.conversation.id },
    }).catch((err) => console.error('[automations] dispatch failed:', err));
  }

  return flowConsumed;
}
