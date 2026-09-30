import { NextResponse } from 'next/server'
import { csrfGuard } from '@/lib/csrf'
import { UUID } from '@/lib/inbox/collaboration'
import { inboxConversation } from '@/lib/inbox/server-context'
import { executeCaseOrderAction, CaseOrderError } from '@/lib/inbox/order-actions'
type Context = { params: Promise<{ id: string; operationId: string }> }
export async function POST(request: Request, route: Context) {
  const block = await csrfGuard(request)
  if (block) return block
  const { id,operationId } = await route.params
  const ctx = await inboxConversation(id)
  if (ctx.response) return ctx.response
  if (!ctx.isAdmin) return NextResponse.json({ error:ctx.t('orderApprovalForbidden') },{ status:403 })
  const body = await request.json().catch(() => null)
  const kinds = ['refund','cancel','address','items','replacement']
  if (!UUID.test(operationId) || !body || body.confirmed !== true || Object.keys(body).some(k => !['confirmed','action_type'].includes(k)) ||
    body.action_type !== undefined && !kinds.includes(body.action_type)) return NextResponse.json({ error:ctx.t('teamInvalid') },{ status:400 })
  try {
    const stored = await ctx.db.from('inbox_order_actions').select('action').eq('id',operationId).eq('workspace_id',ctx.workspaceId).eq('conversation_id',id).maybeSingle()
    // Older clients cannot render the new draft review; their generic confirmation is insufficient.
    if (stored.error || !stored.data || !kinds.includes(stored.data.action?.type) ||
      body.action_type !== undefined && body.action_type !== stored.data.action.type ||
      stored.data.action.type === 'replacement' && body.action_type !== 'replacement') throw new CaseOrderError('orderConflict')
    const operation = await executeCaseOrderAction(ctx.db,ctx.workspaceId,id,ctx.conversation.contact_id,ctx.userId,operationId)
    return NextResponse.json({ operation },{ status:operation.status === 'completed' ? 200 : 409 })
  } catch (error) { return NextResponse.json({ error:ctx.t(error instanceof CaseOrderError ? error.message : 'orderUnavailable') },{ status:409 }) }
}
