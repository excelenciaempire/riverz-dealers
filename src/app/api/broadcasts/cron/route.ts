import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import { recordBroadcastConversation } from '@/lib/broadcasts/conversations'
import { assertCronAuth } from '@/lib/auth/cron'
import { isOptedOut } from '@/lib/whatsapp/opt-out'
import { acquire } from '@/lib/whatsapp/throttle'

/**
 * Send scheduled broadcast campaigns whose time has come.
 *
 * Hit on a schedule (Render Cron / external pinger) with a shared secret in
 * the `x-cron-secret` header matching BROADCAST_CRON_SECRET. Mirrors the
 * automations cron: claim each due broadcast (status scheduled → sending) as
 * a lightweight lock, then fan out its pending recipients server-side using
 * the params resolved at schedule time.
 */

const SEND_BATCH_SIZE = 10
const SEND_BATCH_DELAY_MS = 1000
const MAX_BROADCASTS_PER_RUN = 5

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function GET(request: Request) {
  try {
    assertCronAuth(request, 'BROADCAST_CRON_SECRET')
  } catch (r) {
    if (r instanceof Response) return r
    throw r
  }

  const admin = supabaseAdmin()

  const { data: due, error } = await admin
    .from('broadcasts')
    .select('*')
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(MAX_BROADCASTS_PER_RUN)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!due || due.length === 0) return NextResponse.json({ processed: 0 })

  let processed = 0
  for (const broadcast of due) {
    // Claim — flip scheduled → sending so overlapping invocations skip it.
    const { data: claim } = await admin
      .from('broadcasts')
      .update({ status: 'sending' })
      .eq('id', broadcast.id)
      .eq('status', 'scheduled')
      .select('id')
      .maybeSingle()
    if (!claim) continue

    try {
      await sendOneBroadcast(admin, broadcast)
      processed++
    } catch (err) {
      console.error(`[broadcast-cron] ${broadcast.id} failed:`, err)
      await admin
        .from('broadcasts')
        .update({ status: 'failed' })
        .eq('id', broadcast.id)
    }
  }

  return NextResponse.json({ processed })
}

type AdminClient = ReturnType<typeof supabaseAdmin>

