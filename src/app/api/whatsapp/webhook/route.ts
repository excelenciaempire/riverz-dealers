import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { normalizePhone, phonesMatch } from '@/lib/whatsapp/phone-utils'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import {
  isOptOutKeyword,
  isOptInKeyword,
  markOptedOut,
  markOptedIn,
} from '@/lib/whatsapp/opt-out'
import { sendTextMessage } from '@/lib/whatsapp/meta-api'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'

// Lazy-initialized to avoid build-time crash when env vars are missing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

interface WhatsAppMessage {
  id: string
  from: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: { id: string; mime_type: string; caption?: string }
  video?: { id: string; mime_type: string; caption?: string }
  document?: { id: string; mime_type: string; filename?: string; caption?: string }
  audio?: { id: string; mime_type: string }
  sticker?: { id: string; mime_type: string }
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  reaction?: { message_id: string; emoji: string }
  /**
   * Set when the customer taps a button or list row on an interactive
   * message we sent. `button_reply.id` / `list_reply.id` is whatever id
   * we put on the button/row when sending — the Flows engine uses this
   * to advance the per-contact run.
   */
  interactive?: {
    type: 'button_reply' | 'list_reply'
    button_reply?: { id: string; title: string }
    list_reply?: { id: string; title: string; description?: string }
  }
  /** Present when the customer swipe-replies to one of our messages. */
  context?: { id: string }
}

interface WhatsAppWebhookEntry {
  id: string
  changes: Array<{
    value: {
      messaging_product: string
      metadata: {
        display_phone_number: string
        phone_number_id: string
      }
      contacts?: Array<{
        profile: { name: string }
        wa_id: string
      }>
      messages?: WhatsAppMessage[]
      statuses?: Array<{
        id: string
        status: string
        timestamp: string
        recipient_id: string
      }>
      // ---- Coexistence-only fields (merchant kept the WhatsApp Business app) ----
      /** Echoes of messages the merchant sends from their phone's WhatsApp
       *  Business app after onboarding. `to` = the customer. */
      message_echoes?: Array<CoexistenceMessage>
      /** Past chats synced from the app in the minutes after onboarding. */
      history?: Array<{
        metadata?: { phase?: string | number; chunk_order?: number; progress?: string | number }
        threads?: Array<{ id: string; messages?: CoexistenceMessage[] }>
      }>
      /** The merchant's contacts synced from the app. */
      state_sync?: Array<{
        type?: string
        action?: string
        contact?: { full_name?: string; first_name?: string; phone_number?: string }
        metadata?: { timestamp?: string }
      }>
    }
    field: string
  }>
}

/** A message inside an echo or history payload — same shape as an inbound
 *  message plus `to` (recipient) and, for history, a status marker. */
type CoexistenceMessage = WhatsAppMessage & {
  to?: string
  history_context?: { status?: string }
}

