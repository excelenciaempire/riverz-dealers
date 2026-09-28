import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection } from '@/types';
import { upsertContact } from '@/lib/channels/inbox-writer';

/**
 * Las tres redes con comentarios. TikTok entra igual que las otras dos aunque
 * no tenga privado: lo que se publica bajo el video también es una respuesta y
 * también tiene que verse en la bandeja.
 */
export type CommentChannel = 'ig_comment' | 'fb_comment' | 'tiktok_comment';

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
    commentChannel?: CommentChannel;
    connection: ChannelConnection;
    text: string;
    /**
     * El id que devolvió Meta al enviar el DM, si lo tenemos.
     *
     * Es lo que cierra la carrera contra el eco (bug 2026-08-29, conv
     * a156305e: dos filas idénticas a 1,27 s). La comprobación por texto de más
     * abajo no alcanza porque el eco se FECHA con `receivedAt` —más viejo— pero
     * se INSERTA después: al momento de mirar, la fila todavía no existía.
     * Guardando el id real, el eco choca contra la idempotencia global por
     * `message_id` del inbox-writer y contra `uniq_msg_per_conv`, y no entra.
     */
    dmMessageId?: string | null;
    /**
     * Si el DM responde a un COMENTARIO, el id del contacto del comentario.
     * Refleja la respuesta también en el hilo del comentario para que se vea
     * en la pestaña Comentarios.
     */
    commentContactId?: string | null;
    /**
     * El comentario que provocó este DM.
     *
     * Sin esto el hilo privado se abría con NUESTRO mensaje y nada más: el
     * comercio entraba y veía al agente hablándole a nadie, sin saber por qué
     * ni a raíz de qué. Lo que la persona dijo estaba en el otro hilo (el del
     * comentario) y no había forma de relacionarlos mirando la bandeja.
     */
    commentText?: string | null;
    sourceCommentMessageId?: string | null;
    sourceCommentExternalId?: string | null;
    /**
     * Qué funcionalidad lo mandó (migración 143). Se sella en la fila para que
     * la bandeja lo diga: Comentarios, Prospección, una regla… Además sobrevive
     * al eco de Meta, que se reconcilia contra esta misma fila en vez de
     * insertar otra.
     */
    origin?: string | null;
    originName?: string | null;
  },
): Promise<string | null> {
  // Devuelve la conversación de DM donde quedó el mensaje (null si no se pudo
  // registrar): quien lo mandó a mano puede ir a verla sin buscarla a ojo.
  try {
    const now = new Date().toISOString();
    const preview = input.text.slice(0, 200);
    const dmChannel = input.dmChannel ?? 'instagram';
    const commentChannel = input.commentChannel ?? 'ig_comment';
    // Link to the exact comment, not the first post stored on the grouped thread.
    let sourceCommentId: string | null = null;
    if (input.sourceCommentMessageId || input.sourceCommentExternalId) {
      let query = db.from('messages').select('id, conversations!inner(workspace_id)')
        .eq('channel', commentChannel).eq('conversations.workspace_id', input.workspaceId)
        .eq('sender_type', 'customer').is('deleted_at', null);
      query = input.sourceCommentMessageId
        ? query.eq('id', input.sourceCommentMessageId)
        : query.eq('message_id', input.sourceCommentExternalId!);
      const { data } = await query.limit(2);
      if (data?.length === 1) sourceCommentId = data[0].id;
    }

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
    const hiloNuevo = !conversationId;
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
    if (!conversationId) return null;

    // 1.b El comentario que abrió el privado, como primer mensaje del hilo.
    //     Sólo al crearlo: en un hilo que ya existía la conversación se lee
    //     sola. No suma no leídos —ese comentario ya cuenta en su propio
    //     hilo— y se guarda sin `message_id` para que el eco de Meta no
    //     choque con él.
    const comentario = (input.commentText ?? '').trim();
    if (hiloNuevo && comentario) {
      await db.from('messages').insert({
        conversation_id: conversationId,
        channel: dmChannel,
        sender_type: 'customer',
        content_type: 'text',
        content_text: comentario,
        status: 'delivered',
        // Con etiqueta: sin ella, el hilo privado empieza con algo que la
        // persona escribió debajo de una foto y parece un DM que mandó de la
        // nada. Así la bandeja dice de dónde salió esta conversación.
        origin: 'comment_inbound',
        reply_to_message_id: sourceCommentId,
      });
    }

    // 2. ¿Ya está? (el eco pudo ganarnos la carrera). Mismo hilo + mismo texto
    //    en los últimos minutos = el mismo mensaje. Red de respaldo: el candado
    //    de verdad es `message_id` (ver `dmMessageId`), que esta consulta no
    //    puede dar porque el eco se fecha viejo y se inserta tarde.
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
        message_id: input.dmMessageId ?? null,
        origin: input.origin ?? null,
        origin_name: input.originName ?? null,
        reply_to_message_id: sourceCommentId,
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
    return conversationId;
  } catch (err) {
    console.error('[ig-agent] no se pudo registrar el DM en la bandeja:', err);
    return null;
  }
}

