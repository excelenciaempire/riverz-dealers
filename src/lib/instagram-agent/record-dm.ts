import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection } from '@/types';

/**
 * Deja constancia en la BANDEJA del DM que el agente acaba de enviar.
 *
 * El adapter de Instagram solo habla con Meta; no persiste nada. Sin esto, un
 * DM proactivo salía de verdad pero podía no existir en la app hasta que Meta
 * mandara su eco, y el comercio no tenía forma de leer lo que su agente le
 * dijo a un cliente.
 *
 * Se escribe en el MISMO hilo donde caerá el eco —el contacto del canal DM
 * (`instagram`) con ese id de Instagram, no el contacto hermano nacido del
 * comentario— y como saliente sin `message_id`. Así, cuando el eco llegue, el
 * reconciliador de inbox-writer lo empareja con esta fila (misma conversación,
 * mismo texto, reciente, sin id) en vez de duplicar el mensaje.
 *
 * Best-effort: nunca lanza — un fallo aquí no debe tumbar un envío que ya
 * ocurrió.
 */
export async function recordProactiveDm(
  db: SupabaseClient,
  input: {
    workspaceId: string;
    contactId: string;
    /** Id de Instagram del destinatario (el que usará el eco de Meta). */
    externalId?: string | null;
    connection: ChannelConnection;
    text: string;
  },
): Promise<void> {
  try {
    const now = new Date().toISOString();
    const preview = input.text.slice(0, 200);

    // 1. El contacto del lado DM: el eco de Meta usa (workspace, 'instagram',
    //    IGSID). Si existe, es ahí donde debe ir el mensaje.
    let contactId = input.contactId;
    if (input.externalId) {
      const { data: dmContact } = await db
        .from('contacts')
        .select('id')
        .eq('workspace_id', input.workspaceId)
        .eq('channel', 'instagram')
        .eq('external_id', input.externalId)
        .limit(1)
        .maybeSingle();
      const found = (dmContact as { id?: string } | null)?.id;
      if (found) contactId = found;
    }

    const { data: existing } = await db
      .from('conversations')
      .select('id')
      .eq('workspace_id', input.workspaceId)
      .eq('contact_id', contactId)
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
          contact_id: contactId,
          channel: 'instagram',
          connection_id: input.connection.id,
          status: 'open',
          last_message_text: preview,
          last_message_at: now,
          last_sender_type: 'agent',
          unread_count: 0,
        })
        .select('id')
        .single();
      conversationId = (created as { id?: string } | null)?.id ?? null;
    }
    if (!conversationId) return;

    // 2. ¿Ya está? (el eco pudo ganarnos la carrera). Mismo hilo + mismo texto
    //    en los últimos minutos = el mismo mensaje.
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    const { data: dupe } = await db
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('content_text', input.text)
      .gte('created_at', since)
      .limit(1)
      .maybeSingle();
    if (dupe) return;

    await db.from('messages').insert({
      conversation_id: conversationId,
      channel: 'instagram',
      sender_type: 'agent',
      content_type: 'text',
      content_text: input.text,
      status: 'sent',
    });
    await db
      .from('conversations')
      .update({
        last_message_text: preview,
        last_message_at: now,
        last_sender_type: 'agent',
        updated_at: now,
      })
      .eq('id', conversationId);
  } catch (err) {
    console.error('[ig-agent] no se pudo registrar el DM en la bandeja:', err);
  }
}
