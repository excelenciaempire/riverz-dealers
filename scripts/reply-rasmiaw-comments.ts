import 'dotenv/config'

import { supabaseAdmin } from '@/lib/channels/admin-client'
import { getAdapter } from '@/lib/channels/registry'
import { recordPublicCommentReply } from '@/lib/instagram-agent/record-dm'
import { logProactiveSend } from '@/lib/instagram-agent/controls'
import { replyToComment } from '@/lib/instagram-agent/realtime'
import type { ChannelConnection, Contact, Conversation } from '@/types'
import type { OutboundText } from '@/lib/channels/types'

const WORKSPACE_ID = 'b814e934-d832-4be9-bad4-79cca51c1e23'
const SINCE = new Date(Date.now() - 30 * 86_400_000).toISOString()

type ConversationRow = {
  id: string
  contact_id: string | null
  channel: 'ig_comment' | 'fb_comment'
  connection_id: string | null
}

type InboundRow = {
  id: string
  conversation_id: string
  message_id: string | null
  content_text: string | null
  created_at: string
}

function respuestaPublicaSegura(texto: string | null): string {
  const t = (texto ?? '').toLowerCase()
  if (/(pedido|gu[ií]a|rastreo|seguimiento|no.*lleg|env[ií]o|entregad|reembolso|devoluci[oó]n)/.test(t)) {
    return 'Hola 💛 Escríbenos por mensaje privado con tu número de pedido para revisarlo contigo.'
  }
  if (/(precio|cu[aá]nto|valor|compr|quiero|info|cat[aá]logo|color|medida|stock|disponible)/.test(t)) {
    return '¡Hola! 💛 Escríbenos por mensaje privado y te ayudamos a elegir el Rasmiaw ideal para tu michi.'
  }
  if (/(malo|mala|reclamo|queja|estafa|roto|error|problema)/.test(t)) {
    return 'Lamentamos lo ocurrido. Escríbenos por mensaje privado para revisarlo y ayudarte.'
  }
  return '¡Hola! Gracias por escribirnos 💛 Estamos aquí para ayudarte por mensaje privado.'
}

async function main() {
  const db = supabaseAdmin()
  const { data: conversationData, error: conversationError } = await db
    .from('conversations')
    .select('id, contact_id, channel, connection_id')
    .eq('workspace_id', WORKSPACE_ID)
    .in('channel', ['ig_comment', 'fb_comment'])

  if (conversationError) throw conversationError
  const conversations = (conversationData ?? []) as ConversationRow[]
  const ids = conversations.map((row) => row.id)
  if (ids.length === 0) {
    console.log(JSON.stringify({ ok: true, candidates: 0, sent: 0, skipped: {} }))
    return
  }

  const [{ data: inboundData, error: inboundError }, { data: outboundData, error: outboundError }] =
    await Promise.all([
      db
        .from('messages')
        .select('id, conversation_id, message_id, content_text, created_at')
        .in('conversation_id', ids)
        .eq('sender_type', 'customer')
        .gte('created_at', SINCE)
        .order('created_at', { ascending: true }),
      db
        .from('messages')
        .select('conversation_id')
        .in('conversation_id', ids)
        .in('sender_type', ['agent', 'bot']),
    ])

  if (inboundError) throw inboundError
  if (outboundError) throw outboundError
  const alreadyAnswered = new Set((outboundData ?? []).map((row) => String(row.conversation_id)))
  const inbound = ((inboundData ?? []) as InboundRow[]).filter(
    (row) => !alreadyAnswered.has(row.conversation_id),
  )

  const messageIds = inbound.map((row) => row.id)
  const contactIds = [...new Set(conversations.map((row) => row.contact_id).filter(Boolean))] as string[]
  const [{ data: metaData, error: metaError }, { data: contactData, error: contactError }] = await Promise.all([
    db.from('comments_meta').select('message_id, post_id, connection_id').in('message_id', messageIds),
    db.from('contacts').select('id, name, external_id').in('id', contactIds),
  ])
  if (metaError) throw metaError
  if (contactError) throw contactError

  const byConversation = new Map(conversations.map((row) => [row.id, row]))
  const byMeta = new Map((metaData ?? []).map((row) => [String(row.message_id), row]))
  const byContact = new Map((contactData ?? []).map((row) => [String(row.id), row]))
  const connectionIds = [
    ...new Set(
      inbound
        .map((row) => byMeta.get(row.id)?.connection_id ?? byConversation.get(row.conversation_id)?.connection_id)
        .filter(Boolean),
    ),
  ] as string[]
  const { data: connectionData, error: connectionError } = connectionIds.length
    ? await db.from('channel_connections').select('*').in('id', connectionIds)
    : { data: [], error: null }
  if (connectionError) throw connectionError
  const byConnection = new Map(
    ((connectionData ?? []) as ChannelConnection[]).map((row) => [row.id, row]),
  )

  let sent = 0
  const skipped: Record<string, number> = {}
  for (const row of inbound) {
    const conversation = byConversation.get(row.conversation_id)
    const meta = byMeta.get(row.id)
    const contact = conversation?.contact_id ? byContact.get(conversation.contact_id) : null
    const connection = byConnection.get(meta?.connection_id ?? conversation?.connection_id ?? '')
    if (!conversation || !contact || !connection || !row.message_id) {
      skipped.incomplete_context = (skipped.incomplete_context ?? 0) + 1
      continue
    }

    const result = await replyToComment(db, {
      workspaceId: WORKSPACE_ID,
      contact: { id: contact.id, name: contact.name, external_id: contact.external_id },
      commentId: row.message_id,
      sourcePostId: meta?.post_id ?? null,
      connection,
      engagementText: row.content_text,
      commentChannel: conversation.channel,
      publicOnly: true,
    })
    if (result === null) {
      sent += 1
      continue
    }
    // Nunca publicamos un precio que no esté validado en el catálogo. Para una
    // consulta histórica sí podemos orientar de forma neutra hacia el DM.
    const canUseSafeFallback = [
      'comment_sin_llave',
      'comment_precio_no_verificado',
      'comment_precio_no_autorizado',
      'comment_prometia_averiguar',
    ].includes(result)
    if (!canUseSafeFallback) {
      skipped[result] = (skipped[result] ?? 0) + 1
      continue
    }

    const text = respuestaPublicaSegura(row.content_text)
    try {
      const response = await getAdapter(conversation.channel).sendText({
        channel: conversation.channel,
        connection,
        conversation: { id: '', thread_external_id: row.message_id } as unknown as Conversation,
        contact: { id: contact.id } as unknown as Contact,
        text,
        replyToExternalId: row.message_id,
      } satisfies OutboundText)
      await recordPublicCommentReply(db, {
        workspaceId: WORKSPACE_ID,
        commentContactId: contact.id,
        commentChannel: conversation.channel,
        text,
        externalId: response.externalMessageId ?? null,
        origin: 'comment_ai',
      })
      await logProactiveSend(db, {
        workspaceId: WORKSPACE_ID,
        contactId: contact.id,
        kind: 'comment_public',
        text,
      })
      sent += 1
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 120) : 'public_reply_failed'
      skipped[reason] = (skipped[reason] ?? 0) + 1
    }
  }

  console.log(JSON.stringify({ ok: true, since: SINCE, candidates: inbound.length, sent, skipped }))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
