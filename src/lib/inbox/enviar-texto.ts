/**
 * Mandar un texto por el canal de UNA conversación, con la contabilidad que va
 * con eso: la fila del mensaje y el tick del preview.
 *
 * Existe porque el Operador puede aprobar la respuesta que la IA dejó lista, y
 * esa respuesta puede ser de cualquier canal —un DM de Instagram, un correo, un
 * comentario—. `mensajes.enviar` sólo sabía de WhatsApp: pasa por
 * `engineSendText`, que es el camino de las automatizaciones.
 *
 * NO reemplaza a `/api/messages/send`. Esa ruta hace además plantillas,
 * adjuntos, citas y el aviso de TikTok, y la escribe una persona con su sesión.
 * Acá está sólo el texto plano, que es lo único que un borrador aprobado puede
 * ser.
 */
import { getAdapter } from '@/lib/channels/registry'
import { prepararTextoParaCanal } from '@/lib/marketing/enlaces-salientes'
import {
  esCanalDeComentarios,
  esError,
  resolveCommentReplyTarget,
} from '@/lib/channels/comment-reply-target'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChannelConnection, Contact, Conversation, Message } from '@/types'

export interface EnvioDeTexto {
  workspaceId: string
  conversationId: string
  texto: string
  /** Quién lo aprobó, si fue una persona. Va a `messages.sender_id`. */
  actorUserId?: string | null
  /** Qué lo mandó, para la etiqueta de la burbuja (`origin` / `origin_name`). */
  origen?: string | null
  origenNombre?: string | null
}

export interface ResultadoDeEnvio {
  message_id: string | null
  externo: string | null
  estado: string
  canal: string
  contacto: string | null
}

export async function enviarTextoEnConversacion(
  db: SupabaseClient,
  input: EnvioDeTexto,
): Promise<ResultadoDeEnvio> {
  const textoCrudo = input.texto.trim()
  if (!textoCrudo) throw new Error('No hay texto que mandar.')

  const { data: convRow } = await db
    .from('conversations')
    .select('*')
    .eq('id', input.conversationId)
    .eq('workspace_id', input.workspaceId)
    .maybeSingle()
  if (!convRow) throw new Error('Esa conversación no existe en esta cuenta.')
  const conversation = convRow as Conversation

  const { data: contactRow } = await db
    .from('contacts')
    .select('*')
    .eq('id', conversation.contact_id)
    .maybeSingle()
  if (!contactRow) throw new Error('Esa conversación no tiene contacto.')
  const contact = contactRow as Contact
  const texto = await prepararTextoParaCanal(db, {
    texto: textoCrudo,
    canal: conversation.channel,
    workspaceId: input.workspaceId,
    contactId: contact.id,
    connectionId: conversation.connection_id,
    conversationId: conversation.id,
  })

  // Un comentario no se contesta como un DM: hay que apuntarle al COMENTARIO
  // (no al post) y con la conexión DUEÑA de ese comentario (no la de la
  // conversación, que puede ser de otra cuenta del mismo comercio). Este
  // camino no hacía ninguna de las dos cosas, así que un borrador aprobado
  // sobre un comentario publicaba en el post equivocado, o fallaba con 400.
  let connection: ChannelConnection
  let replyToExternalId: string | undefined
  if (esCanalDeComentarios(conversation.channel)) {
    const destino = await resolveCommentReplyTarget(db, {
      workspaceId: input.workspaceId,
      conversation,
    })
    if (esError(destino)) {
      throw new Error(
        destino.error === 'sin_conexion'
          ? 'El canal de ese comentario no está conectado.'
          : 'No encontré el comentario al que responder.',
      )
    }
    connection = destino.connection
    replyToExternalId = destino.externalId
  } else {
    const { data: connRow } = await db
      .from('channel_connections')
      .select('*')
      .eq('id', conversation.connection_id ?? '')
      .maybeSingle()
    if (!connRow) throw new Error('El canal de esa conversación no está conectado.')
    connection = connRow as ChannelConnection
  }

  const adapter = getAdapter(conversation.channel)
  let result: { externalMessageId?: string; status?: string }
  try {
    result = await adapter.sendText({
      channel: conversation.channel,
      connection,
      conversation,
      contact,
      text: texto,
      replyToExternalId,
      // Lo aprobó una persona: en Messenger e Instagram eso habilita el
      // reintento con la etiqueta HUMAN_AGENT cuando la ventana de 24 h ya
      // cerró. Sin esto, aprobar una respuesta al día siguiente fallaba.
      humanAgent: true,
    })
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err)
    // El fallo también se guarda: un envío que no salió y no dejó fila es un
    // mensaje que nadie sabe que faltó.
    await db.from('messages').insert({
      conversation_id: conversation.id,
      channel: conversation.channel,
      sender_type: 'agent',
      sender_id: input.actorUserId ?? null,
      content_type: 'text',
      content_text: texto,
      status: 'failed',
      error_reason: detalle.slice(0, 500),
      origin: input.origen ?? null,
      origin_name: input.origenNombre ?? null,
    })
    throw new Error(detalle)
  }

  const { data: message } = await db
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      channel: conversation.channel,
      sender_type: 'agent',
      sender_id: input.actorUserId ?? null,
      content_type: 'text',
      content_text: texto,
      message_id: result.externalMessageId ?? null,
      status: result.status ?? 'sent',
      origin: input.origen ?? null,
      origin_name: input.origenNombre ?? null,
    })
    .select()
    .single()

  // El reloj del preview: `last_message_at` tiene que ser el `created_at` REAL
  // de la fila recién insertada. Un `new Date()` posterior queda unos ms por
  // delante y el trigger de la migración 103 descarta los cambios de estado que
  // vengan después — el chat se queda con una sola raya.
  const enviadoA =
    ((message as Message | null)?.created_at as string | undefined) ??
    new Date().toISOString()
  await db
    .from('conversations')
    .update({
      last_message_text: texto.slice(0, 200),
      last_message_at: enviadoA,
      last_sender_type: 'agent',
      updated_at: enviadoA,
    })
    .eq('id', conversation.id)

  return {
    message_id: (message as Message | null)?.id ?? null,
    externo: result.externalMessageId ?? null,
    estado: result.status ?? 'sent',
    canal: conversation.channel,
    contacto: contact.name ?? contact.phone ?? null,
  }
}
