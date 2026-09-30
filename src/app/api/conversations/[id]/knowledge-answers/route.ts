import { NextResponse } from 'next/server'
import { csrfGuard } from '@/lib/csrf'
import { inboxConversation } from '@/lib/inbox/server-context'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'
import { gapError, gapHeaders } from '@/lib/ai/gap-knowledge-server'
import { caseGapAnswerInput } from '@/lib/ai/case-gap-answers'
import { caseGapNoticesEnabled } from '@/lib/ai/case-gap-notices'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ id: string }> }
async function context(id: string) {
  const ctx = await inboxConversation(id)
  if (ctx.response) return ctx
  const locale = await getLocale()
  return { ...ctx, t: (key: string) => translate(locale, `gaps.${key}`) }
}
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params, ctx = await context(id)
  if (ctx.response) return ctx.response
  const result = await ctx.db.rpc('list_case_gap_answers', { p_workspace_id: ctx.workspaceId, p_actor_id: ctx.userId, p_conversation_id: id })
  if (result.error) return gapError(result.error, ctx.t)
  const notices = await ctx.db.rpc('list_case_gap_notices', { p_workspace_id: ctx.workspaceId, p_actor_id: ctx.userId, p_conversation_id: id })
  if (notices.error) return gapError(notices.error, ctx.t)
  const fresh = await context(id)
  if (fresh.response) return fresh.response
  if (fresh.workspaceId !== ctx.workspaceId || fresh.userId !== ctx.userId) return NextResponse.json({ error: ctx.t('changed') }, { status: 409, headers: gapHeaders })
  const rows = Array.isArray(result.data) ? result.data : []
  return NextResponse.json({ questions: rows.slice(0, 50), truncated: rows.length > 50, notices: notices.data ?? {}, whatsapp_enabled: caseGapNoticesEnabled() }, { headers: gapHeaders })
}
export async function POST(request: Request, { params }: Params) {
  const csrf = await csrfGuard(request)
  if (csrf) return csrf
  const { id } = await params, ctx = await context(id)
  if (ctx.response) return ctx.response
  const input = caseGapAnswerInput.safeParse(await request.json().catch(() => null))
  if (!input.success) return NextResponse.json({ error: ctx.t('invalid') }, { status: 400, headers: gapHeaders })
  const result = await ctx.db.rpc('save_case_gap_answer', { p_id: input.data.id, p_workspace_id: ctx.workspaceId, p_actor_id: ctx.userId, p_conversation_id: id, p_gap_id: input.data.gap_id, p_expected_revision: input.data.expected_revision, p_answer: input.data.answer })
  if (result.error) return gapError(result.error, ctx.t)
  return NextResponse.json(result.data, { headers: gapHeaders })
}
