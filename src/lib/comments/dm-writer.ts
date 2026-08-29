import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection, Contact, Conversation } from '@/types';
import type { OutboundText } from '@/lib/channels/types';
import { getAdapter } from '@/lib/channels/registry';
import { claimCommentPrivateReply } from '@/lib/instagram-agent/private-reply-lock';
import { recordProactiveDm } from '@/lib/instagram-agent/record-dm';

/**
 * Escribirle al PRIVADO a quien comentó, a mano, desde la bandeja.
 *
 * Hasta ahora sólo sabían hacerlo la IA y las reglas: una persona del equipo
 * leía un comentario que valía la pena y no tenía botón — tenía que abrir
 * Instagram, buscar a esa persona y escribirle desde ahí, y ese mensaje no
 * existía en Riverz.
 *
 * Dos caminos, en este orden:
 *   1. RESPUESTA PRIVADA al comentario (`recipient: { comment_id }`). Es la
 *      única vía para escribirle a alguien que sólo comentó: su id de autor no
 *      es un destinatario válido de mensajes. Meta permite una por comentario.
 *   2. Si esa falla —normalmente porque la respuesta privada de ese comentario
 *      ya se usó—, se intenta el DM normal por id, con la etiqueta de agente
 *      humano (ventana de 7 días). Si la persona ya escribió alguna vez, llega.
 *
 * El mensaje queda escrito en la bandeja en el acto y en los dos hilos: el
 * privado (donde sigue la conversación) y el del comentario (donde se ve por
 * qué se escribió). Sin `origin`: lo escribió una persona, y su burbuja no
 * lleva etiqueta de automatización.
 */

type CommentChannel = 'ig_comment' | 'fb_comment';

const DM_CHANNEL: Record<CommentChannel, 'instagram' | 'messenger'> = {
  ig_comment: 'instagram',
  fb_comment: 'messenger',
};

export interface CommentDmResult {
  /** La conversación de DM donde quedó el mensaje (para abrirla). */
  conversationId: string | null;
  /** Cómo salió: respuesta privada al comentario o DM normal. */
  via: 'private_reply' | 'dm';
}

export class CommentDmError extends Error {}