async function sendOneBroadcast(
  admin: AdminClient,
  broadcast: Record<string, unknown>,
): Promise<void> {
  const broadcastId = broadcast.id as string
  const userId = broadcast.user_id as string
  const templateName = broadcast.template_name as string
  const templateLanguage = (broadcast.template_language as string) || 'en_US'
  const createConversations = Boolean(broadcast.create_conversations)
  const variableMapping = (broadcast.variable_mapping as Record<string, string> | null) ?? null

  // WhatsApp credentials for the campaign owner.
  const { data: config } = await admin
    .from('whatsapp_config')
    .select('*')
    .eq('user_id', userId)
    .single()
  if (!config) throw new Error('WhatsApp not configured for owner')
  const accessToken = decrypt(config.access_token as string)
  const phoneNumberId = config.phone_number_id as string

  const { data: recipients } = await admin
    .from('broadcast_recipients')
    .select('*, contact:contacts(*)')
    .eq('broadcast_id', broadcastId)
    .eq('status', 'pending')
  if (!recipients || recipients.length === 0) {
    await admin.from('broadcasts').update({ status: 'sent' }).eq('id', broadcastId)
    return
  }

  let connectionId: string | null = null
  if (createConversations) {
    const wsId = recipients.find((r) => r.contact?.workspace_id)?.contact
      ?.workspace_id as string | undefined
    if (wsId) {
      const { data: conn } = await admin
        .from('channel_connections')
        .select('id')
        .eq('workspace_id', wsId)
        .eq('channel', 'whatsapp')
        .limit(1)
        .maybeSingle()
      connectionId = (conn?.id as string | undefined) ?? null
    }
  }

  let failed = 0
  for (let i = 0; i < recipients.length; i += SEND_BATCH_SIZE) {
    const batch = recipients.slice(i, i + SEND_BATCH_SIZE)
    for (const recipient of batch) {
      const contactId = recipient.contact?.id as string | undefined
      const workspaceId = recipient.contact?.workspace_id as string | undefined
      if (contactId && workspaceId) {
        const optedOut = await isOptedOut(admin, workspaceId, contactId)
        if (optedOut) {
          await admin
            .from('broadcast_recipients')
            .update({
              status: 'skipped_opt_out',
              error_message: 'Contacto dado de baja',
            })
            .eq('id', recipient.id)
          continue
        }
      }

      const phone = recipient.contact?.phone as string | undefined
      const sanitized = phone ? sanitizePhoneForMeta(phone) : ''
      if (!sanitized || !isValidE164(sanitized)) {
        failed++
        await admin
          .from('broadcast_recipients')
          .update({ status: 'failed', error_message: 'Invalid phone number' })
          .eq('id', recipient.id)
        continue
      }

      const params = await resolveParams(
        admin,
        recipient.contact as Record<string, unknown> | null,
        recipient.params as string[] | null,
        variableMapping,
      )

      await acquire(workspaceId ?? userId)
      let sentId: string | null = null
      let lastError: string | null = null
      for (const variant of phoneVariants(sanitized)) {
        try {
          const r = await sendTemplateMessage({
            phoneNumberId,
            accessToken,
            to: variant,
            templateName,
            language: templateLanguage,
            params,
          })
          sentId = r.messageId
          lastError = null
          break
        } catch (err) {
          lastError = err instanceof Error ? err.message : 'Unknown error'
          if (!isRecipientNotAllowedError(lastError)) break
        }
      }

      if (sentId) {
        await admin
          .from('broadcast_recipients')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            whatsapp_message_id: sentId,
            error_message: null,
          })
          .eq('id', recipient.id)

        if (createConversations && recipient.contact?.id) {
          try {
            await recordBroadcastConversation(admin, {
              contactId: recipient.contact.id as string,
              workspaceId: (recipient.contact.workspace_id as string) ?? null,
              connectionId,
              templateName,
              bodyPreview: templateName,
              whatsappMessageId: sentId,
            })
          } catch (convErr) {
            console.error('[broadcast-cron] conversation failed:', convErr)
          }
        }
      } else {
        failed++
        await admin
          .from('broadcast_recipients')
          .update({ status: 'failed', error_message: lastError ?? 'Unknown error' })
          .eq('id', recipient.id)
      }
    }
    if (i + SEND_BATCH_SIZE < recipients.length) await sleep(SEND_BATCH_DELAY_MS)
  }

  await admin
    .from('broadcasts')
    .update({ status: failed === recipients.length ? 'failed' : 'sent' })
    .eq('id', broadcastId)
}

const BUILTIN_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'first_name',
  'last_name',
  'phone',
  'email',
  'company',
])

/**
 * Si la campaña define `variable_mapping`, releemos los valores del
 * contacto (built-in o custom field) en el momento del envío para que
 * los datos sean los más recientes. Si no hay mapping, usamos los
 * params resueltos en tiempo de programación.
 */
async function resolveParams(
  admin: AdminClient,
  contact: Record<string, unknown> | null,
  fallback: string[] | null,
  mapping: Record<string, string> | null,
): Promise<string[]> {
  if (!mapping || Object.keys(mapping).length === 0) return fallback ?? []
  if (!contact) return fallback ?? []

  const keys = Object.keys(mapping).sort((a, b) => Number(a) - Number(b))
  const customFieldIds = keys
    .map((k) => mapping[k])
    .filter((field) => field && !BUILTIN_FIELDS.has(field))

  const customValues = new Map<string, string>()
  if (customFieldIds.length > 0 && contact.id) {
    const { data: rows } = await admin
      .from('contact_custom_values')
      .select('custom_field_id, value')
      .eq('contact_id', contact.id as string)
      .in('custom_field_id', customFieldIds)
    for (const row of (rows ?? []) as Array<{ custom_field_id: string; value: string | null }>) {
      customValues.set(row.custom_field_id, row.value ?? '')
    }
  }

  return keys.map((key) => {
    const field = mapping[key]
    if (!field) return ''
    if (field === 'name') return readString(contact.name)
    if (field === 'first_name') {
      const full = readString(contact.name)
      return full.split(/\s+/)[0] ?? ''
    }
    if (field === 'last_name') {
      const full = readString(contact.name)
      const parts = full.split(/\s+/)
      return parts.length > 1 ? parts.slice(1).join(' ') : ''
    }
    if (field === 'phone') return readString(contact.phone)
    if (field === 'email') return readString(contact.email)
    if (field === 'company') return readString(contact.company)
    return customValues.get(field) ?? ''
  })
}

function readString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}
