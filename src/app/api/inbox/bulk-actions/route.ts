import { NextResponse } from 'next/server'
import { csrfGuard } from '@/lib/csrf'
import { serverError } from '@/lib/api/errors'
import { UUID } from '@/lib/inbox/collaboration'
import { canAccessConversation } from '@/lib/inbox/access'
import { inboxSession } from '@/lib/inbox/server-context'
import { bulkCaseIds, bulkCaseRunId } from '@/lib/inbox/bulk-actions'

export async function POST(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block
  const ctx = await inboxSession()
  if (ctx.response) return ctx.response
  const b = await request.json().catch(() => null)
  const ids = bulkCaseIds(b?.ids)
  if (!ids || !UUID.test(b?.id ?? '') || !UUID.test(b.macro_id ?? '') || !Number.isInteger(b.version) || b.version < 1 || typeof b.dry_run !== 'boolean' ||
    Object.keys(b).some(k => !['id', 'ids', 'macro_id', 'version', 'dry_run'].includes(k))) return NextResponse.json({ error: ctx.t('bulkMacroLimit') }, { status: 400 })
  const [cases, macro] = await Promise.all([
    ctx.db.from('conversations').select('id,channel,connection_id,contact:contacts(name)').eq('workspace_id', ctx.workspaceId).in('id', ids).is('deleted_at', null),
    ctx.db.from('inbox_macros').select('id,name,actions,version,is_active').eq('workspace_id', ctx.workspaceId).eq('id', b.macro_id).maybeSingle(),
  ])
  if (cases.error || macro.error) return serverError(cases.error ?? macro.error, ctx.t('teamFailed'))
  if (!macro.data) return NextResponse.json({ error: ctx.t('macroChanged') }, { status: 409 })
  if (b.dry_run && (macro.data.version !== b.version || !macro.data.is_active)) return NextResponse.json({ error: ctx.t('macroChanged') }, { status: 409 })
  // Authorize the entire explicit selection before changing a single case.
  // A channel or saved-view filter can never expand this request's scope.
  try {
    if (cases.data?.length !== ids.length) return NextResponse.json({ error: ctx.t('teamNotFound') }, { status: 404 })
    for (const c of cases.data) if (!(await canAccessConversation(ctx.db, ctx.userId, c))) return NextResponse.json({ error: ctx.t('teamNotFound') }, { status: 404 })
  } catch (error) { return serverError(error, ctx.t('teamFailed')) }
  if (b.dry_run) return NextResponse.json({ cases: cases.data, macro: macro.data }, { headers: { 'Cache-Control': 'private, no-store' } })
  const results = []
  for (const id of ids) {
    const result = await ctx.db.rpc('apply_inbox_actions', { p_id: bulkCaseRunId(b.id, id), p_workspace_id: ctx.workspaceId,
      p_conversation_id: id, p_actor_id: ctx.userId, p_actions: null, p_macro_id: b.macro_id, p_macro_version: b.version })
    results.push({ id, ok: !result.error, ...(result.error ? { error: ctx.t('bulkMacroFailed') } : { result: result.data }) })
  }
  return NextResponse.json({ results }, { status: results.some(r => !r.ok) ? 207 : 200 })
}
