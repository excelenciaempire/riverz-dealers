import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('cron.broadcasts')
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
  classifyMetaError,
} from '@/lib/whatsapp/phone-utils'
import { recordBroadcastConversation } from '@/lib/broadcasts/conversations'
import { assertCronAuth } from '@/lib/auth/cron'
import { isOptedOut, markOptedOut } from '@/lib/whatsapp/opt-out'
import { acquire } from '@/lib/whatsapp/throttle'
import {
  assertWithinTierCap,
  resolveWhatsAppConnectionId,
} from '@/lib/whatsapp/tier-cap'

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

  // Revival pass: broadcasts whose dispatcher died mid-batch get stuck
  // in 'sending' forever, and the existing claim filter (status=scheduled)
  // would skip them. Per-recipient idempotency holds (the recipients
  // fetch only sees `status='pending'`), so revival cannot double-send
  // the already-sent slice. 15 minutes comfortably exceeds the longest
  // legitimate single-broadcast run.
  const stuckCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  await admin
    .from('broadcasts')
    .update({ status: 'scheduled' })
    .eq('status', 'sending')
    .lt('updated_at', stuckCutoff)

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
      // Route through the logger so SENTRY_DSN gets it. Without this,
      // partial failures swallowed into `console.error` never reach
      // any alerting surface — the operator's only signal was the
      // red dot on Render's dashboard.
      log.captureException(err, { broadcastId: broadcast.id })
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

  // Fetch ALL pending recipients first, then derive the workspace scope
  // from the actual recipients. This is safer than guessing via
  // workspace_members.earliest-joined — a legacy broadcast may belong
  // to a workspace the owner is no longer the primary member of, and
  // the old fallback could silently zero out the recipient list and
  // mark the broadcast as `sent`.
  const { data: recipientsRaw } = await admin
    .from('broadcast_recipients')
    .select('*, contact:contacts(*)')
    .eq('broadcast_id', broadcastId)
    .eq('status', 'pending')
  const allRecipients = recipientsRaw ?? []

  // Belt + suspenders: confine the recipient → contact join to the
  // broadcast's own workspace. RLS is bypassed by the service-role
  // client, so a stale recipient row pointing at a contact that was
  // moved to another workspace would otherwise leak across tenants.
  let workspaceScope = (broadcast.workspace_id as string | null) ?? null
  if (!workspaceScope) {
    const distinctWorkspaces = new Set<string>()
    for (const r of allRecipients) {
      const cw = (r.contact as { workspace_id?: string | null } | null)
        ?.workspace_id
      if (cw) distinctWorkspaces.add(cw)
    }
    if (distinctWorkspaces.size === 1) {
      workspaceScope = [...distinctWorkspaces][0]
      // Backfill so this branch doesn't run again for the same row.
      await admin
        .from('broadcasts')
        .update({ workspace_id: workspaceScope })
        .eq('id', broadcastId)
    } else {
      const msg =
        distinctWorkspaces.size === 0
          ? 'legacy broadcast: no resolvable workspace for recipients'
          : 'legacy broadcast spans multiple workspaces; refusing to dispatch'
      await admin
        .from('broadcasts')
        .update({ status: 'failed', error_message: msg })
        .eq('id', broadcastId)
      console.warn(`[broadcast-cron] ${broadcastId}: ${msg}`)
      return
    }
  }

  const recipients = allRecipients.filter((r) => {
    const cw = (r.contact as { workspace_id?: string } | null)?.workspace_id
    return cw === workspaceScope
  })
  if (recipients.length === 0) {
    // No recipients matched the scope — do NOT mark as sent silently.
    // This usually means the broadcast was scheduled in one workspace
    // but every contact has since been moved out of it.
    await admin
      .from('broadcasts')
      .update({
        status: 'failed',
        error_message: 'no recipients matched workspace scope',
      })
      .eq('id', broadcastId)
    console.warn(
      `[broadcast-cron] ${broadcastId}: no recipients matched workspace scope`,
    )
    return
  }

  // Resolve the WhatsApp channel_connection for this broadcast's
  // workspace once up front. Used for two unrelated things:
  //   1. recording the conversation when `createConversations` is on
  //   2. enforcing the WABA messaging-tier cap before every send
  // Connection-less workspaces (legacy whatsapp_config only) still send
  // — they just bypass the tier cap, which is a known tradeoff until
  // the legacy table is dropped.
  const connectionId = await resolveWhatsAppConnectionId(admin, workspaceScope)

  let failed = 0
  let deferred = false
  outer: for (let i = 0; i < recipients.length; i += SEND_BATCH_SIZE) {
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

      // WABA tier cap. Done per-recipient (rather than upfront for the
      // whole batch) because OTHER campaigns from the same connection
      // may eat into the 24h quota while THIS one is mid-dispatch.
      // Tier-less workspaces (legacy whatsapp_config with no
      // channel_connection row) skip the check — see resolve helper.
      if (connectionId) {
        const decision = await assertWithinTierCap(admin, connectionId, 1)
        if (!decision.allowed) {
          deferred = true
          // Leave the recipient in `pending` so the next cron tick
          // re-evaluates after the 24h window slides. Recording the
          // reason on the broadcast (not the recipient) keeps the row
          // re-tryable without losing the audit trail.
          await admin
            .from('broadcasts')
            .update({ error_message: decision.reason ?? null })
            .eq('id', broadcastId)
          // Once the cap is hit, every subsequent recipient would too
          // — bail out of both loops and flip the broadcast back to
          // `scheduled` below so the next tick re-evaluates.
          break outer
        }
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
        const klass = classifyMetaError(lastError ?? '')
        await admin
          .from('broadcast_recipients')
          .update({ status: 'failed', error_message: lastError ?? 'Unknown error' })
          .eq('id', recipient.id)

        // Self-heal: flag contacts that Meta says are permanently
        // unreachable so we don't burn quality rating retrying them on
        // the next campaign. Uses the existing opted_out column +
        // reason so the inbox UI can distinguish user-initiated STOP
        // from Meta-driven flags.
        if (
          (klass === 'invalid_recipient' || klass === 'spam_blocked') &&
          contactId &&
          workspaceId
        ) {
          await markOptedOut(
            admin,
            workspaceId,
            contactId,
            klass === 'invalid_recipient'
              ? 'meta_invalid_recipient'
              : 'meta_spam_blocked',
          )
        }
      }
    }
    if (i + SEND_BATCH_SIZE < recipients.length) await sleep(SEND_BATCH_DELAY_MS)
  }

  // Three terminal states:
  //   - deferred: hit the WABA tier cap mid-batch → bounce the
  //     broadcast back to `scheduled` so the next cron tick picks it
  //     up. scheduled_at is advanced just past the cap-reset horizon
  //     (24h after the earliest sent_at in the current window) so we
  //     don't pointlessly retry every minute.
  //   - all failed: `failed`
  //   - otherwise: `sent` (mix of sent + failed + skipped_opt_out)
  if (deferred) {
    await admin
      .from('broadcasts')
      .update({
        status: 'scheduled',
        scheduled_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .eq('id', broadcastId)
  } else {
    await admin
      .from('broadcasts')
      .update({ status: failed === recipients.length ? 'failed' : 'sent' })
      .eq('id', broadcastId)
  }
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