/**
 * Deja constancia en la bandeja de una respuesta PÚBLICA que acabamos de
 * publicar bajo el comentario.
 *
 * Hasta ahora nadie la escribía: se confiaba en el eco de Meta, y Meta no
 * manda webhook por los comentarios de la propia cuenta. La única red que la
 * traía era la conciliación de `comment-sync`, cada diez minutos — así que el
 * comercio entraba a la bandeja, veía la pregunta del cliente y ninguna
 * respuesta, justo en los modos en los que la respuesta ES la pública ("Solo
 * en el comentario") y no hay DM que espejar.
 *
 * Se guarda con el id externo del comentario que devolvió Meta, así que cuando
 * la conciliación pase por ahí reconoce que ya está y no duplica nada.
 */
export async function recordPublicCommentReply(
  db: SupabaseClient,
  args: {
    workspaceId: string;
    /** El contacto del hilo de comentarios (quien comentó). */
    commentContactId: string;
    commentChannel: CommentChannel;
    text: string;
    /** Id que devolvió Meta para NUESTRA respuesta. Es lo que corta duplicados. */
    externalId?: string | null;
    origin?: string | null;
    originName?: string | null;
  },
): Promise<void> {
  if (!args.text.trim()) return;
  try {
    const now = new Date().toISOString();
    await mirrorReplyToCommentThread(db, {
      workspaceId: args.workspaceId,
      commentContactId: args.commentContactId,
      commentChannel: args.commentChannel,
      text: args.text,
      preview: args.text.slice(0, 200),
      now,
      externalId: args.externalId ?? null,
      origin: args.origin ?? null,
      originName: args.originName ?? null,
    });
  } catch (err) {
    console.error('[ig-agent] respuesta pública no registrada en la bandeja:', err);
  }
}

/**
 * Refleja la respuesta del agente dentro de la conversación del COMENTARIO
 * (`ig_comment`) para que se vea en la pestaña Comentarios. Con `externalId`
 * es la respuesta pública de verdad; sin él, una copia legible del DM privado.
 * Best-effort + dedup por id externo y por texto reciente.
 */
async function mirrorReplyToCommentThread(
  db: SupabaseClient,
  args: {
    workspaceId: string;
    commentContactId: string;
    commentChannel: CommentChannel;
    text: string;
    preview: string;
    now: string;
    externalId?: string | null;
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

  // El id externo manda: es exacto y no caduca. La conciliación de
  // `comment-sync` puede habernos ganado la carrera.
  const externalId = (args.externalId ?? '').trim();
  if (externalId) {
    const { data: already } = await db
      .from('messages')
      .select('id')
      .eq('conversation_id', convId)
      .eq('message_id', externalId)
      .limit(1)
      .maybeSingle();
    if (already) return;
  }

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
    message_id: externalId || null,
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
      // Una respuesta pública ya atendió este comentario. Sin esto el punto de
      // no leído queda prendido aunque el hilo termine con nuestra respuesta,
      // y la bandeja lo presenta como trabajo pendiente.
      unread_count: 0,
      updated_at: args.now,
    })
    .eq('id', convId);
}
