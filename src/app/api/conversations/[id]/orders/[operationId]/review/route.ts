import { NextResponse } from 'next/server'
import { csrfGuard } from '@/lib/csrf'
import { inboxConversation } from '@/lib/inbox/server-context'
import { UUID } from '@/lib/inbox/collaboration'
import { uncertainCaseOrderSnapshot, CaseOrderError } from '@/lib/inbox/order-actions'
type Context = { params:Promise<{ id:string; operationId:string }> }
async function context(route:Context) {
  const { id,operationId:orderId } = await route.params
  const ctx = await inboxConversation(id)
  if (ctx.response) return ctx
  if (!ctx.isAdmin) return { response:NextResponse.json({ error:ctx.t('orderApprovalForbidden') },{ status:403 }) }
  if (!UUID.test(orderId)) return { response:NextResponse.json({ error:ctx.t('orderNotFound') },{ status:404 }) }
  return { ...ctx,orderId }
}
export async function GET(_request:Request,route:Context) {
  const ctx = await context(route)
  if (ctx.response) return ctx.response
  try {
    const { source_id,action_type,snapshot } = await uncertainCaseOrderSnapshot(ctx.db,ctx.workspaceId,ctx.conversation.contact_id,ctx.orderId)
    return NextResponse.json({ source_id,action_type,fingerprint:snapshot.fingerprint,preview:snapshot.preview },{ headers:{ 'Cache-Control':'private, no-store' } })
  } catch (error) { return NextResponse.json({ error:ctx.t(error instanceof CaseOrderError ? error.message : 'orderUnavailable') },{ status:409 }) }
}
export async function POST(request:Request,route:Context) {
  const block = await csrfGuard(request)
  if (block) return block
  const ctx = await context(route)
  if (ctx.response) return ctx.response
  const body = await request.json().catch(() => null)
  if (!body || body.confirmed !== true || !UUID.test(body.source_id ?? '') || typeof body.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(body.fingerprint) ||
    typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length>300 || Object.keys(body).some(k => !['source_id','fingerprint','confirmed','reason','action_type'].includes(k)) ||
    body.action_type!==undefined && !['financial','refund','cancel','address','items','replacement','hold'].includes(body.action_type)) return NextResponse.json({ error:ctx.t('teamInvalid') },{ status:400 })
  try {
    const { source_id,action_type,snapshot } = await uncertainCaseOrderSnapshot(ctx.db,ctx.workspaceId,ctx.conversation.contact_id,ctx.orderId)
    if (source_id !== body.source_id || snapshot.fingerprint !== body.fingerprint) throw new CaseOrderError('orderChanged')
    if (body.action_type!==undefined && body.action_type!==action_type || ['address','items','replacement','hold'].includes(action_type) && body.action_type!==action_type) throw new CaseOrderError('orderConflict')
    const saved = await ctx.db.rpc('review_order_execution',{ p_workspace_id:ctx.workspaceId,p_conversation_id:ctx.conversation.id,p_order_id:ctx.orderId,
      p_actor_id:ctx.userId,p_source_id:body.source_id,p_reason:body.reason.trim(),p_snapshot:{ ...snapshot.preview,action_type,fingerprint:snapshot.fingerprint } })
    if (saved.error) throw new CaseOrderError('orderConflict')
    return NextResponse.json({ review:saved.data })
  } catch (error) { return NextResponse.json({ error:ctx.t(error instanceof CaseOrderError ? error.message : 'orderUnavailable') },{ status:409 }) }
}
