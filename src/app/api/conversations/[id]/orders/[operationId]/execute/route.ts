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
  if (!UUID.test(operationId) || !body || body.confirmed !== true || Object.keys(body).some(k => k !== 'confirmed')) return NextResponse.json({ error:ctx.t('teamInvalid') },{ status:400 })
  try {
    const operation = await executeCaseOrderAction(ctx.db,ctx.workspaceId,id,ctx.conversation.contact_id,ctx.userId,operationId)
    return NextResponse.json({ operation },{ status:operation.status === 'completed' ? 200 : 409 })
  } catch (error) { return NextResponse.json({ error:ctx.t(error instanceof CaseOrderError ? error.message : 'orderUnavailable') },{ status:409 }) }
}
