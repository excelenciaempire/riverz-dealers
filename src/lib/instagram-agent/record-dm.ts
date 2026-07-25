import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection } from '@/types';

/**
 * Deja constancia en la BANDEJA del DM que el agente acaba de enviar.
 *
 * El adapter de Instagram solo habla con Meta; no persiste nada. Sin esto, los
 * DMs proactivos (campaña, alcance en tiempo real, cierre, aprobación) salían
 * de verdad pero no existían en la app: el comercio no podía leer lo que su
 * agente le dijo a un cliente, y cuando la persona respondía se abría un hilo
 * sin contexto. Los echos de Meta tampoco lo cubren: llegan solo para la
 * cuenta cuando Meta los emite, y para las respuestas privadas a comentarios
 * no aparecen.
 *
 * Busca (o crea) la conversación de DM del contacto y escribe el mensaje como
 * saliente del bot, igual que el runner y los seguimientos. Best-effort: nunca
 * lanza — un fallo aquí no debe tumbar un envío que ya ocurrió.
 */
export async function recordProactiveDm(
  db: SupabaseClient,
  input: {
    workspaceId: string;
    contactId: string;
    connection: ChannelConnection;
    text: string;
    externalMessageId?: string | null;
  },
): Promise<void> {
  try {
    const now = new Date().toISOString();
    const preview = input.text.slice(0, 200);

    const { data: existing } = await db
      .from('conversations')
      .select('id')
      .eq('workspace_id', input.workspaceId)
      .eq('contact_id', input.contactId)
      .eq('channel', 'instagram')
      .is('deleted_at', null)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let conversationId = (existing as { id?: string } | null)?.id ?? null;
    if (!conversationId) {
      const { data: created } = await db
        .from('conversations')
        .insert({
          workspace_id: input.workspaceId,
          contact_id: input.contactId,
          channel: 'instagram',
          connection_id: input.connection.id,
          status: 'open',
          last_message_text: preview,
          last_message_at: now,
          last_sender_type: 'bot',
          unread_count: 0,
        })
        .select('id')
        .single();
      conversationId = (created as { id?: string } | null)?.id ?? null;
    }
    if (!conversationId) return;

    await db.from('messages').insert({
      conversation_id: conversationId,
      channel: 'instagram',
      sender_type: 'bot',
      content_type: 'text',
      content_text: input.text,
      message_id: input.externalMessageId ?? null,
      status: 'sent',
    });
    await db
      .from('conversations')
      .update({
        last_message_text: preview,
        last_message_at: now,
        last_sender_type: 'bot',
        updated_at: now,
      })
      .eq('id', conversationId);
  } catch (err) {
    console.error('[ig-agent] no se pudo registrar el DM en la bandeja:', err);
  }
}
