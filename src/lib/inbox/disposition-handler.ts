import { NextResponse } from 'next/server'
import { inboxConversation } from './server-context'
import { csrfGuard } from '@/lib/csrf'
import { serverError } from '@/lib/api/errors'
import { dispositionInput } from './disposition'

export async function changeDisposition(request:Request,id:string,readOnly=false) {
  const block=await csrfGuard(request)
  if (block) return block
  const ctx=await inboxConversation(id)
  if (ctx.response) return ctx.response
  const input=dispositionInput(await request.json().catch(() => null))
  if (!input || (readOnly && input.action!=='read')) return NextResponse.json({ error:ctx.t('teamInvalid') },{ status:400 })
  const result=await ctx.db.rpc('set_inbox_disposition',{ p_id:input.id,p_workspace_id:ctx.workspaceId,p_conversation_id:ctx.conversation.id,p_actor_id:ctx.userId,p_action:input.action,p_expected_version:input.expected_version })
  if (result.error) {
    if (/inbox_disposition_changed|inbox_disposition_conflict/.test(result.error.message)) return NextResponse.json({ error:ctx.t('dispositionChanged') },{ status:409 })
    if (result.error.message.includes('subscription_read_only')) return NextResponse.json({ error:ctx.t('orderReadOnly') },{ status:402 })
    if (result.error.message.includes('invalid_inbox_disposition')) return NextResponse.json({ error:ctx.t('teamNotFound') },{ status:404 })
    return serverError(result.error,ctx.t('teamFailed'))
  }
  return NextResponse.json(result.data,{ headers:{ 'Cache-Control':'private, no-store' } })
}