// GET - Webhook verification
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('hub.mode')
    const challenge = searchParams.get('hub.challenge')
    const verifyToken = searchParams.get('hub.verify_token')

    if (mode !== 'subscribe' || !challenge || !verifyToken) {
      return NextResponse.json(
        { error: 'Missing verification parameters' },
        { status: 400 }
      )
    }

    // Fetch all whatsapp configs to check verify tokens
    const { data: configs, error: configError } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('id, verify_token')

    if (configError || !configs) {
      console.error('Error fetching configs for verification:', configError)
      return NextResponse.json(
        { error: 'Verification failed' },
        { status: 403 }
      )
    }

    // Check if any config's verify_token matches. Also collect the
    // matching row so we can opportunistically upgrade its token to
    // GCM if it was still in the legacy CBC format.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let matchedConfig: any = null
    for (const config of configs) {
      if (!config.verify_token) continue
      try {
        if (decrypt(config.verify_token) === verifyToken) {
          matchedConfig = config
          break
        }
      } catch {
        // Malformed / wrong-key token row — skip it and keep checking.
      }
    }

    if (matchedConfig) {
      // Fire-and-forget GCM upgrade. Safe to run on every subscribe
      // since it's a no-op once the column is already GCM.
      if (isLegacyFormat(matchedConfig.verify_token)) {
        void supabaseAdmin()
          .from('whatsapp_config')
          .update({ verify_token: encrypt(verifyToken) })
          .eq('id', matchedConfig.id)
          .then(({ error }: { error: unknown }) => {
            if (error) {
              console.warn(
                '[webhook] verify_token GCM upgrade failed:',
                (error as { message?: string })?.message ?? error,
              )
            }
          })
      }
      // Return challenge as plain text
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    return NextResponse.json(
      { error: 'Verification token mismatch' },
      { status: 403 }
    )
  } catch (error) {
    console.error('Error in webhook GET verification:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST - Receive messages
export async function POST(request: Request) {
  // Read raw body first so we can HMAC-verify the exact bytes Meta
  // signed. request.json() would re-encode and break the signature.
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')

  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    // Devolvemos 200 para que Meta no entre en loop de reintentos
    // contra un secreto mal configurado o un atacante. La señal de
    // alerta queda en el log warn — el operador la pesca por logs,
    // no por la cola de eventos de Meta.
    console.warn('[webhook] firma inválida, evento descartado')
    return NextResponse.json({ status: 'ignored' }, { status: 200 })
  }

  let body: { entry?: WhatsAppWebhookEntry[] }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Process asynchronously so we can ack Meta within their timeout.
  processWebhook(body).catch((error) => {
    console.error('Error processing webhook:', error)
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

async function processWebhook(body: { entry?: WhatsAppWebhookEntry[] }) {
  if (!body.entry) return

  for (const entry of body.entry) {
    for (const change of entry.changes) {
      const value = change.value

      // Handle status updates
      if (value.statuses) {
        for (const status of value.statuses) {
          await handleStatusUpdate(status)
        }
      }

      // ---- Coexistence webhooks (merchant kept the WhatsApp Business app) ----
      // These are separate change.field values; each is self-contained and must
      // NOT fall through to the inbound-message path (no AI/flows/automations —
      // echoes + history are the merchant's own messages, not fresh inbound).
      if (change.field === 'smb_message_echoes' && value.message_echoes) {
        await handleMessageEchoes(value.message_echoes, value.metadata.phone_number_id)
        continue
      }
      if (change.field === 'history' && value.history) {
        await handleHistorySync(value.history, value, value.metadata.phone_number_id)
        continue
      }
      if (change.field === 'smb_app_state_sync' && value.state_sync) {
        await handleContactSync(value.state_sync, value.metadata.phone_number_id)
        continue
      }

      // Handle incoming messages
      if (!value.messages || !value.contacts) continue

      const phoneNumberId = value.metadata.phone_number_id

      // Find user's config by phone_number_id
      const { data: config, error: configError } = await supabaseAdmin()
        .from('whatsapp_config')
        .select('*')
        .eq('phone_number_id', phoneNumberId)
        .single()

      if (configError || !config) {
        console.error('No config found for phone_number_id:', phoneNumberId)
        continue
      }

      const decryptedAccessToken = decrypt(config.access_token)

      for (let i = 0; i < value.messages.length; i++) {
        const message = value.messages[i]
        const contact = value.contacts[i] || value.contacts[0]

        await processMessage(
          message,
          contact,
          config.user_id,
          decryptedAccessToken,
          phoneNumberId
        )
      }
    }
  }
}

// The happy-path status ladder — pending → sent → delivered → read →
// replied. Webhook replays must never regress a recipient back down
// this ladder.
//
// `failed` is NOT on this ladder. It's a terminal side branch that is
// only valid from the early states (pending / sent) — once Meta has
// delivered or the user has read or replied, a later "failed" status
// event is a bug in Meta's pipeline or a spoof attempt and must be
// ignored.
const RECIPIENT_STATUS_LADDER = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
] as const

function ladderLevel(s: string): number {
  const idx = (RECIPIENT_STATUS_LADDER as readonly string[]).indexOf(s)
  return idx < 0 ? -1 : idx
}

/**
 * Can a recipient transition from `current` to `incoming`?
 *   - Along the ladder, only forward moves are allowed.
 *   - `failed` is accepted only from `pending` or `sent`; it's refused
 *     once the recipient has reached any of the success states.
 */
function isValidStatusTransition(current: string, incoming: string): boolean {
  if (incoming === 'failed') {
    return current === 'pending' || current === 'sent'
  }
  if (current === 'failed') {
    return false // failed is terminal
  }
  const ci = ladderLevel(current)
  const ii = ladderLevel(incoming)
  if (ii < 0) return false // unknown incoming status
  if (ci < 0) return true // unknown current — accept anything on the ladder
  return ii > ci
}

async function handleStatusUpdate(status: {
  id: string
  status: string
  timestamp: string
  recipient_id: string
}) {
  // 1) Mirror onto messages (legacy behavior) — Meta's status values
  //    already match the CHECK constraint on messages.status.
  //    `.neq(...)` skips no-op writes so replayed status events don't
  //    bump updated_at or emit a phantom realtime change for the inbox.
  const { error: msgErr } = await supabaseAdmin()
    .from('messages')
    .update({ status: status.status })
    .eq('message_id', status.id)
    .neq('status', status.status)

  if (msgErr) {
    console.error('Error updating message status:', msgErr)
  }

  // 2) Mirror onto broadcast_recipients via whatsapp_message_id
  //    (added in migration 003). The aggregate trigger on
  //    broadcast_recipients re-derives the parent broadcast's
  //    sent/delivered/read/failed counts automatically.
  const tsIso = new Date(parseInt(status.timestamp) * 1000).toISOString()

  const { data: recipient, error: recFetchErr } = await supabaseAdmin()
    .from('broadcast_recipients')
    .select('id, status')
    .eq('whatsapp_message_id', status.id)
    .maybeSingle()

  if (recFetchErr) {
    console.error('Error fetching broadcast recipient:', recFetchErr)
    return
  }
  if (!recipient) return // message wasn't part of a broadcast — fine

  // Guard transitions — forward-only on the success ladder, and
  // `failed` only from pre-delivered states.
  if (!isValidStatusTransition(recipient.status, status.status)) return

  const update: Record<string, unknown> = { status: status.status }
  if (status.status === 'sent' && !('sent_at' in update)) update.sent_at = tsIso
  if (status.status === 'delivered') update.delivered_at = tsIso
  if (status.status === 'read') update.read_at = tsIso

  const { error: recUpdateErr } = await supabaseAdmin()
    .from('broadcast_recipients')
    .update(update)
    .eq('id', recipient.id)

  if (recUpdateErr) {
    console.error('Error updating broadcast recipient status:', recUpdateErr)
  }
}

// The messages.content_type CHECK constraint allows this set (migration 010).
// Map any other WhatsApp type to the closest allowed value.
const ALLOWED_CONTENT_TYPES = new Set([
  'text', 'image', 'document', 'audio', 'video',
  'location', 'template', 'interactive',
])
function toContentType(type: string): string {
  return ALLOWED_CONTENT_TYPES.has(type)
    ? type
    : type === 'sticker'
      ? 'image'
      : 'text'
}

/** Resolve the legacy whatsapp_config row (user_id + token) by phone id. */
async function getWhatsAppConfig(phoneNumberId: string) {
  const { data: config } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('*')
    .eq('phone_number_id', phoneNumberId)
    .single()
  return config ?? null
}

/**
 * COEXISTENCE — smb_message_echoes.
 *
 * Messages the merchant sends from their own phone's WhatsApp Business app.
 * We mirror each as an OUTBOUND (sender_type='agent') message so the inbox
 * shows the reply AND the conversation reflects that a human already answered
 * — this is what stops the AI agent from double-replying to a customer the
 * merchant just handled from their phone. We deliberately do NOT run flows /
 * automations / AI here (those are for fresh inbound only). Idempotent on the
 * (conversation_id, message_id) unique index (migration 036).
 */
async function handleMessageEchoes(
  echoes: CoexistenceMessage[],
  phoneNumberId: string,
) {
  const config = await getWhatsAppConfig(phoneNumberId)
  if (!config) {
    console.error('[coexistence] no config for echoes:', phoneNumberId)
    return
  }
  const token = decrypt(config.access_token)
  for (const echo of echoes) {
    // 'revoke'/'edit' echoes carry no reply text to show — skip for now.
    if (!echo?.id || !echo.to || !echo.timestamp) continue
    if (echo.type === 'revoke' || echo.type === 'edit') continue
    const customerPhone = normalizePhone(echo.to)
    if (!customerPhone) continue

    const outcome = await findOrCreateContact(config.user_id, customerPhone, '')
    if (!outcome) continue
    const conversation = await findOrCreateConversation(config.user_id, outcome.contact.id)
    if (!conversation) continue

    const { contentText, mediaUrl } = await parseMessageContent(echo, token)
    const createdIso = new Date(parseInt(echo.timestamp) * 1000).toISOString()
    const { error } = await supabaseAdmin().from('messages').insert({
      conversation_id: conversation.id,
      sender_type: 'agent',
      content_type: toContentType(echo.type),
      content_text: contentText,
      media_url: mediaUrl,
      message_id: echo.id,
      status: 'sent',
      created_at: createdIso,
    })
    if (error && (error as { code?: string }).code !== '23505') {
      console.error('[coexistence] echo insert failed:', error)
      continue
    }
    await supabaseAdmin()
      .from('conversations')
      .update({
        last_message_text: contentText || `[${echo.type}]`,
        last_message_at: createdIso,
        last_sender_type: 'agent',
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id)
  }
}

/**
 * COEXISTENCE — history.
 *
 * Past chats synced from the merchant's app in the minutes after onboarding.
 * Each thread is one customer; each message's direction is derived from `from`
 * vs the business number. Inserted idempotently, no AI/flows. The conversation
 * summary is only advanced if a history message is newer than what the thread
 * already shows, so importing old history never reorders a live conversation.
 */
async function handleHistorySync(
  chunks: NonNullable<WhatsAppWebhookEntry['changes'][number]['value']['history']>,
  value: WhatsAppWebhookEntry['changes'][number]['value'],
  phoneNumberId: string,
) {
  const config = await getWhatsAppConfig(phoneNumberId)
  if (!config) {
    console.error('[coexistence] no config for history:', phoneNumberId)
    return
  }
  const token = decrypt(config.access_token)
  const businessPhone = normalizePhone(value.metadata?.display_phone_number ?? '')

  for (const chunk of chunks) {
    for (const thread of chunk.threads ?? []) {
      const customerPhone = normalizePhone(thread.id ?? '')
      if (!customerPhone) continue
      const outcome = await findOrCreateContact(config.user_id, customerPhone, '')
      if (!outcome) continue
      const conversation = await findOrCreateConversation(config.user_id, outcome.contact.id)
      if (!conversation) continue

      let newest: { ts: number; text: string | null; type: string; sender: 'agent' | 'customer' } | null = null
      for (const msg of thread.messages ?? []) {
        if (!msg?.id || !msg.timestamp) continue
        if (msg.type === 'revoke' || msg.type === 'edit') continue
        const fromBusiness = businessPhone ? phonesMatch(msg.from ?? '', businessPhone) : false
        const sender: 'agent' | 'customer' = fromBusiness ? 'agent' : 'customer'
        const { contentText, mediaUrl } = await parseMessageContent(msg, token)
        const createdIso = new Date(parseInt(msg.timestamp) * 1000).toISOString()
        const { error } = await supabaseAdmin().from('messages').insert({
          conversation_id: conversation.id,
          sender_type: sender,
          content_type: toContentType(msg.type),
          content_text: contentText,
          media_url: mediaUrl,
          message_id: msg.id,
          status: fromBusiness ? 'sent' : 'delivered',
          created_at: createdIso,
        })
        if (error && (error as { code?: string }).code !== '23505') {
          console.error('[coexistence] history insert failed:', error)
          continue
        }
        const tsNum = parseInt(msg.timestamp)
        if (!newest || tsNum > newest.ts) {
          newest = { ts: tsNum, text: contentText, type: msg.type, sender }
        }
      }

      if (newest) {
        const existingTs = conversation.last_message_at
          ? Date.parse(conversation.last_message_at)
          : 0
        if (newest.ts * 1000 > existingTs) {
          await supabaseAdmin()
            .from('conversations')
            .update({
              last_message_text: newest.text || `[${newest.type}]`,
              last_message_at: new Date(newest.ts * 1000).toISOString(),
              last_sender_type: newest.sender,
              updated_at: new Date().toISOString(),
            })
            .eq('id', conversation.id)
        }
      }
    }
  }
}

/**
 * COEXISTENCE — smb_app_state_sync.
 *
 * The merchant's contacts synced from the app. We upsert them (create if new,
 * refresh the name) so the inbox shows real names. `remove` is ignored — we
 * never delete a contact that may already have conversation history.
 */
async function handleContactSync(
  stateSync: NonNullable<WhatsAppWebhookEntry['changes'][number]['value']['state_sync']>,
  phoneNumberId: string,
) {
  const config = await getWhatsAppConfig(phoneNumberId)
  if (!config) {
    console.error('[coexistence] no config for contact sync:', phoneNumberId)
    return
  }
  for (const item of stateSync) {
    if (item?.type !== 'contact' || !item.contact) continue
    if (item.action === 'remove') continue
    const phone = normalizePhone(item.contact.phone_number ?? '')
    if (!phone) continue
    const name = item.contact.full_name || item.contact.first_name || ''
    await findOrCreateContact(config.user_id, phone, name)
  }
}

/**
 * If an inbound message's sender is on a still-unreplied
 * broadcast_recipients row, flip it to `replied` so the reply count
 * advances on the parent broadcast.
 *
 * Runs on a best-effort basis — failures here must not break the
 * main inbound-message flow, so errors are swallowed with a log.
 */
async function flagBroadcastReplyIfAny(userId: string, contactId: string) {
  try {
    // Most recent outbound broadcast that hasn't been replied to yet.
    const { data: recs, error } = await supabaseAdmin()
      .from('broadcast_recipients')
      .select('id, status, broadcast_id, broadcasts!inner(user_id)')
      .eq('contact_id', contactId)
      .eq('broadcasts.user_id', userId)
      .in('status', ['sent', 'delivered', 'read'])
      .order('created_at', { ascending: false })
      .limit(1)

    if (error || !recs || recs.length === 0) return

    const row = recs[0]
    const { error: updErr } = await supabaseAdmin()
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', row.id)

    if (updErr) {
      console.error('Error marking broadcast recipient replied:', updErr)
    }
  } catch (err) {
    console.error('flagBroadcastReplyIfAny failed:', err)
  }
}

/**
 * Resolve a Meta-side message_id into the matching internal UUID, scoped
 * to one conversation. Returns null when we never received the parent
 * (e.g. a swipe-reply to a message older than this CRM install).
 */
async function lookupInternalIdByMetaId(
  metaId: string,
  conversationId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('message_id', metaId)
    .eq('conversation_id', conversationId)
    .maybeSingle()
  if (error) {
    console.error('[webhook] lookupInternalIdByMetaId failed:', error.message)
    return null
  }
  return data?.id ?? null
}

/**
 * Persist an inbound reaction. WhatsApp reactions are not new messages —
 * they're per-(target, actor) state. We upsert / delete on
 * `message_reactions`, never write a row into `messages`.
 *
 * Best-effort: a missing parent (we never received it) is logged and
 * skipped so the webhook still acks 200 to Meta.
 */
async function handleReaction(
  message: WhatsAppMessage,
  conversationId: string,
  contactId: string
) {
  const reaction = message.reaction
  if (!reaction?.message_id) return

  const targetInternalId = await lookupInternalIdByMetaId(
    reaction.message_id,
    conversationId
  )
  if (!targetInternalId) {
    console.warn(
      '[webhook] reaction target message not found; skipping',
      reaction.message_id
    )
    return
  }

  // Empty emoji = removal (per Meta's Cloud API spec).
  if (!reaction.emoji) {
    const { error: delError } = await supabaseAdmin()
      .from('message_reactions')
      .delete()
      .eq('message_id', targetInternalId)
      .eq('actor_type', 'customer')
      .eq('actor_id', contactId)
    if (delError) {
      console.error('[webhook] reaction delete failed:', delError.message)
    }
    return
  }

  const { error: upsertError } = await supabaseAdmin()
    .from('message_reactions')
    .upsert(
      {
        message_id: targetInternalId,
        conversation_id: conversationId,
        actor_type: 'customer',
        actor_id: contactId,
        emoji: reaction.emoji,
      },
      { onConflict: 'message_id,actor_type,actor_id' }
    )
  if (upsertError) {
    console.error('[webhook] reaction upsert failed:', upsertError.message)
  }
}

async function processMessage(
  message: WhatsAppMessage,
  contact: { profile: { name: string }; wa_id: string },
  userId: string,
  accessToken: string,
  phoneNumberId: string
) {
  const senderPhone = normalizePhone(message.from)
  const contactName = contact.profile.name

  // Find or create contact
  const contactOutcome = await findOrCreateContact(
    userId,
    senderPhone,
    contactName
  )
  if (!contactOutcome) return
  const contactRecord = contactOutcome.contact

  // Find or create conversation
  const conversation = await findOrCreateConversation(
    userId,
    contactRecord.id
  )
  if (!conversation) return

  // Reactions short-circuit here — they aren't messages. We never insert
  // into `messages`, never bump unread_count, never update last_message_text.
  // Done before parseMessageContent so the media-URL fetch is skipped.
  if (message.type === 'reaction') {
    await handleReaction(message, conversation.id, contactRecord.id)
    return
  }

  // Parse message content based on type
  const { contentText, mediaUrl, mediaType, interactiveReplyId } =
    await parseMessageContent(message, accessToken)

  // Resolve swipe-reply context if present. A missing parent is fine —
  // we just store NULL and the UI renders the message without a quote.
  let replyToInternalId: string | null = null
  if (message.context?.id) {
    replyToInternalId = await lookupInternalIdByMetaId(
      message.context.id,
      conversation.id
    )
    if (!replyToInternalId) {
      console.warn(
        '[webhook] reply context parent not found:',
        message.context.id
      )
    }
  }

  // Insert message — field names MUST match the messages table schema
  // (see supabase/migrations/001_initial_schema.sql):
  //   conversation_id, sender_type, content_type, content_text,
  //   media_url, template_name, message_id, status, created_at
  // `mediaType` is intentionally unused — the schema has no media_type
  // column; the MIME type is only used to construct the proxy URL during
  // parseMessageContent. Silence the unused-var warning:
  void mediaType

  // Map incoming WhatsApp types to the messages.content_type CHECK set
  // (widened in migration 010 to add 'interactive'). See toContentType.
  const contentType = toContentType(message.type)

  // Determine whether this is the contact's very first inbound message
  // BEFORE we insert, so the count is accurate. Covers the case where
  // the contact row already exists (manual add / CSV import) but they've
  // never messaged us before — which new_contact_created wouldn't catch.
  const { count: priorCustomerMsgCount } = await supabaseAdmin()
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0

  const { error: msgError } = await supabaseAdmin().from('messages').insert({
    conversation_id: conversation.id,
    sender_type: 'customer',
    content_type: contentType,
    content_text: contentText,
    media_url: mediaUrl,
    message_id: message.id,
    status: 'delivered',
    created_at: new Date(parseInt(message.timestamp) * 1000).toISOString(),
    reply_to_message_id: replyToInternalId,
    // Only populated for content_type='interactive'. Migration 010 added
    // the column; null for every other content_type so existing inserts
    // behave identically.
    interactive_reply_id: interactiveReplyId,
  })

  if (msgError) {
    // Idempotencia: Meta a veces reentrega el mismo evento. Con el índice
    // único parcial de migration 036 sobre (conversation_id, message_id),
    // el segundo INSERT cae acá con 23505. Salimos sin re-procesar para
    // no duplicar conv.update, flows, ni automations.
    if ((msgError as { code?: string }).code === '23505') {
      console.debug('[webhook] mensaje duplicado ignorado:', message.id)
      return
    }
    console.error('Error inserting message:', msgError)
    return
  }

  // Update conversation
  const { error: convError } = await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: contentText || `[${message.type}]`,
      last_message_at: new Date().toISOString(),
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)

  if (convError) {
    console.error('Error updating conversation:', convError)
  }

  // Marca contacts.last_inbound_at — distinto de
  // conversations.last_message_at (que incluye salientes). Lo usa el
  // cron de re-engagement para detectar contactos en silencio.
  const { error: contactUpdateErr } = await supabaseAdmin()
    .from('contacts')
    .update({ last_inbound_at: new Date().toISOString() })
    .eq('id', contactRecord.id)
  if (contactUpdateErr) {
    console.error('Error updating contact last_inbound_at:', contactUpdateErr)
  }

  // If this contact was a recent broadcast recipient, flag the reply
  // so the broadcast's `replied_count` advances (via the aggregate
  // trigger installed in migration 003).
  await flagBroadcastReplyIfAny(userId, contactRecord.id)

  // ============================================================
  // STOP / SUSCRIBIR — opt-out / opt-in por palabra clave.
  //
  // El mensaje ya quedó persistido (cumplimiento WhatsApp: hay que
  // poder mostrar la prueba del STOP), pero cortamos antes de los
  // flows y la IA: ningún bot debe contestar a un cliente que pidió
  // darse de baja salvo el acuse oficial.
  // ============================================================
  const inboundTextRaw = contentText ?? message.text?.body ?? ''
  const contactWorkspaceId = (contactRecord as { workspace_id?: string | null })
    .workspace_id ?? null
  if (inboundTextRaw && contactWorkspaceId) {
    if (isOptOutKeyword(inboundTextRaw)) {
      await markOptedOut(
        supabaseAdmin(),
        contactWorkspaceId,
        contactRecord.id,
        'inbound_keyword',
      )
      try {
        await sendTextMessage({
          phoneNumberId,
          accessToken,
          to: senderPhone,
          text:
            'Has sido dado de baja. Para volver a recibir mensajes, ' +
            'escribe SUSCRIBIR.',
        })
      } catch (err) {
        console.error('[webhook] acuse opt-out falló:', err)
      }
      return
    }
    if (isOptInKeyword(inboundTextRaw)) {
      await markOptedIn(supabaseAdmin(), contactWorkspaceId, contactRecord.id)
      try {
        await sendTextMessage({
          phoneNumberId,
          accessToken,
          to: senderPhone,
          text: 'Bienvenido nuevamente. Recibirás nuestros mensajes.',
        })
      } catch (err) {
        console.error('[webhook] acuse opt-in falló:', err)
      }
      return
    }
  }

  // ============================================================
  // Flow runner dispatch.
  //
  // If the runner consumes the message (it either advanced an active
  // run or started a new one), we suppress the `new_message_received`
  // + `keyword_match` automation triggers for this inbound. Customer
  // is navigating the bot menu, not sending a fresh trigger word
  // that should fork into automations.
  //
  // The relationship-level triggers (`new_contact_created`,
  // `first_inbound_message`) still fire even when consumed — those
  // are about WHO is messaging, not what they said.
  //
  // Awaited (not fire-and-forget) because we need the `consumed`
  // result before deciding whether to dispatch automations. The
  // runner has its own try/catch and never throws. Accounts with
  // no active flows take the runner's early-exit "no_match" path
  // basically for free (one indexed SELECT for the active run).
  // ============================================================
  const flowResult = await dispatchInboundToFlows({
    userId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    message:
      interactiveReplyId
        ? {
            kind: 'interactive_reply',
            reply_id: interactiveReplyId,
            reply_title: contentText ?? '',
            meta_message_id: message.id,
          }
        : {
            kind: 'text',
            text: contentText ?? message.text?.body ?? '',
            meta_message_id: message.id,
          },
    isFirstInboundMessage,
  })
  const flowConsumed = flowResult.consumed

  // Fire any automations that react to this webhook event. All dispatches
  // run here (not earlier) so the contact, conversation, and inbound
  // message all exist before any step — including send_message — runs.
  // Fire-and-forget: a slow or failing automation must not block the
  // webhook's 200 OK response to Meta.
  const inboundText = inboundTextRaw
  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
  )[] = []
  // Content-level triggers are suppressed when a flow consumed the
  // message — see the comment block above.
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match')
  }
  // new_contact_created fires only when the webhook just auto-created the
  // contact row. first_inbound_message fires whenever this is the contact's
  // first-ever customer-sent message — a superset that also catches
  // manually-imported contacts sending for the first time. We dispatch both
  // so users can pick whichever semantic they want; an automation that
  // listens to only one trigger runs only when that trigger matches.
  if (contactOutcome.wasCreated) automationTriggers.unshift('new_contact_created')
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')

  // Resolve the workspace UUID — automations live under workspaces.id,
  // never under auth.users.id. Prefer the conversation's workspace_id
  // (already on the row from migration 013); fall back to
  // workspace_members so legacy conversations without the column don't
  // silently no-op the dispatch.
  let workspaceId: string | null =
    (conversation as { workspace_id?: string | null }).workspace_id ?? null
  if (!workspaceId) {
    // Deterministic resolution: owner-first, then joined_at ASC across
    // workspace_members. A multi-workspace owner used to get a random
    // row here, which made the same inbound message route to a
    // different workspace's automations on different invocations.
    workspaceId = await resolveWorkspaceIdForUser(supabaseAdmin(), userId)
  }
  if (!workspaceId) {
    console.warn(
      '[automations] skipping dispatch: no workspace for user',
      userId,
    )
    return
  }

  for (const triggerType of automationTriggers) {
    runAutomationsForTrigger({
      workspaceId,
      triggerType,
      contactId: contactRecord.id,
      context: {
        message_text: inboundText,
        conversation_id: conversation.id,
      },
    }).catch((err) => console.error('[automations] dispatch failed:', err))
  }
}

async function parseMessageContent(
  message: WhatsAppMessage,
  accessToken: string
): Promise<{
  contentText: string | null
  mediaUrl: string | null
  mediaType: string | null
  /**
   * For interactive button / list replies: the stable id of the tapped
   * option (whatever we put on the button when sending). Used by the
   * Flows engine to advance the per-contact run; persisted to
   * `messages.interactive_reply_id` so the inbox bubble can render the
   * tap with the right affordance. Null for everything else.
   */
  interactiveReplyId: string | null
}> {
  // getMediaUrl signature is (mediaId, accessToken) — earlier code had
  // the args swapped, so every verification hit an invalid Meta URL and
  // fell through to the catch block, leaving mediaUrl as null. That's
  // why images showed up as empty bubbles in the inbox.
  const verifyAndBuildUrl = async (
    mediaId: string
  ): Promise<string | null> => {
    try {
      await getMediaUrl({ mediaId, accessToken })
      return `/api/whatsapp/media/${mediaId}`
    } catch (error) {
      console.error(
        `Failed to verify media ${mediaId} with Meta:`,
        error instanceof Error ? error.message : error
      )
      return null
    }
  }

  // Default shape — each case overrides only the fields it cares about.
  // Keeps the new `interactiveReplyId` field DRY across every return site.
  const empty = {
    contentText: null,
    mediaUrl: null,
    mediaType: null,
    interactiveReplyId: null,
  }

  switch (message.type) {
    case 'text':
      return { ...empty, contentText: message.text?.body || null }

    case 'image':
      if (message.image?.id) {
        return {
          ...empty,
          contentText: message.image.caption || null,
          mediaUrl: await verifyAndBuildUrl(message.image.id),
          mediaType: message.image.mime_type,
        }
      }
      return empty

    case 'video':
      if (message.video?.id) {
        return {
          ...empty,
          contentText: message.video.caption || null,
          mediaUrl: await verifyAndBuildUrl(message.video.id),
          mediaType: message.video.mime_type,
        }
      }
      return empty

    case 'document':
      if (message.document?.id) {
        return {
          ...empty,
          contentText:
            message.document.caption || message.document.filename || null,
          mediaUrl: await verifyAndBuildUrl(message.document.id),
          mediaType: message.document.mime_type,
        }
      }
      return empty

    case 'audio':
      if (message.audio?.id) {
        return {
          ...empty,
          mediaUrl: await verifyAndBuildUrl(message.audio.id),
          mediaType: message.audio.mime_type,
        }
      }
      return empty

    case 'sticker':
      // Stickers are images under the hood. Treat them as such so the
      // MessageBubble renders the <img>. The caller maps the DB
      // content_type to 'image' for the CHECK constraint.
      if (message.sticker?.id) {
        return {
          ...empty,
          mediaUrl: await verifyAndBuildUrl(message.sticker.id),
          mediaType: message.sticker.mime_type,
        }
      }
      return empty

    case 'location':
      if (message.location) {
        const loc = message.location
        const locationText = [loc.name, loc.address, `${loc.latitude},${loc.longitude}`]
          .filter(Boolean)
          .join(' - ')
        return { ...empty, contentText: locationText }
      }
      return empty

    case 'reaction':
      return { ...empty, contentText: message.reaction?.emoji || null }

    case 'interactive': {
      // The customer tapped a reply button or a list row on a message
      // we previously sent. Meta delivers `interactive.button_reply` for
      // 3-button messages and `interactive.list_reply` for list messages.
      // Use the human-readable title as contentText so the inbox bubble
      // renders the tap legibly ("Existing customer"), and stash the
      // stable id separately so the Flows engine can route on it.
      const reply =
        message.interactive?.button_reply ?? message.interactive?.list_reply
      if (reply?.id) {
        return {
          ...empty,
          contentText: reply.title || reply.id,
          interactiveReplyId: reply.id,
        }
      }
      return { ...empty, contentText: '[Interactive reply]' }
    }

    default:
      return {
        ...empty,
        contentText: `[Unsupported message type: ${message.type}]`,
      }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContactRow = any

interface ContactOutcome {
  contact: ContactRow
  /** True when this call created the row; drives new_contact_created
   *  automation dispatch in processMessage. */
  wasCreated: boolean
}

async function findOrCreateContact(
  userId: string,
  phone: string,
  name: string
): Promise<ContactOutcome | null> {
  // Look up existing contacts for this user
  const { data: contacts, error: contactsError } = await supabaseAdmin()
    .from('contacts')
    .select('*')
    .eq('user_id', userId)

  if (contactsError) {
    console.error('Error fetching contacts:', contactsError)
    return null
  }

  // Use phonesMatch for flexible matching
  const existingContact = contacts?.find((c: ContactRow) => phonesMatch(c.phone, phone))

  if (existingContact) {
    // Update name if it changed
    if (name && name !== existingContact.name) {
      await supabaseAdmin()
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existingContact.id)
    }
    return { contact: existingContact, wasCreated: false }
  }

  // Create new contact. workspace_id is NOT NULL since migration 065, so we
  // must resolve + set it (owner-first) — the legacy per-user insert without
  // it now fails the constraint and silently drops every inbound from a new
  // number.
  const workspaceId = await resolveWorkspaceIdForUser(supabaseAdmin(), userId)
  const { data: newContact, error: createError } = await supabaseAdmin()
    .from('contacts')
    .insert({
      user_id: userId,
      workspace_id: workspaceId,
      channel: 'whatsapp',
      // Key the contact by external_id = phone, the same convention the
      // unified-inbox / Shopify upsert uses (upsertWhatsappContact looks
      // up by external_id). Without it, a phone that first messages on
      // WhatsApp (external_id NULL) and later places a Shopify order
      // becomes TWO contacts — the Shopify upsert can't find the
      // webhook-created one and inserts a duplicate.
      external_id: phone,
      phone,
      name: name || phone,
    })
    .select()
    .single()

  if (createError) {
    console.error('Error creating contact:', createError)
    return null
  }

  return { contact: newContact, wasCreated: true }
}

async function findOrCreateConversation(userId: string, contactId: string) {
  // Look for an existing LIVE conversation. Soft-delete (migración 085): if the
  // contact's only thread was deleted from the bandeja, we must NOT reuse it —
  // the inbound message would land in an invisible row and disappear from the
  // inbox. Skipping deleted rows makes a brand-new message open a fresh visible
  // thread, exactly like inbox-writer.findOrCreateConversation. order+limit so a
  // stray duplicate never makes maybeSingle error.
  const { data: existing } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (existing) {
    return existing
  }

  // Create new conversation. Las reglas de asignación corren al
  // crearse — si alguna matchea (round_robin, by_channel, by_tag,
  // by_keyword) seteamos assigned_agent_id al toque. La conv arranca
  // ya en la columna de quien le toca atender.
  const admin = supabaseAdmin();
  // Resolver workspace_id del user_id determinísticamente (owner-first,
  // luego joined_at ASC). Antes se hacía un .limit(1) sin .order(...),
  // así que un user multi-workspace podía recibir las reglas de
  // asignación del workspace equivocado.
  const resolvedWorkspaceId = await resolveWorkspaceIdForUser(admin, userId);
  let assignedAgentId: string | null = null;
  if (resolvedWorkspaceId) {
    try {
      const { resolveAssignmentForConversation } = await import(
        '@/lib/inbox/assignment-rules'
      );
      assignedAgentId = await resolveAssignmentForConversation(admin, {
        workspaceId: resolvedWorkspaceId,
        conversationId: '',
        channel: 'whatsapp',
        contactId,
        firstMessageText: '',
      });
    } catch (err) {
      console.error('[whatsapp] assignment rules failed:', err);
    }
  }

  // Link the conversation to the workspace's WhatsApp connection so it shows
  // in the unified inbox (which groups/filters by connection_id). Without it
  // the row exists but never surfaces in the bandeja.
  let connectionId: string | null = null;
  if (resolvedWorkspaceId) {
    const { data: conn } = await admin
      .from('channel_connections')
      .select('id')
      .eq('workspace_id', resolvedWorkspaceId)
      .eq('channel', 'whatsapp')
      .neq('status', 'disconnected')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    connectionId = (conn as { id?: string } | null)?.id ?? null;
  }

  // Persistir workspace_id en la fila para que el fallback en la
  // dispatch de automations no tenga que volver a resolver en
  // invocaciones futuras (y para que no se rompa si el user pierde la
  // membresía a uno de los workspaces).
  const { data: newConv, error: createError } = await admin
    .from('conversations')
    .insert({
      user_id: userId,
      contact_id: contactId,
      assigned_agent_id: assignedAgentId,
      workspace_id: resolvedWorkspaceId,
      connection_id: connectionId,
      channel: 'whatsapp',
    })
    .select()
    .single()

  // Race-safe: si dos webhooks llegaron a la vez ambos pasaron el
  // SELECT inicial (no hay fila) y ambos intentan INSERT. Con el
  // índice único de migration 035, el segundo INSERT falla con
  // 23505 (unique_violation). En vez de tirar 500, re-SELECT a la
  // fila ya creada por el primer webhook y devolvemos esa.
  if (createError) {
    if ((createError as { code?: string }).code === '23505') {
      const { data: winner } = await admin
        .from('conversations')
        .select('*')
        .eq('user_id', userId)
        .eq('contact_id', contactId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (winner) return winner
    }
    console.error('Error creating conversation:', createError)
    return null
  }

  return newConv
}
