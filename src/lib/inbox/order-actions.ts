import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveShopifyAdmin } from '@/lib/shopify/order-tags'
import { normPhone } from '@/lib/attribution/shopify'
import { ShopifyAdminClient } from '@/lib/shopify/admin-client'
import { cancelOrder, refundOrder } from '@/lib/shopify/order-cancel'
import { planRefund, refundMoney, type RefundTransaction } from '@/lib/shopify/refund-plan'
import type { CaseOrderAction, CaseOrderOperation } from './order-action-contract'

interface LocalOrder { id: string; shopify_order_id: string; shop_domain: string; order_number: string | null; platform:string }
interface ProviderOrder {
  id: number | string; name: string; updated_at: string; currency: string; financial_status: string;
  fulfillment_status: string | null; cancelled_at: string | null;
  fulfillments?: { id: number; status: string }[]; total_price: string; email?:string | null; phone?:string | null;
  customer?: { id: number; email?:string | null; phone?:string | null } | null
  contact_email?:string | null; shipping_address?: { phone?:string | null } | null; billing_address?: { phone?:string | null } | null
}
export class CaseOrderError extends Error {}
export async function caseOrderSnapshot(db: SupabaseClient, workspaceId: string, contactId: string, orderId: string, action: CaseOrderAction | null) {
  const local = await db.from('orders').select('id,shopify_order_id,shop_domain,order_number,platform').eq('id',orderId).eq('workspace_id',workspaceId).eq('contact_id',contactId).maybeSingle()
  if (local.error) throw new CaseOrderError('orderUnavailable')
  const order = local.data as LocalOrder | null
  if (!order || order.platform !== 'shopify' || !/^\d+$/.test(String(order.shopify_order_id ?? ''))) throw new CaseOrderError('orderNotFound')
  const admin = await resolveShopifyAdmin(db,workspaceId)
  if (!admin || order.shop_domain?.toLowerCase() !== admin.shopDomain.toLowerCase()) throw new CaseOrderError('orderStoreChanged')
  const client = new ShopifyAdminClient(admin.shopDomain,admin.accessToken,admin.apiVersion,30000)
  const [{ order: live },{ currentAppInstallation }] = await Promise.all([
    client.rest<{ order?: ProviderOrder }>(`/orders/${order.shopify_order_id}.json`),
    client.graphql<{ currentAppInstallation: { accessScopes: { handle: string }[] } }>('query{currentAppInstallation{accessScopes{handle}}}'),
  ])
  if (!live || String(live.id) !== String(order.shopify_order_id) || !/^[A-Z]{3}$/.test(live.currency ?? '')) throw new CaseOrderError('orderUnavailable')
  const contact = await db.from('contacts').select('email,phone').eq('id',contactId).eq('workspace_id',workspaceId).maybeSingle()
  const email = contact.data?.email?.trim().toLowerCase(), phone = normPhone(contact.data?.phone)
  const emailMatches = !!email && [live.email,live.contact_email,live.customer?.email].some(value => value?.trim().toLowerCase() === email)
  const phoneMatches = !!phone && [live.phone,live.customer?.phone,live.shipping_address?.phone,live.billing_address?.phone].some(value => normPhone(value) === phone)
  if (contact.error || !contact.data || !emailMatches && !phoneMatches) throw new CaseOrderError('orderIdentityUnknown')
  if (!currentAppInstallation?.accessScopes.some(scope => scope.handle === 'write_orders')) throw new CaseOrderError('orderScopeMissing')
  if (action?.type === 'cancel' && (live.cancelled_at || live.fulfillment_status || live.fulfillments?.some(f => !['cancelled','failure'].includes(f.status)))) throw new CaseOrderError('orderAlreadyShipped')
  const { transactions } = await client.rest<{ transactions?: RefundTransaction[] }>(`/orders/${order.shopify_order_id}/transactions.json`)
  if (!Array.isArray(transactions)) throw new CaseOrderError('orderBalanceUnknown')
  const plan = planRefund(transactions, action?.type === 'refund' ? action.amount ?? undefined : undefined)
  if (!plan.ok && (action?.type === 'refund' || !['sin_cobro_registrado','refund_already_returned'].includes(plan.error))) {
    throw new CaseOrderError(plan.error === 'refund_pending' ? 'orderRefundPending' : plan.error === 'monto_mayor_al_cobrado' ? 'orderAmountTooHigh' : 'orderBalanceUnknown')
  }
  const preview: CaseOrderOperation['preview'] = { order_name: live.name || order.order_number || String(live.id), amount: plan.ok ? plan.amount : null,
    currency: live.currency, financial_status: live.financial_status, fulfillment_status: live.fulfillment_status }
  if (plan.ok && refundMoney(Number(plan.amount)) !== refundMoney(plan.amount)) throw new CaseOrderError('orderBalanceUnknown')
  // Preserve chronological provider history and live order state, including customer and shipping changes.
  const fingerprint = createHash('sha256').update(JSON.stringify({ shop: admin.shopDomain, order: live, transactions })).digest('hex')
  return { admin, local: order, live, preview, fingerprint, client }
}

