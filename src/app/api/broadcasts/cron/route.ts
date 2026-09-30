import { NextResponse } from 'next/server'
import { serverError } from '@/lib/api/errors'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { leerConfigWhatsApp } from '@/lib/whatsapp/config-del-comercio'
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
// La resolución de {{n}} salió de este archivo a `lib/broadcasts/variables`:
// ahora también arma campañas la capa de capacidades, y con dos copias la
// previsualización diría un texto y el cliente recibiría otro.
import { dispatchBroadcastRecipient, definiteDeliveryRejection, finalizeBroadcastProgress } from '@/lib/broadcasts/delivery'
import { broadcastDeliveryErrorCode } from '@/lib/broadcasts/delivery-errors'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { renderTemplateBody } from '@/lib/whatsapp/template-render'
import { assertCronAuthAny } from '@/lib/auth/cron'
import { withCronRun } from "@/lib/cron/heartbeat";
import { markOptedOut } from '@/lib/whatsapp/opt-out'
import { acquire } from '@/lib/whatsapp/throttle'
import { motorApagado } from '@/lib/workspaces/motor'
import { sendVoiceNote } from '@/lib/voice-notes/service'
import type { VoiceNoteConfig } from '@/lib/voice-notes/types'

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

export const maxDuration = 300
const SEND_BATCH_SIZE = 10
const SEND_BATCH_DELAY_MS = 1000
const MAX_BROADCASTS_PER_RUN = 5

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function cronHandler(request: Request) {
  try {
    // Accept whichever cron secret the operator wired: the broadcasts cron
    // service sends CRON_SECRET, older config used BROADCAST_CRON_SECRET, and
    // the rest of the crons share AUTOMATION_CRON_SECRET. Any mismatch used to
    // 401 every run → scheduled campaigns silently never sent.
    assertCronAuthAny(request, [
      'BROADCAST_CRON_SECRET',
      'CRON_SECRET',
      'AUTOMATION_CRON_SECRET',
    ])
  } catch (r) {
    if (r instanceof Response) return r
    throw r
  }

  const admin = supabaseAdmin()

  // Revival pass: broadcasts whose dispatcher died mid-batch get stuck
  // in 'sending' forever, and the existing claim filter (status=scheduled)
  // would skip them. Durable receipts below prevent revival from repeating
  // an interrupted provider attempt, even before its result was saved.
  const stuckCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  // Set scheduled_at too: an immediate "Enviar ahora" send whose browser tab
  // closed mid-batch has scheduled_at = NULL, so without this the due query
  // (scheduled_at <= now) would never re-select it and it'd be stranded in
  // 'sending' forever. Stamping now() makes it immediately due to resume.
  await admin
    .from('broadcasts')
    .update({ status: 'scheduled', scheduled_at: new Date().toISOString() })
    .eq('status', 'sending')
    .lt('updated_at', stuckCutoff)

  const { data: due, error } = await admin
    .from('broadcasts')
    .select('*')
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(MAX_BROADCASTS_PER_RUN)

  if (error) return serverError(error)
  if (!due || due.length === 0) return NextResponse.json({ processed: 0 })

  let processed = 0
  const dispatchStarted = Date.now()
  for (const broadcast of due) {
    if (Date.now() - dispatchStarted > 60000) break
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

/** El número del comercio sigue en la app WhatsApp Business: cupo de 20/seg. */
async function esNumeroEnCoexistencia(admin: AdminClient, workspaceId: string | null): Promise<boolean> {
  if (!workspaceId) return false
  const { data } = await admin
    .from('channel_connections')
    .select('config')
    .eq('workspace_id', workspaceId)
    .eq('channel', 'whatsapp')
    .eq('status', 'connected')
    .limit(1)
    .maybeSingle()
  return Boolean((data?.config as { coexistence?: boolean } | null)?.coexistence)
}

async function sendOneBroadcast(
  admin: AdminClient,
  broadcast: Record<string, unknown>,
): Promise<void> {
  const broadcastId = broadcast.id as string
  const voiceNote = broadcast.voice_note as VoiceNoteConfig | null
  const startedAt = Date.now()
  const userId = broadcast.user_id as string
  const templateName = broadcast.template_name as string
  const templateLanguage = (broadcast.template_language as string) || 'en_US'
  const createConversations = Boolean(broadcast.create_conversations)

  // Fetch ALL pending recipients first, then derive the workspace scope
  // from the actual recipients. This is safer than guessing via
  // workspace_members.earliest-joined — a legacy broadcast may belong
  // to a workspace the owner is no longer the primary member of, and
  // the old fallback could silently zero out the recipient list and
  // mark the broadcast as `sent`.
  // Paginado, no opcional: PostgREST devuelve como mucho 1.000 filas por
  // respuesta, así que una campaña de 3.000 personas mandaba a las primeras
  // 1.000 y al terminar se marcaba `sent` — las otras 2.000 quedaban en
  // `pending` para siempre, sin error ni aviso.
  type PendingRecipient = Record<string, unknown> & {
    id: string
    contact: Record<string, unknown> | null
  }
  const allRecipients = await fetchAllRows<PendingRecipient>((from, to) =>
    admin
      .from('broadcast_recipients')
      .select('*, contact:contacts(*)')
      .eq('broadcast_id', broadcastId)
      .eq('status', 'pending')
      .order('id', { ascending: true })
      .range(from, to),
  )

  if (allRecipients.length === 0) {
    if (broadcast.workspace_id) await finalizeBroadcastProgress(admin, String(broadcast.workspace_id), broadcastId)
    else await admin.from('broadcasts').update({status:'failed'}).eq('id',broadcastId).eq('status','sending')
    return
  }

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

  // El motor de la cuenta manda sobre cualquier envío programado: suspendida
  // por cobro, o esperando que el comercio apruebe la instalación, la difusión
  // no sale. Queda pendiente a propósito —ni enviada ni fallida—: cuando la
  // cuenta se enciende, la siguiente corrida la toma donde estaba.
  if (await motorApagado(admin, workspaceScope)) {
    console.warn(`[broadcast-cron] ${broadcastId}: motor apagado, queda pendiente`)
    return
  }

  // Resolve credentials only after proving the actual workspace of legacy rows.
  const config = await leerConfigWhatsApp<Record<string, unknown>>(admin, { workspaceId: workspaceScope, userId })
  if (!config && !voiceNote) throw new Error('WhatsApp not configured for workspace')
  const accessToken = !voiceNote && config ? decrypt(config.access_token as string) : ''
  const phoneNumberId = config?.phone_number_id as string
  const coexistencia = await esNumeroEnCoexistencia(admin, workspaceScope)

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

  let deferred = false
  outer: for (let i = 0; i < recipients.length; i += SEND_BATCH_SIZE) {
    const batch = recipients.slice(i, i + SEND_BATCH_SIZE)
    for (const recipient of batch) {
      if (voiceNote && Date.now() - startedAt > 120000) { deferred = true; break outer }
      const contactId = recipient.contact?.id as string | undefined
      const workspaceId = recipient.contact?.workspace_id as string | undefined
      const phone = recipient.contact?.phone as string | undefined
      const sanitized = phone ? sanitizePhoneForMeta(phone) : ''
      if (!sanitized || !isValidE164(sanitized)) {
        await admin
          .from('broadcast_recipients')
          .update({ status: 'failed', error_message: broadcastDeliveryErrorCode('invalidPhone') })
          .eq('broadcast_id', broadcastId).eq('status', 'pending')
          .eq('id', recipient.id)
        continue
      }

      // Quotas and pacing are checked before creating a durable reservation.
      if (!voiceNote && connectionId) {
        const cap = await assertWithinTierCap(admin, connectionId, 1)
        if (!cap.allowed) { deferred = true; break outer }
      }
      await acquire(workspaceScope, { coexistencia })
      let lastError: string | null = null
      const result = await dispatchBroadcastRecipient(admin, {
        broadcast: { ...broadcast, workspace_id: workspaceScope }, recipient,
        send: async ({ phone: destination, params }) => {
          if (voiceNote) {
            const { data: conversation } = await admin.from('conversations').select('id')
              .eq('workspace_id', workspaceScope).eq('contact_id', contactId)
              .eq('channel', 'whatsapp').eq('connection_id', connectionId).is('deleted_at', null)
              .order('last_message_at', { ascending: false }).limit(1).maybeSingle()
            if (!conversation) throw new Error('voiceNotes.window')
            const audio = await sendVoiceNote({ workspaceId: workspaceScope!, conversationId: conversation.id,
              config: voiceNote, reason: 'campana', origin: 'broadcast', originName: String(broadcast.name ?? ''),
              expectedRecipient: { contactId: contactId!, phone: destination },
            })
            return { messageId: audio.externalMessageId }
          }
          for (const variant of phoneVariants(destination)) {
            try {
              return await sendTemplateMessage({ phoneNumberId, accessToken, to: variant, templateName,
                language: templateLanguage, params, signal: AbortSignal.timeout(15000) })
            } catch (error) {
              lastError = error instanceof Error ? error.message : ''
              if (!definiteDeliveryRejection(error) || !isRecipientNotAllowedError(lastError) || variant === phoneVariants(destination).at(-1)) throw error
            }
          }
          throw new Error('broadcast_delivery_uncertain')
        },
      })
      if (result.status === 'deferred') { deferred = true; continue }
      if (result.status === 'sent') {
        if (!voiceNote && createConversations && contactId && result.payload) {
          try {
            await recordBroadcastConversation(admin, { contactId, workspaceId: workspaceScope, connectionId, templateName,
              bodyPreview: renderTemplateBody(result.payload.template?.body_text ?? templateName, result.payload.params),
              whatsappMessageId: result.messageId ?? null, broadcastName: (broadcast.name as string | null) ?? null,
            })
          } catch { console.warn('[broadcast-cron] conversation record was unavailable') }
        }
      } else if (result.code !== 'alreadySent' && result.code !== 'optedOut') {
        const code = result.code ?? 'unavailable'
        const errorMessage = broadcastDeliveryErrorCode(code)
        await admin.from('broadcast_recipients').update({ status: 'failed', error_message: errorMessage })
          .eq('broadcast_id', broadcastId).eq('id', recipient.id).eq('status', 'pending')
        const klass = result.code === 'rejected' ? classifyMetaError(lastError ?? '') : null
        if ((klass === 'invalid_recipient' || klass === 'spam_blocked') && contactId && workspaceId) {
          await markOptedOut(admin, workspaceId, contactId, klass === 'invalid_recipient' ? 'meta_invalid_recipient' : 'meta_spam_blocked')
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
        scheduled_at: new Date(Date.now() + (voiceNote ? 60000 : 60 * 60 * 1000)).toISOString(),
      })
      .eq('id', broadcastId)
  } else {
    await finalizeBroadcastProgress(admin, workspaceScope!, broadcastId)
  }
}

/** Registra la corrida en cron_runs con duración y resultado reales. */
export const GET = withCronRun("broadcasts", cronHandler);
