import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChannelConnection, Contact, Conversation, Message } from '@/types'
import { runAiAgent } from '@/lib/ai/runner'
import { esCanalDeComentarios } from '@/lib/channels/comment-reply-target'

/**
 * Al pasar un chat de "Respondes tú" a "Responde la IA", si el último mensaje
 * es del cliente, la IA lo contesta ahora.
 *
 * Sin esto, prender la IA en un chat que quedó esperando no hacía nada: el
 * cliente había escrito, nadie contestó, y la IA recién iba a hablar cuando
 * la persona volviera a escribir —si volvía—. Quien prende la IA quiere que
 * la conversación siga, no que espere otro mensaje.
 *
 * Corre el MISMO turno que un mensaje entrante (`runAiAgent`), con todas sus
 * puertas —horario, saldo, escalamiento, herramientas—, sobre el último
 * mensaje del cliente. Si el último mensaje lo mandó el comercio o el bot, no
 * hay nada que contestar y no se hace nada. Nunca lanza: es un extra del
 * interruptor, no puede hacer fallar el PATCH.
 */
export async function retomarConLaIa(
  db: SupabaseClient,
  args: { workspaceId: string; conversationId: string },
): Promise<'contestando' | 'nada_pendiente' | 'sin_canal'> {
  const { data: convRow } = await db
    .from('conversations')
    .select('*')
    .eq('id', args.conversationId)
    .eq('workspace_id', args.workspaceId)
    .maybeSingle()
  const conversation = convRow as Conversation | null
  if (!conversation) return 'nada_pendiente'
  // Los comentarios públicos los atiende el piso de comentarios, no este runner.
  if (esCanalDeComentarios(conversation.channel)) return 'sin_canal'

  const { data: lastRow } = await db
    .from('messages')
    .select('*')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const last = lastRow as Message | null
  if (!last || last.sender_type !== 'customer') return 'nada_pendiente'

  const [{ data: contactRow }, { data: connRow }] = await Promise.all([
    db.from('contacts').select('*').eq('id', conversation.contact_id).maybeSingle(),
    conversation.connection_id
      ? db.from('channel_connections').select('*').eq('id', conversation.connection_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const contact = contactRow as Contact | null
  const connection = connRow as ChannelConnection | null
  if (!contact || !connection) return 'sin_canal'

  void runAiAgent(db, {
    workspaceId: args.workspaceId,
    channel: conversation.channel,
    conversation,
    contact,
    connection,
    inboundMessage: last,
  }).catch((err) => console.error('[ai] retomar falló:', err))
  return 'contestando'
}
