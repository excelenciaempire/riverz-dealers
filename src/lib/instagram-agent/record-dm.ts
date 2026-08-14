import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection } from '@/types';
import { upsertContact } from '@/lib/channels/inbox-writer';

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
 * IMPORTANTE (fix duplicado 2026-07-27): si el destinatario es un comentarista
 * nuevo, todavía NO existe su contacto `instagram` — antes caíamos al contacto
 * del comentario y creábamos una conversación DM bajo ÉL; ~1s después el eco de
 * Meta creaba el contacto `instagram` real + su conversación → dos hilos que el
 * índice único no colapsa (distinto contact_id). Ahora resolvemos/creamos el
 * contacto `instagram` canónico con `upsertContact` (race-safe + hereda el
 * @usuario del comentario), así nuestra conversación y la del eco caen en el
 * mismo contacto y se colapsan en uno.
 *
 * Best-effort: nunca lanza — un fallo aquí no debe tumbar un envío que ya
 * ocurrió.
 */
export async function recordProactiveDm(
  db: SupabaseClient,
  input: {
    workspaceId: string;
    contactId: string;
    /** Id de Instagram/Facebook del destinatario (el que usará el eco de Meta). */
    externalId?: string | null;
    /**
     * Canal del DM: 'instagram' o 'messenger'. Un comentario de Facebook se
     * contesta por Messenger, y su copia va al hilo 'fb_comment' — sin esto
     * ambos quedaban escritos a mano como Instagram y la respuesta aparecía en
     * la conversación equivocada.
     */
    dmChannel?: 'instagram' | 'messenger';
    /** Canal del hilo de comentarios donde se espeja la copia. */
    commentChannel?: 'ig_comment' | 'fb_comment';
    connection: ChannelConnection;
    text: string;
    /**
     * Si el DM responde a un COMENTARIO, el id del contacto del comentario.
     * Refleja la respuesta también en el hilo del comentario para que se vea
     * en la pestaña Comentarios.
     */
    commentContactId?: string | null;
    /**
     * Qué funcionalidad lo mandó (migración 143). Se sella en la fila para que
     * la bandeja lo diga: Comentarios, Prospección, una regla… Además sobrevive
     * al eco de Meta, que se reconcilia contra esta misma fila en vez de
     * insertar otra.
     */
    origin?: string | null;
    originName?: string | null;
  },
): Promise<void> {
  try {
    const now = new Date().toISOString();
    const preview = input.text.slice(0, 200);
    const dmChannel = input.dmChannel ?? 'instagram';
    const commentChannel = input.commentChannel ?? 'ig_comment';

    // 1. Contacto CANÓNICO del lado DM (canal 'instagram', mismo IGSID que usará
    //    el eco). upsertContact es race-safe y hereda el nombre del comentario
    //    hermano. Antes se caía al contacto del comentario y partía el hilo.
    let contactId = input.contactId;
    if (input.externalId) {
      const dm = await upsertContact(db, {
        workspace_id: input.workspaceId,
        channel: dmChannel,
        external_id: input.externalId,
      });
      if (dm?.id) contactId = dm.id;
    }

    const { data: existing } = await db
      .from('conversations')
      .select('id')
      .eq('workspace_id', input.workspaceId)
      .eq('contact_id', contactId)
      .eq('channel', dmChannel)
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
          channel: dmChannel,
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
    if (!dupe) {
      await db.from('messages').insert({
        conversation_id: conversationId,
        channel: dmChannel,
        sender_type: 'agent',
        content_type: 'text',
        content_text: input.text,
        status: 'sent',
        origin: input.origin ?? null,
        origin_name: input.originName ?? null,
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
    }

    // 3. Si respondió a un comentario, reflejar la respuesta en el hilo del
    //    comentario (canal ig_comment) para que el comercio la vea en la pestaña
    //    Comentarios — la respuesta se envió como DM privado, así que sin esto el
    //    hilo del comentario solo mostraba el mensaje entrante.
    if (input.commentContactId) {
      await mirrorReplyToCommentThread(db, {
        workspaceId: input.workspaceId,
        commentContactId: input.commentContactId,
        commentChannel,
        text: input.text,
        preview,
        now,
        origin: input.origin ?? null,
        originName: input.originName ?? null,
      });
    }
  } catch (err) {
    console.error('[ig-agent] no se pudo registrar el DM en la bandeja:', err);
  }
}

/**
 * Refleja la respuesta del agente dentro de la conversación del COMENTARIO
 * (`ig_comment`) para que se vea en la pestaña Comentarios. La respuesta real
 * salió por DM privado; esto es solo una copia legible para el comercio.
 * Best-effort + dedup por texto reciente.
 */
async function mirrorReplyToCommentThread(
  db: SupabaseClient,
  args: {
    workspaceId: string;
    commentContactId: string;
    commentChannel: 'ig_comment' | 'fb_comment';
    text: string;
    preview: string;
    now: string;
    origin?: string | null;
    originName?: string | null;
  },
): Promise<void> {
  const { data: conv } = await db
    .from('conversations')
    .select('id')
    .eq('workspace_id', args.workspaceId)
    .eq('contact_id', args.commentContactId)
    .eq('channel', args.commentChannel)
    .is('deleted_at', null)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const convId = (conv as { id?: string } | null)?.id;
  if (!convId) return;

  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: dupe } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', convId)
    .eq('content_text', args.text)
    .gte('created_at', since)
    .limit(1)
    .maybeSingle();
  if (dupe) return;

  await db.from('messages').insert({
    conversation_id: convId,
    channel: args.commentChannel,
    sender_type: 'agent',
    content_type: 'text',
    content_text: args.text,
    status: 'sent',
    origin: args.origin ?? null,
    origin_name: args.originName ?? null,
  });
  await db
    .from('conversations')
    .update({
      last_message_text: args.preview,
      last_message_at: args.now,
      last_sender_type: 'agent',
      updated_at: args.now,
    })
    .eq('id', convId);
}
