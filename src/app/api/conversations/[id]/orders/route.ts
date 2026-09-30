import { NextResponse } from 'next/server'
import { csrfGuard } from '@/lib/csrf'
import { serverError } from '@/lib/api/errors'
import { inboxConversation } from '@/lib/inbox/server-context'
import { orderPreviewInput, sameCaseOrderAction } from '@/lib/inbox/order-action-contract'
import { CaseOrderError, caseOrderSnapshot } from '@/lib/inbox/order-actions'
import { resolveShopifyAdmin } from '@/lib/shopify/order-tags'
import { prepareReviewedOrderItems } from '@/lib/shopify/reviewed-order-items'
import { prepareReplacementDraft } from '@/lib/shopify/replacement-draft'
import { prepareFulfillmentHold } from '@/lib/shopify/fulfillment-hold'
import { prepareStoreCredit } from '@/lib/shopify/store-credit'
type Context = { params: Promise<{ id: string }> }

export async function GET(request: Request, route: Context) {
  const ctx = await inboxConversation((await route.params).id)
  if (ctx.response) return ctx.response
  const providerId = new URL(request.url).searchParams.get('shopify_order_id')
  if (providerId !== null && !/^\d{1,20}$/.test(providerId)) return NextResponse.json({ error:ctx.t('teamInvalid') },{ status:400 })
  const admin = await resolveShopifyAdmin(ctx.db,ctx.workspaceId).catch(() => null)
  if (!admin) return NextResponse.json({ error:ctx.t('orderStoreChanged') },{ status:409 })
  let q = ctx.db.from('orders').select('id,shopify_order_id,order_number,currency,financial_status,status').eq('workspace_id',ctx.workspaceId).eq('contact_id',ctx.conversation.contact_id).eq('platform','shopify')
    .eq('shop_domain',admin.shopDomain)
  if (providerId) q = q.eq('shopify_order_id',providerId)
  const orders = await q.order('created_at',{ ascending:false }).limit(20)
  const history = await ctx.client.from('inbox_order_actions').select('id,order_id,requested_by,approved_by,action,preview,fingerprint,status,expires_at,created_at,approved_at,result')
    .eq('workspace_id',ctx.workspaceId).eq('conversation_id',ctx.conversation.id).order('created_at',{ ascending:false }).limit(30)
  if (orders.error || history.error) return serverError(orders.error ?? history.error,ctx.t('orderUnavailable'))
  const orderIds = (orders.data ?? []).map(o => o.id)
  const locks = orderIds.length ? await ctx.db.from('order_execution_locks').select('order_id,status').eq('workspace_id',ctx.workspaceId).in('order_id',orderIds) : { data:[],error:null }
  if (locks.error) return serverError(locks.error,ctx.t('orderUnavailable'))
  const actorIds = [...new Set((history.data ?? []).flatMap(op => [op.requested_by,op.approved_by]).filter(Boolean))]
  const profiles = actorIds.length ? await ctx.db.from('profiles').select('user_id,full_name').in('user_id',actorIds) : { data:[] }
  const actors = Object.fromEntries((profiles.data ?? []).map(p => [p.user_id,p.full_name]))
  return NextResponse.json({ orders:orders.data ?? [],history:history.data ?? [],locks:locks.data ?? [],actors,can_execute:ctx.isAdmin },{ headers:{ 'Cache-Control':'private, no-store' } })
}
export async function POST(request: Request, route: Context) {
  const block = await csrfGuard(request)
  if (block) return block
  const ctx = await inboxConversation((await route.params).id)
  if (ctx.response) return ctx.response
  const input = orderPreviewInput(await request.json().catch(() => null))
  if (!input) return NextResponse.json({ error:ctx.t('teamInvalid') },{ status:400 })
  try {
    // Retry can recover the exact old preview, rather than silently refreshing the approved facts.
    const prior = await ctx.db.from('inbox_order_actions').select('*').eq('id',input.id).eq('workspace_id',ctx.workspaceId).eq('conversation_id',ctx.conversation.id).maybeSingle()
    if (prior.error) return serverError(prior.error,ctx.t('orderUnavailable'))
    if (prior.data) {
      if (prior.data.requested_by !== ctx.userId || prior.data.order_id !== input.order_id || !sameCaseOrderAction(prior.data.action,input.action)) return NextResponse.json({ error:ctx.t('orderConflict') },{ status:409 })
      return NextResponse.json({ operation:prior.data,can_execute:ctx.isAdmin })
    }
    const snapshot = await caseOrderSnapshot(ctx.db,ctx.workspaceId,ctx.conversation.contact_id,input.order_id,input.action)
    if (input.action.type === 'hold') {
      const prepared=await prepareFulfillmentHold(snapshot.admin,snapshot.local.shopify_order_id)
      if (!prepared.ok) throw new CaseOrderError(prepared.error)
      snapshot.preview.hold=prepared.quote
    }
    if (input.action.type === 'credit') {
      const prepared=await prepareStoreCredit(snapshot.admin,snapshot.live,input.action.amount)
      if (!prepared.ok) throw new CaseOrderError(prepared.error)
      snapshot.preview.credit=prepared.quote
    }
    if (input.action.type === 'items' || input.action.type === 'replacement') {
      const writable=await ctx.db.rpc('workspace_billing_write_allowed',{ p_workspace:ctx.workspaceId })
      if (writable.error) throw new CaseOrderError('orderUnavailable')
      if (writable.data!==true) throw new CaseOrderError('orderReadOnly')
      if (input.action.type === 'replacement') {
        const prepared=await prepareReplacementDraft(snapshot.admin,snapshot.live,input.action.items,input.id,input.action.reason)
        if (!prepared.ok) throw new CaseOrderError(prepared.error)
        snapshot.preview.replacement=prepared.quote
      } else {
      const prepared=await prepareReviewedOrderItems(snapshot.admin,snapshot.local.shopify_order_id,input.action.items)
      if (!prepared.ok) throw new CaseOrderError(prepared.error)
      snapshot.preview.item_change=prepared.quote
      }
    }
    const saved = await ctx.db.rpc('save_inbox_order_preview',{ p_id:input.id,p_workspace_id:ctx.workspaceId,p_conversation_id:ctx.conversation.id,
      p_order_id:input.order_id,p_actor_id:ctx.userId,p_action:input.action,p_preview:snapshot.preview,p_fingerprint:snapshot.fingerprint })
    if (saved.error) return serverError(saved.error,ctx.t('orderConflict'))
    return NextResponse.json({ operation:saved.data,can_execute:ctx.isAdmin })
  } catch (error) {
    return NextResponse.json({ error:ctx.t(error instanceof CaseOrderError ? error.message : 'orderUnavailable') },{ status:409 })
  }
}
