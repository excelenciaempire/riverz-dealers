import { NextResponse } from 'next/server'
import { inboxConversation } from '@/lib/inbox/server-context'
import { UUID } from '@/lib/inbox/collaboration'
import { caseOrderSnapshot, CaseOrderError } from '@/lib/inbox/order-actions'
import { shippingChangeAllowed } from '@/lib/shopify/shipping-address-contract'
type Context = { params:Promise<{ id:string; operationId:string }> }
/** The URL's identifier is a local order; workspace, contact and mailbox access are resolved on the server. */
export async function GET(_request:Request,route:Context) {
  const { id,operationId:orderId } = await route.params
  const ctx = await inboxConversation(id)
  if (ctx.response) return ctx.response
  if (!UUID.test(orderId)) return NextResponse.json({ error:ctx.t('orderNotFound') },{ status:404 })
  try {
    const snapshot = await caseOrderSnapshot(ctx.db,ctx.workspaceId,ctx.conversation.contact_id,orderId,null,{ shippingOnly:true })
    return NextResponse.json({ shipping_address:snapshot.preview.shipping_address,can_modify:shippingChangeAllowed(snapshot.live) },{ headers:{ 'Cache-Control':'private, no-store' } })
  } catch (error) {
    return NextResponse.json({ error:ctx.t(error instanceof CaseOrderError ? error.message : 'orderUnavailable') },{ status:409 })
  }
}