export async function sendCommentDm(
  db: SupabaseClient,
  args: { messageId: string; text: string },
): Promise<CommentDmResult> {
  const text = args.text.trim();
  if (!text) throw new CommentDmError('empty_text');

  const { data: msgRow } = await db
    .from('messages')
    .select('id, conversation_id, channel, message_id, sender_type')
    .eq('id', args.messageId)
    .maybeSingle();
  const message = msgRow as {
    conversation_id: string | null;
    channel: string | null;
    message_id: string | null;
    sender_type: string | null;
  } | null;
  if (!message?.conversation_id) throw new CommentDmError('message_not_found');
  if (message.channel !== 'ig_comment' && message.channel !== 'fb_comment') {
    throw new CommentDmError('not_a_comment');
  }
  const commentChannel = message.channel as CommentChannel;
  const dmChannel = DM_CHANNEL[commentChannel];

  const { data: convRow } = await db
    .from('conversations')
    .select('id, workspace_id, contact_id, connection_id')
    .eq('id', message.conversation_id)
    .maybeSingle();
  const conversation = convRow as {
    workspace_id: string;
    contact_id: string;
    connection_id: string | null;
  } | null;
  if (!conversation) throw new CommentDmError('conversation_not_found');

  const { data: contactRow } = await db
    .from('contacts')
    .select('id, external_id, name')
    .eq('id', conversation.contact_id)
    .maybeSingle();
  const contact = contactRow as {
    id: string;
    external_id: string | null;
    name: string | null;
  } | null;
  if (!contact) throw new CommentDmError('contact_not_found');

  // La cuenta que RECIBIÓ este comentario (migración 117), no "la última IG del
  // workspace": con dos cuentas conectadas, enviar por la otra lo rechaza Meta.
  const { data: metaRow } = await db
    .from('comments_meta')
    .select('connection_id')
    .eq('message_id', args.messageId)
    .maybeSingle();
  const connectionId =
    (metaRow as { connection_id: string | null } | null)?.connection_id ??
    conversation.connection_id;
  const source = connectionId ? await loadConnection(db, connectionId) : null;
  const connection = await dmConnectionFor(
    db,
    conversation.workspace_id,
    source,
    dmChannel,
  );
  if (!connection) throw new CommentDmError('channel_not_connected');

  const commentExternalId = message.message_id;
  const adapter = getAdapter(dmChannel);
  const base = {
    channel: dmChannel,
    connection,
    conversation: { id: '' } as unknown as Conversation,
    contact: {
      id: contact.id,
      external_id: contact.external_id,
    } as unknown as Contact,
    text,
  };

  let via: CommentDmResult['via'] = 'private_reply';
  let firstError: unknown = null;
  let dmExternalId: string | null = null;
  if (commentExternalId) {
    try {
      const res = await adapter.sendText({
        ...base,
        commentId: commentExternalId,
      } satisfies OutboundText);
      dmExternalId = res.externalMessageId ?? null;
      // Ya se usó la única respuesta privada de este comentario: que la IA no
      // intente gastarla después.
      await claimCommentPrivateReply(
        db,
        conversation.workspace_id,
        commentExternalId,
        'human',
      );
    } catch (err) {
      firstError = err;
    }
  }
  if (firstError || !commentExternalId) {
    if (!contact.external_id) {
      throw firstError instanceof Error
        ? firstError
        : new CommentDmError('no_recipient');
    }
    // Segundo intento: DM normal. `humanAgent` deja que el adapter reintente
    // con la etiqueta de agente humano si la ventana de 24 h está cerrada.
    const res = await adapter.sendText({
      ...base,
      humanAgent: true,
    } satisfies OutboundText);
    dmExternalId = res.externalMessageId ?? null;
    via = 'dm';
  }

  const conversationId = await recordProactiveDm(db, {
    workspaceId: conversation.workspace_id,
    contactId: contact.id,
    externalId: contact.external_id,
    dmChannel,
    commentChannel,
    connection,
    text,
    dmMessageId: dmExternalId,
    // Refleja el mensaje también bajo el comentario: ahí es donde el equipo
    // está mirando cuando decide escribir.
    commentContactId: contact.id,
    origin: null,
    originName: null,
  });

  return { conversationId, via };
}

async function loadConnection(
  db: SupabaseClient,
  id: string,
): Promise<ChannelConnection | null> {
  const { data } = await db
    .from('channel_connections')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return (data as ChannelConnection | null) ?? null;
}

/**
 * La conexión de DM de la MISMA cuenta que recibió el comentario. La fila
 * `ig_comment` comparte el token con su hermana `instagram`, así que sirve de
 * último recurso si la hermana no existe.
 */
async function dmConnectionFor(
  db: SupabaseClient,
  workspaceId: string,
  source: ChannelConnection | null,
  channel: 'instagram' | 'messenger',
): Promise<ChannelConnection | null> {
  if (source?.channel === channel) return source;
  const pick = async (accountId: string | null) => {
    let query = db
      .from('channel_connections')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('channel', channel)
      .neq('status', 'disconnected')
      .order('updated_at', { ascending: false })
      .limit(1);
    if (accountId) query = query.eq('external_account_id', accountId);
    const { data } = await query.maybeSingle();
    return (data as ChannelConnection | null) ?? null;
  };
  // Primero la hermana de la MISMA cuenta; si no la hay, cualquiera del canal;
  // y como último recurso la propia fila de comentarios, que comparte token.
  return (
    (source?.external_account_id ? await pick(source.external_account_id) : null) ??
    (await pick(null)) ??
    source ??
    null
  );
}
