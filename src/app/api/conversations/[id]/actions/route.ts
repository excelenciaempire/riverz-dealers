import { NextResponse } from 'next/server'
import { csrfGuard } from '@/lib/csrf'
import { serverError } from '@/lib/api/errors'
import { inboxActions } from '@/lib/inbox/case-actions'
import { UUID } from '@/lib/inbox/collaboration'
import { inboxConversation, inboxActionError } from '@/lib/inbox/server-context'

type Context = { params: Promise<{ id: string }> }
export async function GET(_request: Request, route: Context) {
  const ctx = await inboxConversation((await route.params).id)
  if (ctx.response) return ctx.response
  const [reminders, history] = await Promise.all([
    ctx.client.from('inbox_reminders').select('id,due_at,body,status').eq('workspace_id', ctx.workspaceId).eq('conversation_id', ctx.conversation.id)
      .eq('user_id', ctx.userId).eq('status', 'pending').order('due_at').limit(50),
    ctx.client.from('inbox_action_runs').select('id,macro_id,macro_version,result,created_at').eq('workspace_id', ctx.workspaceId)
      .eq('conversation_id', ctx.conversation.id).order('created_at', { ascending: false }).limit(20),
  ])
  if (reminders.error || history.error) return serverError(reminders.error ?? history.error, ctx.t('teamFailed'))
  return NextResponse.json({ snoozed_until: ctx.conversation.snoozed_until, reminders: reminders.data ?? [], history: history.data ?? [] }, { headers: { 'Cache-Control': 'private, no-store' } })
}
export async function POST(request: Request, route: Context) {
  const block = await csrfGuard(request)
  if (block) return block
  const ctx = await inboxConversation((await route.params).id)
  if (ctx.response) return ctx.response
  const body = await request.json().catch(() => null)
  const macro = typeof body?.macro_id === 'string' && UUID.test(body.macro_id) && Number.isInteger(body.version) && body.version > 0
  const actions = macro ? null : inboxActions(body?.actions)
  if (!body || !UUID.test(body.id ?? '') || Object.keys(body).some(k => !['id', 'actions', 'macro_id', 'version'].includes(k)) ||
    (macro ? body.actions !== undefined : !actions || body.macro_id !== undefined || body.version !== undefined)) return NextResponse.json({ error: ctx.t('teamInvalid') }, { status: 400 })
  const result = await ctx.db.rpc('apply_inbox_actions', {
    p_id: body.id, p_workspace_id: ctx.workspaceId, p_conversation_id: ctx.conversation.id, p_actor_id: ctx.userId,
    p_actions: actions, p_macro_id: macro ? body.macro_id : null, p_macro_version: macro ? body.version : null,
  })
  if (result.error) return inboxActionError(result.error, ctx.t)
  return NextResponse.json({ result: result.data })
}
