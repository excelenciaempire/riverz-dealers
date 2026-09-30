import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveShopifyAdmin } from '@/lib/shopify/order-tags'
import { normPhone } from '@/lib/attribution/shopify'
import { ShopifyAdminClient } from '@/lib/shopify/admin-client'
import { cancelOrder, refundOrder } from '@/lib/shopify/order-cancel'
import { planRefund, refundMoney, type RefundTransaction } from '@/lib/shopify/refund-plan'
import { validateWorkspaceShippingAddress } from '@/lib/addresses/google-validation'
import { updateOrderShippingAddress } from '@/lib/shopify/order-shipping-address'
import { providerShippingAddress, shippingAddress, shippingChangeAllowed, sameShippingAddress, type ProviderShippingAddress } from '@/lib/shopify/shipping-address-contract'
import { commitReviewedOrderItems } from '@/lib/shopify/reviewed-order-items'
import type { OrderItemDisplay } from '@/lib/shopify/order-items-contract'
import { createReplacementDraft,inspectReplacementDraft } from '@/lib/shopify/replacement-draft'
import { caseOrderAction, type CaseOrderAction, type CaseOrderOperation } from './order-action-contract'

interface LocalOrder { id: string; shopify_order_id: string; shop_domain: string; order_number: string | null; platform:string }
interface ProviderOrder {
  id: number | string; name: string; updated_at: string; currency: string; financial_status: string;
  fulfillment_status: string | null; cancelled_at: string | null;
  fulfillments?: { id: number; status: string }[]; total_price: string; email?:string | null; phone?:string | null;
  customer?: { id: number | string; email?:string | null; phone?:string | null } | null
  contact_email?:string | null; shipping_address?: ProviderShippingAddress | null; billing_address?: { phone?:string | null } | null
  line_items?:{ variant_id:number | string | null; title:string; variant_title:string | null; current_quantity:number; price:string; total_discount:string }[]
  current_total_price?:string
  tags?:string
}
export class CaseOrderError extends Error {}
export async function caseOrderSnapshot(db: SupabaseClient, workspaceId: string, contactId: string, orderId: string, action: CaseOrderAction | null, options?:{ shippingOnly?:boolean; replacement?:boolean }) {
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
  const replacement=action?.type === 'replacement' || options?.replacement === true
  const emailMatches = !!email && (replacement ? [live.customer?.email] : [live.email,live.contact_email,live.customer?.email]).some(value => value?.trim().toLowerCase() === email)
  const phoneMatches = !!phone && (replacement ? [live.customer?.phone] : [live.phone,live.customer?.phone,live.shipping_address?.phone,live.billing_address?.phone]).some(value => normPhone(value) === phone)
  if (contact.error || !contact.data || !emailMatches && !phoneMatches) throw new CaseOrderError('orderIdentityUnknown')
  if (!currentAppInstallation?.accessScopes.some(scope => scope.handle === (replacement ? 'write_draft_orders' : 'write_orders'))) throw new CaseOrderError(replacement ? 'orderDraftScopeMissing' : 'orderScopeMissing')
  if (action?.type === 'items' && !currentAppInstallation.accessScopes.some(scope => scope.handle === 'write_order_edits')) throw new CaseOrderError('orderItemsScopeMissing')
  if ((action?.type === 'cancel' || action?.type === 'address' || action?.type === 'items') && !shippingChangeAllowed(live)) throw new CaseOrderError('orderAlreadyShipped')
  const shippingOnly = action?.type === 'address' || options?.shippingOnly === true || replacement
  const { transactions } = shippingOnly || action?.type === 'items' ? { transactions:[] as RefundTransaction[] } : await client.rest<{ transactions?: RefundTransaction[] }>(`/orders/${order.shopify_order_id}/transactions.json`)
  if (!Array.isArray(transactions)) throw new CaseOrderError('orderBalanceUnknown')
  const plan = planRefund(transactions, action?.type === 'refund' ? action.amount ?? undefined : undefined)
  if (!plan.ok && (action?.type === 'refund' || !['sin_cobro_registrado','refund_already_returned'].includes(plan.error))) {
    throw new CaseOrderError(plan.error === 'refund_pending' ? 'orderRefundPending' : plan.error === 'monto_mayor_al_cobrado' ? 'orderAmountTooHigh' : 'orderBalanceUnknown')
  }
  const preview: CaseOrderOperation['preview'] = { order_name: live.name || order.order_number || String(live.id), amount: plan.ok ? plan.amount : null,
    currency: live.currency, financial_status: live.financial_status, fulfillment_status: live.fulfillment_status }
  if (shippingOnly) preview.shipping_address = providerShippingAddress(live.shipping_address)
  if (action?.type === 'address') {
    if (!preview.shipping_address) throw new CaseOrderError('orderAddressUnavailable')
    const validation = await validateWorkspaceShippingAddress(workspaceId,{ ...action.address,country:action.address.countryCode },db)
    if (validation.status === 'unavailable') throw new CaseOrderError('orderAddressValidationUnavailable')
    if (validation.status === 'fix') throw new CaseOrderError('orderAddressInvalid')
    const after = shippingAddress({ address1:validation.address.address1 ?? '',address2:validation.address.address2 ?? '',city:validation.address.city ?? '',
      province:validation.address.province ?? '',zip:validation.address.zip ?? '',countryCode:action.address.countryCode })
    if (!after) throw new CaseOrderError('orderAddressInvalid')
    if (sameShippingAddress(preview.shipping_address,after)) throw new CaseOrderError('orderAddressUnchanged')
    preview.shipping_change = { before:preview.shipping_address,after,validation:validation.status }
  }
  if (plan.ok && refundMoney(Number(plan.amount)) !== refundMoney(plan.amount)) throw new CaseOrderError('orderBalanceUnknown')
  // Preserve chronological provider history and live order state, including customer and shipping changes.
  const fingerprint = createHash('sha256').update(JSON.stringify({ shop: admin.shopDomain, order: live, transactions,
    ...(preview.shipping_change ? { shipping_change:preview.shipping_change } : {}) })).digest('hex')
  return { admin, local: order, live, preview, fingerprint, client,scopes:currentAppInstallation.accessScopes.map(scope => scope.handle) }
}

