import { NextResponse } from 'next/server'
import { z } from 'zod'
import { inboxSession } from '@/lib/inbox/server-context'
import { csrfGuard } from '@/lib/csrf'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'
import { serverError } from '@/lib/api/errors'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { leerConfigWhatsApp } from '@/lib/whatsapp/config-del-comercio'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { phoneVariants, isRecipientNotAllowedError } from '@/lib/whatsapp/phone-utils'
import { acquire } from '@/lib/whatsapp/throttle'
import { assertWithinTierCap, resolveWhatsAppConnectionId } from '@/lib/whatsapp/tier-cap'
import { definiteDeliveryRejection, dispatchBroadcastRecipient, finalizeBroadcastProgress, type BroadcastRecipient } from '@/lib/broadcasts/delivery'
import { recordBroadcastConversation } from '@/lib/broadcasts/conversations'
import { renderTemplateBody } from '@/lib/whatsapp/template-render'
import { broadcastDeliveryErrorCode } from '@/lib/broadcasts/delivery-errors'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const inputSchema = z.object({ broadcast_id: z.string().uuid(), recipient_ids: z.array(z.string().uuid()).min(1).max(10), finalize: z.boolean().optional() }).strict()
const headers = { 'Cache-Control': 'private, no-store' }

export async function POST(request: Request) {
  const csrf = await csrfGuard(request)
  if (csrf) return csrf
  const locale = await getLocale()
  const t = (key: string) => translate(locale, `broadcasts.delivery${key}`)
  try {
    const ctx = await inboxSession()
    if (ctx.response) return ctx.response
    const input = inputSchema.safeParse(await request.json().catch(() => null))
    if (!input.success || new Set(input.data.recipient_ids).size !== input.data.recipient_ids.length) return NextResponse.json({ error: t('Invalid') }, { status: 400, headers })
    const limit = checkRateLimit(`broadcast-delivery:${ctx.userId}`, { limit: 60, windowMs: 60000 })
    if (!limit.success) return rateLimitResponse(limit)
    const campaign = await ctx.db.from('broadcasts').select('*').eq('workspace_id', ctx.workspaceId).eq('id', input.data.broadcast_id).maybeSingle()
    if (campaign.error) return serverError(campaign.error, t('Unavailable'))
    if (!campaign.data || campaign.data.voice_note || (!ctx.isAdmin && campaign.data.user_id !== ctx.userId)) return NextResponse.json({ error: t('Invalid') }, { status: 404, headers })
    const rows = await ctx.db.from('broadcast_recipients').select('*,contact:contacts(*)').eq('broadcast_id', campaign.data.id).in('id', input.data.recipient_ids)
    if (rows.error) return serverError(rows.error, t('Unavailable'))
    if (rows.data?.length !== input.data.recipient_ids.length || rows.data.some(r => r.contact?.workspace_id !== ctx.workspaceId)) return NextResponse.json({ error: t('Invalid') }, { status: 404, headers })
    const config = await leerConfigWhatsApp<{ access_token: string; phone_number_id: string }>(ctx.db, { workspaceId: ctx.workspaceId })
    if (!config) return NextResponse.json({ error: t('Unavailable') }, { status: 503, headers })
    const token = decrypt(config.access_token)
    const connectionId = await resolveWhatsAppConnectionId(ctx.db, ctx.workspaceId)
    const results: { recipient_id: string; status: string; whatsapp_message_id?: string; error?: string; recorded?: boolean }[] = []
    const started = Date.now()
    for (const recipient of rows.data as BroadcastRecipient[]) {
      if (Date.now() - started > 45000) { results.push({ recipient_id: recipient.id, status: 'deferred', error: t('Paused') }); continue }
      if (connectionId) {
        const cap = await assertWithinTierCap(ctx.db, connectionId, 1)
        if (!cap.allowed) { results.push({ recipient_id: recipient.id, status: 'deferred', error: t('Paused') }); continue }
      }
      await acquire(ctx.workspaceId)
      const result = await dispatchBroadcastRecipient(ctx.db, {
        broadcast: campaign.data, recipient, actorId: ctx.userId,
        send: async ({ phone, params }) => {
          for (const variant of phoneVariants(phone)) {
            try {
              return await sendTemplateMessage({ phoneNumberId: config.phone_number_id, accessToken: token, to: variant,
                templateName: campaign.data.template_name, language: campaign.data.template_language ?? 'en_US', params, signal: AbortSignal.timeout(15000) })
            } catch (error) {
              if (!definiteDeliveryRejection(error) || !isRecipientNotAllowedError(error instanceof Error ? error.message : '')) throw error
              if (variant === phoneVariants(phone).at(-1)) throw error
            }
          }
          throw new Error('broadcast_delivery_uncertain')
        },
      })
      if (result.status === 'failed' && !result.attempted && !['alreadySent', 'notPending'].includes(result.code ?? '')) {
        await ctx.db.from('broadcast_recipients').update({ status: 'failed', error_message: broadcastDeliveryErrorCode(result.code ?? 'unavailable') })
          .eq('broadcast_id', campaign.data.id).eq('id', recipient.id).eq('status', 'pending')
      }
      if (result.status === 'sent' && result.payload && campaign.data.create_conversations) {
        try {
          await recordBroadcastConversation(ctx.db, { contactId: String(recipient.contact_id), workspaceId: ctx.workspaceId, connectionId,
            templateName: campaign.data.template_name, bodyPreview: renderTemplateBody(result.payload.template?.body_text ?? campaign.data.template_name, result.payload.params),
            whatsappMessageId: result.messageId ?? null, broadcastName: campaign.data.name })
        } catch { console.warn('[broadcast] conversation record was unavailable') }
      }
      results.push({ recipient_id: recipient.id, status: result.status, whatsapp_message_id: result.messageId, recorded: result.recorded,
        error: result.code ? t(result.code.charAt(0).toUpperCase() + result.code.slice(1)) : undefined })
    }
    const fresh = await inboxSession()
    if (fresh.response) return fresh.response
    if (fresh.workspaceId !== ctx.workspaceId || fresh.userId !== ctx.userId) return NextResponse.json({ error: t('Invalid') }, { status: 403, headers })
    if (input.data.finalize) await finalizeBroadcastProgress(ctx.db, ctx.workspaceId, campaign.data.id, ctx.userId)
    return NextResponse.json({ results }, { headers })
  } catch (error) { return serverError(error, t('Unavailable')) }
}
