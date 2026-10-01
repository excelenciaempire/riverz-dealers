import { NextResponse } from 'next/server'
import { z } from 'zod'
import { inboxSession } from '@/lib/inbox/server-context'
import { csrfGuard } from '@/lib/csrf'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'
import { serverError } from '@/lib/api/errors'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { editableDraft, draftWriteSchema, draftLaunchSchema, storedDraftConfig, draftTemplateProof } from '@/lib/broadcasts/draft'
import { draftTemplate, prepareDraftRecipients } from '@/lib/broadcasts/draft-server'
import { deliveryHash } from '@/lib/broadcasts/delivery'
import { rateFor, toCategory } from '@/lib/whatsapp/pricing'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const headers = { 'Cache-Control': 'private, no-store' }
const uuid = z.string().uuid()
const columns = 'id,short_id,user_id,name,status,updated_at,template_name,template_language,voice_note,template_variables,variable_mapping,audience_filter,scheduled_at,create_conversations'
type Session = Awaited<ReturnType<typeof inboxSession>>
async function campaign(ctx: Session, id: string) {
  if (ctx.response) throw new Error('broadcast_draft_invalid')
  const result = await ctx.db.from('broadcasts').select(columns).eq('workspace_id', ctx.workspaceId).eq('id', id).maybeSingle()
  if (result.error) throw new Error('broadcast_draft_unavailable')
  if (!result.data || (!ctx.isAdmin && result.data.user_id !== ctx.userId)) throw new Error('broadcast_draft_invalid')
  if (result.data.status !== 'draft') throw new Error('broadcast_draft_changed')
  return result.data
}
async function fail(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  const code = ['invalid','changed','template','paused','too_large'].find(v => message.includes(`broadcast_draft_${v}`))
  const locale = await getLocale()
  const t = (key: string) => translate(locale, `broadcasts.draft${key}`)
  const keys: Record<string, string> = { invalid: 'Invalid', changed: 'Changed', template: 'Template', paused: 'Paused', too_large: 'TooLarge' }
  if (code) return NextResponse.json({ error: t(keys[code]) }, { status: code === 'invalid' ? 404 : 409, headers })
  return serverError(error, t('Unavailable'))
}
export async function GET(request: Request) {
  try {
    const ctx = await inboxSession(); if (ctx.response) return ctx.response
    const id = uuid.safeParse(new URL(request.url).searchParams.get('id')); if (!id.success) throw new Error('broadcast_draft_invalid')
    const row = await campaign(ctx, id.data), config = editableDraft(row)
    let template = null
    try { template = await draftTemplate(ctx.db, ctx.workspaceId, config, row.user_id) }
    catch (error) { if (!(error instanceof Error) || !['broadcast_draft_template', 'broadcast_draft_invalid'].includes(error.message)) throw error }
    return NextResponse.json({ id: row.id, updated_at: row.updated_at, config, template }, { headers })
  } catch (error) { return fail(error) }
}
export async function PATCH(request: Request) {
  const csrf = await csrfGuard(request); if (csrf) return csrf
  try {
    const ctx = await inboxSession(); if (ctx.response) return ctx.response
    const input = draftWriteSchema.safeParse(await request.json().catch(() => null)); if (!input.success) throw new Error('broadcast_draft_invalid')
    const limit = checkRateLimit(`broadcast-draft:${ctx.userId}`, { limit: 12, windowMs: 60000 }); if (!limit.success) return rateLimitResponse(limit)
    const row = await campaign(ctx, input.data.id)
    if (Date.parse(row.updated_at) !== Date.parse(input.data.expected_updated_at)) throw new Error('broadcast_draft_changed')
    const template = await draftTemplate(ctx.db, ctx.workspaceId, input.data.config, row.user_id)
    if (deliveryHash(draftTemplateProof(template)) !== deliveryHash(input.data.expected_template)) throw new Error('broadcast_draft_template')
    const recipients = await prepareDraftRecipients(ctx.db, ctx.workspaceId, input.data.config)
    const fresh = await inboxSession(); if (fresh.response) return fresh.response
    if (fresh.workspaceId !== ctx.workspaceId || fresh.userId !== ctx.userId) throw new Error('broadcast_draft_changed')
    const result = await ctx.db.rpc('save_broadcast_draft', { p_workspace_id: ctx.workspaceId, p_broadcast_id: row.id, p_actor_id: ctx.userId,
      p_expected_updated_at: input.data.expected_updated_at, p_config: storedDraftConfig(input.data.config), p_recipients: recipients, p_template: template })
    if (result.error) throw new Error(result.error.message)
    if (!result.data?.updated_at || result.data.status !== 'draft') throw new Error('broadcast_draft_unavailable')
    return NextResponse.json({ ...result.data, estimated_cost: template ? recipients.reduce((sum, r) => sum + rateFor(r.phone, toCategory(template.category)), 0) : null }, { headers })
  } catch (error) { return fail(error) }
}
/** Explicit confirmation queues the exact reviewed draft, never a new campaign. */
export async function POST(request: Request) {
  const csrf = await csrfGuard(request); if (csrf) return csrf
  try {
    const ctx = await inboxSession(); if (ctx.response) return ctx.response
    const input = draftLaunchSchema.safeParse(await request.json().catch(() => null)); if (!input.success) throw new Error('broadcast_draft_invalid')
    const limit = checkRateLimit(`broadcast-draft-launch:${ctx.userId}`, { limit: 20, windowMs: 60000 }); if (!limit.success) return rateLimitResponse(limit)
    await campaign(ctx, input.data.id)
    const fresh = await inboxSession(); if (fresh.response) return fresh.response
    if (fresh.workspaceId !== ctx.workspaceId || fresh.userId !== ctx.userId) throw new Error('broadcast_draft_changed')
    const result = await ctx.db.rpc('launch_reviewed_broadcast_draft', { p_workspace_id: ctx.workspaceId, p_broadcast_id: input.data.id, p_actor_id: ctx.userId, p_expected_updated_at: input.data.expected_updated_at })
    if (result.error) throw new Error(result.error.message)
    if (result.data?.status !== 'scheduled') throw new Error('broadcast_draft_unavailable')
    return NextResponse.json(result.data, { headers })
  } catch (error) { return fail(error) }
}