export async function executeCaseOrderAction(db: SupabaseClient, workspaceId: string, conversationId: string, contactId: string, actorId: string, id: string) {
  const claimed = await db.rpc('claim_inbox_order_action',{ p_id:id,p_workspace_id:workspaceId,p_conversation_id:conversationId,p_actor_id:actorId })
  if (claimed.error) throw new CaseOrderError(claimed.error.message.includes('order_action_busy') ? 'orderBusy' : claimed.error.message.includes('order_approval_forbidden') ? 'orderApprovalForbidden' : 'orderConflict')
  const claim = claimed.data as { claimed: boolean; operation: CaseOrderOperation }
  if (!claim.claimed) return claim.operation
  const operation = claim.operation
  let mutationStarted = false
  let status: 'completed' | 'failed' | 'uncertain' = 'failed'
  let result: Record<string, unknown>
  try {
    const current = await caseOrderSnapshot(db,workspaceId,contactId,operation.order_id,operation.action)
    if (current.fingerprint !== operation.fingerprint) throw new CaseOrderError('orderChanged')
    // The reviewed amount is immutable, including a request for the whole remaining balance.
    mutationStarted = true
    const response = operation.action.type === 'refund'
      ? await refundOrder(current.admin,current.local.shopify_order_id,{ amount: Number(operation.preview.amount),reason:operation.action.reason })
      : await cancelOrder(current.admin,current.local.shopify_order_id,{ reason:operation.action.reason,refund:false })
    if (!response.ok) {
      status = response.uncertain ? 'uncertain' : 'failed'
      result = { error: response.uncertain ? 'orderResultUnverified' : 'orderBalanceUnknown', refund_id: response.refundId ?? null }
    } else if (operation.action.type === 'refund') {
      status = response.refundId && response.currency === operation.preview.currency && refundMoney(response.refundedAmount) === refundMoney(operation.preview.amount) ? 'completed' : 'uncertain'
      result = { refunded_amount:response.refundedAmount,currency:response.currency,refund_id:response.refundId,financial_status:response.financialStatus }
      if (status === 'uncertain') result.error = 'orderResultUnverified'
      else {
        const mirror = await db.from('orders').update({ financial_status:response.financialStatus }).eq('id',operation.order_id).eq('workspace_id',workspaceId).eq('contact_id',contactId)
        if (mirror.error) result.mirror_pending = true
      }
    } else {
      const { order } = await current.client.rest<{ order?: ProviderOrder }>(`/orders/${current.local.shopify_order_id}.json`)
      if (!order?.cancelled_at) throw new CaseOrderError('orderResultUnverified')
      // Cancellation and the refund are separate facts, both recorded explicitly.
      const refunded = operation.preview.amount ? await refundOrder(current.admin,current.local.shopify_order_id,{ amount:Number(operation.preview.amount),reason:operation.action.reason }) : null
      status = refunded && (!refunded.ok || !refunded.refundId || refunded.currency !== operation.preview.currency || refundMoney(refunded.refundedAmount) !== refundMoney(operation.preview.amount)) ? 'uncertain' : 'completed'
      result = { cancelled:true,refunded_amount:refunded?.refundedAmount ?? null,refund_id:refunded?.refundId ?? null,
        currency:order.currency,financial_status:refunded?.financialStatus ?? order.financial_status,
        ...(status === 'uncertain' ? { error:'orderResultUnverified' } : {}) }
      const mirror = await db.from('orders').update({ status:'cancelled',financial_status:result.financial_status }).eq('id',operation.order_id).eq('workspace_id',workspaceId).eq('contact_id',contactId)
      if (mirror.error) result.mirror_pending = true
    }
  } catch (error) {
    status = mutationStarted ? 'uncertain' : 'failed'
    result = { error: error instanceof CaseOrderError && !mutationStarted ? error.message : mutationStarted ? 'orderResultUnverified' : 'orderUnavailable' }
  }
  const finished = await db.rpc('finish_inbox_order_action',{ p_id:id,p_workspace_id:workspaceId,p_status:status,p_result:result })
  if (finished.error) throw new CaseOrderError('orderResultUnverified')
  return finished.data as CaseOrderOperation
}
