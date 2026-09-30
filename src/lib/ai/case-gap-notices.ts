import { createHash, randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Locale } from '@/lib/i18n/config'
import { translate } from '@/lib/i18n/translate'
import { destinosDeAviso } from '@/lib/avisos/destinos'
import { platformWhatsApp, sendPlatformAlert } from '@/lib/admin/platform-whatsapp'

export const caseGapNoticesEnabled = () => process.env.RIVERZ_CASE_QUESTION_WHATSAPP === 'enabled'
type TransportResult = Awaited<ReturnType<typeof sendPlatformAlert>>
export function caseNoticeOutcome(result: TransportResult): 'accepted' | 'rejected' | 'uncertain' {
  if (result.ok && typeof result.messageId === 'string' && result.messageId.trim()) return 'accepted'
  if (!result.ok && result.httpStatus && result.httpStatus >= 400 && result.httpStatus < 500 && result.httpStatus !== 408) return 'rejected'
  return 'uncertain'
}
const hash = (phone: string) => createHash('sha256').update(phone).digest('hex')
type Context = { db: SupabaseClient; workspaceId: string; userId: string; conversationId: string; locale: Locale }
/** No customer content is sent to a notification number. The link still requires
 * authentication and current case access. Claimed or uncertain sends never retry. */
export async function notifyCaseGap(ctx: Context, request: { id: string; gapId: string }) {
  if (!caseGapNoticesEnabled()) return { data: null, error: { message: 'gap_notice_disabled' } }
  if (!(await platformWhatsApp())) return { data: null, error: { message: 'gap_notice_transport' } }
  const phones = [...new Set(await destinosDeAviso(ctx.db, ctx.workspaceId, 'operacion'))]
  if (!phones.length || phones.length > 10) return { data: null, error: { message: 'gap_notice_destinations' } }
  const reserved = await ctx.db.rpc('reserve_case_gap_notice', { p_id: request.id, p_workspace_id: ctx.workspaceId, p_actor_id: ctx.userId, p_conversation_id: ctx.conversationId, p_gap_id: request.gapId, p_recipient_hashes: phones.map(hash) })
  if (reserved.error) return reserved
  const record = reserved.data as { id: string; resumable: boolean } | null
  if (!record?.id) return { data: null, error: { message: 'invalid_gap_context' } }
  if (record.resumable) {
    const intended = await ctx.db.from('case_gap_question_recipients').select('recipient_hash').eq('notice_id', record.id)
    if (intended.error) return intended
    const current = new Map((await destinosDeAviso(ctx.db, ctx.workspaceId, 'operacion')).map(phone => [hash(phone), phone]))
    for (const recipient of intended.data ?? []) {
      const claimId = randomUUID(), to = current.get(recipient.recipient_hash)
      const claim = await ctx.db.rpc('claim_case_gap_notice', { p_id: record.id, p_workspace_id: ctx.workspaceId, p_actor_id: ctx.userId, p_recipient_hash: recipient.recipient_hash, p_claim_id: claimId, p_destination_current: !!to })
      if (claim.error) return claim
      if (claim.data !== true || !to) continue
      let result: TransportResult
      try {
        result = await sendPlatformAlert({ to, title: translate(ctx.locale, 'gaps.caseNoticeTitle'), body: translate(ctx.locale, 'gaps.caseNoticeBody', { url: `https://riverz.co/bandeja?c=${ctx.conversationId}` }) })
      } catch { result = { ok: false } }
      const state = caseNoticeOutcome(result)
      const finished = await ctx.db.rpc('finish_case_gap_notice', { p_id: record.id, p_recipient_hash: recipient.recipient_hash, p_claim_id: claimId, p_state: state, p_provider_message_id: state === 'accepted' ? result.messageId : null })
      if (finished.error || finished.data !== true) {
        // A lost receipt must never repeat the already attempted external send.
        console.error('[ai] internal question notice receipt was not confirmed')
      }
    }
  }
  return ctx.db.rpc('case_gap_notice_status', { p_workspace_id: ctx.workspaceId, p_actor_id: ctx.userId, p_gap_id: request.gapId })
}