export function caseOrderCurrentItems(live:ProviderOrder):OrderItemDisplay[] {
  if (!Array.isArray(live.line_items) || !live.line_items.length || live.line_items.some(line => !Number.isInteger(line.current_quantity) || line.current_quantity<0)) throw new CaseOrderError('orderItemsUnavailable')
  const items:OrderItemDisplay[]=[]
  for (const line of live.line_items) {
    if (!line.current_quantity) continue
    const variantId=String(line.variant_id ?? ''), price=refundMoney(line.price), discount=refundMoney(line.total_discount)
    if (!/^\d{1,20}$/.test(variantId) || price===null || discount===null) throw new CaseOrderError('orderItemsUnavailable')
    items.push({ variantId,quantity:line.current_quantity,free:price===BigInt(0) || discount===price*BigInt(line.current_quantity),title:line.title,variantTitle:line.variant_title ?? '' })
  }
  if (!items.length || items.length>20 || items.some(item => item.quantity>20)) throw new CaseOrderError('orderItemsUnavailable')
  return items
}

/** A review inspects the actual kind of operation, never just a financial balance for an address change. */
export async function uncertainCaseOrderSnapshot(db:SupabaseClient,workspaceId:string,contactId:string,orderId:string) {
  const lock = await db.from('order_execution_locks').select('source_id,source_kind,status').eq('workspace_id',workspaceId).eq('order_id',orderId).maybeSingle()
  if (lock.error || !lock.data || lock.data.status !== 'uncertain') throw new CaseOrderError('orderBusy')
  let shippingOnly = false
  let itemsOnly = false
  let replacementOnly=false, draftId:string | undefined
  if (lock.data.source_kind === 'inbox') {
    const stored = await db.from('inbox_order_actions').select('action,result').eq('id',lock.data.source_id).eq('workspace_id',workspaceId).eq('order_id',orderId).maybeSingle()
    const action = caseOrderAction(stored.data?.action)
    if (stored.error || !action) throw new CaseOrderError('orderConflict')
    shippingOnly = action.type === 'address'
    itemsOnly = action.type === 'items'
    replacementOnly=action.type === 'replacement'
    draftId=typeof stored.data?.result?.draft_id === 'string' ? stored.data.result.draft_id : undefined
  }
  const snapshot = await caseOrderSnapshot(db,workspaceId,contactId,orderId,null,{ shippingOnly:shippingOnly || itemsOnly || replacementOnly,...(replacementOnly ? { replacement:true } : {}) })
  if (replacementOnly) {
    const draft=await inspectReplacementDraft(snapshot.admin,snapshot.live,lock.data.source_id,draftId)
    if (!draft) throw new CaseOrderError('orderDraftReviewRequired')
    delete snapshot.preview.shipping_address
    snapshot.preview.draft_current=draft
    // Bind reconciliation to the observed draft, not just its source order.
    snapshot.fingerprint=createHash('sha256').update(JSON.stringify({ order:snapshot.fingerprint,draft })).digest('hex')
  }
  if (itemsOnly) {
    const total=snapshot.live.current_total_price
    if (!total || refundMoney(total)===null || refundMoney(Number(total))!==refundMoney(total)) throw new CaseOrderError('orderItemsUnavailable')
    delete snapshot.preview.shipping_address
    snapshot.preview.item_current={ items:caseOrderCurrentItems(snapshot.live),total,currency:snapshot.live.currency }
  }
  if (shippingOnly && !snapshot.preview.shipping_address) throw new CaseOrderError('orderAddressUnavailable')
  return { source_id:lock.data.source_id,snapshot }
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
    if (operation.action.type === 'address') {
      const change = operation.preview.shipping_change
      if (!change || JSON.stringify(current.preview.shipping_change) !== JSON.stringify(change)) throw new CaseOrderError('orderChanged')
      mutationStarted = true
      const response = await updateOrderShippingAddress(current.admin,current.local.shopify_order_id,change.after,current.live)
      status = response.ok ? 'completed' : response.uncertain ? 'uncertain' : 'failed'
      result = response.ok ? { shipping_before:response.before,shipping_after:response.after,currency:current.live.currency } : { error:response.error }
    } else if (operation.action.type === 'items') {
      if (!operation.preview.item_change) throw new CaseOrderError('orderConflict')
      mutationStarted = true
      const response = await commitReviewedOrderItems(current.admin,current.local.shopify_order_id,operation.action.items,operation.preview.item_change,operation.action.reason)
      status = response.ok ? 'completed' : response.uncertain ? 'uncertain' : 'failed'
      result = response.ok ? { items:response.items,total:response.total,price_difference:operation.preview.item_change.difference } : { error:response.error }
    } else if (operation.action.type === 'replacement') {
      if (!operation.preview.replacement) throw new CaseOrderError('orderConflict')
      mutationStarted=true
      const response=await createReplacementDraft(current.admin,current.live,operation.action.items,operation.preview.replacement,operation.id,operation.action.reason)
      status=response.ok ? 'completed' : response.uncertain ? 'uncertain' : 'failed'
      result=response.ok ? { draft_id:response.draft.id,draft:response.draft } : { error:response.error,draft_id:response.draftId ?? null }
    } else {
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
    }
  } catch (error) {
    status = mutationStarted ? 'uncertain' : 'failed'
    result = { error: error instanceof CaseOrderError && !mutationStarted ? error.message : mutationStarted ? 'orderResultUnverified' : 'orderUnavailable' }
  }
  const finished = await db.rpc('finish_inbox_order_action',{ p_id:id,p_workspace_id:workspaceId,p_status:status,p_result:result })
  if (finished.error) throw new CaseOrderError('orderResultUnverified')
  return finished.data as CaseOrderOperation
}
