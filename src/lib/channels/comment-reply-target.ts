import type { SupabaseClient } from '@supabase/supabase-js'
import type { Channel, ChannelConnection, Conversation } from '@/types'

/**
 * A QUÉ comentario se responde, y con QUÉ cuenta.
 *
 * Las dos preguntas van juntas porque la respuesta es la misma: la conexión que
 * puede contestar un comentario es la conexión DUEÑA de ese comentario.
 *
 * Los dos errores que cierra, los dos vividos:
 *
 *   1. EL OBJETO. `conversation.thread_external_id` es el id del POST, no el
 *      del comentario, y en fb/ig los comentarios se agrupan por contacto — así
 *      que es el post del PRIMER comentario que esa persona dejó alguna vez.
 *      Los adaptadores caían ahí cuando nadie les pasaba `replyToExternalId`, y
 *      el borrador aprobado y el Operador nunca lo pasaban: Facebook publicaba
 *      un comentario nuevo suelto bajo el post equivocado, Instagram devolvía
 *      400. En TikTok sí es válido, porque ahí el hilo codifica
 *      "video:<id>|comment:<id>".
 *
 *   2. LA CUENTA. Migración 117: quien comenta en dos cuentas del mismo
 *      comercio colapsa en UNA conversación, que es de la primera. El token de
 *      esa página no puede contestar el comentario de la otra. `comments_meta`
 *      guarda la conexión real; `/moderate` y la edición ya la usaban, y los
 *      dos caminos de ENVÍO no.
 */

export type CommentChannel = 'fb_comment' | 'ig_comment' | 'tiktok_comment'

export function esCanalDeComentarios(channel: Channel): channel is CommentChannel {
  return (
    channel === 'fb_comment' || channel === 'ig_comment' || channel === 'tiktok_comment'
  )
}

export interface CommentReplyTarget {
  /** Id EXTERNO del comentario bajo el que se responde. */
  externalId: string
  /** La fila de `messages` de la que salió, por si hay que anotar algo. */
  messageId: string | null
  /** La conexión DUEÑA del comentario. */
  connection: ChannelConnection
}

export type MotivoSinDestino =
  | 'no_es_comentario'
  | 'sin_comentario_al_que_responder'
  | 'sin_conexion'

export type ResultadoDestino = CommentReplyTarget | { error: MotivoSinDestino }

export function esError(r: ResultadoDestino): r is { error: MotivoSinDestino } {
  return 'error' in r
}

/**
 * Resuelve destino + conexión para responder en un hilo de comentarios.
 *
 * Orden del destino:
 *   1. El mensaje que eligió quien responde (`pickedMessageId`, uuid de `messages`).
 *   2. El último comentario DEL CLIENTE en ese hilo.
 *   3. Sólo en TikTok, el comentario codificado en `thread_external_id`.
 *
 * Nunca cae al id del post: eso es exactamente el bug que este módulo cierra.
 */
export async function resolveCommentReplyTarget(
  db: SupabaseClient,
  input: {
    workspaceId: string
    conversation: Conversation
    /** El uuid de `messages` que eligió la persona, si eligió uno. */
    pickedMessageId?: string | null
  },
): Promise<ResultadoDestino> {
  const { conversation } = input
  if (!esCanalDeComentarios(conversation.channel)) return { error: 'no_es_comentario' }

  let externalId = ''
  let messageId: string | null = null

  if (input.pickedMessageId) {
    // Con alcance de workspace: el uuid lo manda un cliente que no controlamos.
    const { data } = await db
      .from('messages')
      .select('id, message_id, conversations!inner(workspace_id)')
      .eq('id', input.pickedMessageId)
      .eq('conversations.workspace_id', input.workspaceId)
      .maybeSingle()
    const row = data as { id?: string; message_id?: string | null } | null
    if (row?.message_id) {
      externalId = row.message_id
      messageId = row.id ?? null
    }
  }

  if (!externalId) {
    const { data } = await db
      .from('messages')
      .select('id, message_id')
      .eq('conversation_id', conversation.id)
      .eq('sender_type', 'customer')
      .not('message_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const row = data as { id?: string; message_id?: string | null } | null
    if (row?.message_id) {
      externalId = row.message_id
      messageId = row.id ?? null
    }
  }

  if (!externalId && conversation.channel === 'tiktok_comment') {
    // Sólo acá el hilo trae el comentario: "video:<id>|comment:<id>".
    const hilo = String(conversation.thread_external_id ?? '')
    externalId = hilo.split('|comment:')[1] ?? ''
  }

  if (!externalId) return { error: 'sin_comentario_al_que_responder' }

  const connection = await resolveCommentConnection(db, {
    workspaceId: input.workspaceId,
    channel: conversation.channel,
    messageId,
    conversationConnectionId: conversation.connection_id ?? null,
  })
  if (!connection) return { error: 'sin_conexion' }

  return { externalId, messageId, connection }
}

/**
 * La conexión con la que se puede tocar ESE comentario.
 *
 * `comments_meta` primero (migración 117), después la de la conversación, y de
 * último recurso la única conexión viva del workspace para ese canal — que
 * cubre las filas escritas antes de que `comments_meta` existiera. Si hay más
 * de una, no se adivina: adivinar mal es publicar con la cuenta equivocada.
 */
export async function resolveCommentConnection(
  db: SupabaseClient,
  input: {
    workspaceId: string
    channel: CommentChannel
    /** uuid de `messages` del comentario, si se conoce. */
    messageId?: string | null
    conversationConnectionId?: string | null
  },
): Promise<ChannelConnection | null> {
  let connectionId = ''

  if (input.messageId) {
    const { data } = await db
      .from('comments_meta')
      .select('connection_id')
      .eq('message_id', input.messageId)
      .maybeSingle()
    connectionId = String(
      (data as { connection_id?: string | null } | null)?.connection_id ?? '',
    )
  }
  if (!connectionId) connectionId = String(input.conversationConnectionId ?? '')

  if (connectionId) {
    const { data } = await db
      .from('channel_connections')
      .select('*')
      .eq('id', connectionId)
      .eq('workspace_id', input.workspaceId)
      .maybeSingle()
    if (data) return data as ChannelConnection
  }

  const { data: sueltas } = await db
    .from('channel_connections')
    .select('*')
    .eq('workspace_id', input.workspaceId)
    .eq('channel', input.channel)
    .in('status', ['connected', 'error', 'expired'])
    .limit(2)
  const lista = (sueltas ?? []) as ChannelConnection[]
  return lista.length === 1 ? lista[0] : null
}
