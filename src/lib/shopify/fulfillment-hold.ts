import 'server-only'
import { createHash } from 'node:crypto'
import { ShopifyAdminClient } from './admin-client'
import type { ShopifyAdmin } from './order-tags'
export const FULFILLMENT_HOLD_SCOPES=['write_merchant_managed_fulfillment_orders','write_third_party_fulfillment_orders']
export interface FulfillmentHoldState { id:string; handle:string | null; reason:string; reason_notes:string | null; ours:boolean }
export interface HoldPreparation { id:string; location:string; status:string; request_status:string; updated_at:string; can_hold:boolean;
  holds:FulfillmentHoldState[]; items:{ title:string; variant_title:string; quantity:number }[] }
export interface FulfillmentHoldQuote { fingerprint:string; preparations:HoldPreparation[] }
interface ProviderPreparation { id:string; order:{ id:string }; assignedLocation:{ name:string }; status:string; requestStatus:string; updatedAt:string;
  supportedActions:{ action:string }[]; fulfillmentHolds:{ id:string; handle:string | null; reason:string; reasonNotes:string | null; heldByRequestingApp:boolean }[];
  lineItems:{ pageInfo:{ hasNextPage:boolean }; nodes:{ remainingQuantity:number; lineItem:{ title:string; variantTitle:string | null } }[] } }
interface ProviderOrder { id:string; cancelledAt:string | null; displayFulfillmentStatus:string; tags:string[];
  fulfillmentOrders:{ pageInfo:{ hasNextPage:boolean }; nodes:ProviderPreparation[] } }
const PREPARATION='id order{id} assignedLocation{name} status requestStatus updatedAt supportedActions{action} fulfillmentHolds{id handle reason reasonNotes heldByRequestingApp} lineItems(first:100){pageInfo{hasNextPage} nodes{remainingQuantity lineItem{title variantTitle}}}'
function client(admin:ShopifyAdmin) { return new ShopifyAdminClient(admin.shopDomain,admin.accessToken,admin.apiVersion,30000) }
function orderGid(id:string):string | null { return /^\d{1,20}$/.test(id) ? `gid://shopify/Order/${id}` : null }
export function fulfillmentHoldHandle(operationId:string):string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId)) throw Error('Invalid hold operation')
  return `riverz_${operationId.toLowerCase()}`
}
function preparation(raw:ProviderPreparation,orderId:string):HoldPreparation | null {
  if (!raw || !/^gid:\/\/shopify\/FulfillmentOrder\/\d{1,20}$/.test(raw.id) || raw.order?.id!==orderId || typeof raw.assignedLocation?.name!=='string' ||
    typeof raw.status!=='string' || typeof raw.requestStatus!=='string' || typeof raw.updatedAt!=='string' || !Array.isArray(raw.supportedActions) ||
    !Array.isArray(raw.fulfillmentHolds) || raw.lineItems?.pageInfo?.hasNextPage!==false || !Array.isArray(raw.lineItems.nodes)) return null
  const items:HoldPreparation['items']=[]
  for (const item of raw.lineItems.nodes) {
    if (!Number.isSafeInteger(item.remainingQuantity) || item.remainingQuantity<0 || typeof item.lineItem?.title!=='string') return null
    if (item.remainingQuantity) items.push({ title:item.lineItem.title,variant_title:item.lineItem.variantTitle ?? '',quantity:item.remainingQuantity })
  }
  const holds:FulfillmentHoldState[]=[]
  for (const hold of raw.fulfillmentHolds) {
    if (!/^gid:\/\/shopify\/FulfillmentHold\/\d{1,20}$/.test(hold.id) || typeof hold.reason!=='string' || typeof hold.heldByRequestingApp!=='boolean' ||
      hold.handle!==null && typeof hold.handle!=='string' || hold.reasonNotes!==null && typeof hold.reasonNotes!=='string') return null
    holds.push({ id:hold.id,handle:hold.handle,reason:hold.reason,reason_notes:hold.reasonNotes,ours:hold.heldByRequestingApp })
  }
  return { id:raw.id,location:raw.assignedLocation.name,status:raw.status,request_status:raw.requestStatus,updated_at:raw.updatedAt,
    can_hold:raw.supportedActions.some(action => action.action==='HOLD'),holds,items }
}
export async function prepareFulfillmentHold(admin:ShopifyAdmin,orderId:string) {
  const id=orderGid(orderId)
  if (!id) return { ok:false as const,error:'orderHoldUnavailable' }
  try {
    const { order }=await client(admin).graphql<{ order?:ProviderOrder | null }>(`query ReviewedHold($id:ID!){order(id:$id){id cancelledAt displayFulfillmentStatus tags fulfillmentOrders(first:11){pageInfo{hasNextPage} nodes{${PREPARATION}}}}}`,{ id })
    if (!order || order.id!==id || order.cancelledAt!==null || !['UNFULFILLED','ON_HOLD','SCHEDULED'].includes(order.displayFulfillmentStatus) ||
      !Array.isArray(order.tags) || order.tags.some(tag => /order\s+sent\s+to\s+dropi/i.test(tag)) || order.fulfillmentOrders?.pageInfo?.hasNextPage!==false ||
      !Array.isArray(order.fulfillmentOrders.nodes) || order.fulfillmentOrders.nodes.length>10) return { ok:false as const,error:'orderHoldUnavailable' }
    const visible:HoldPreparation[]=[]
    for (const node of order.fulfillmentOrders.nodes) {
      const item=preparation(node,id)
      if (!item) return { ok:false as const,error:'orderHoldUnavailable' }
      if (!['CLOSED','CANCELLED'].includes(item.status)) visible.push(item)
    }
    if (!visible.length || new Set(visible.map(item => item.id)).size!==visible.length || visible.some(item => !['OPEN','ON_HOLD','SCHEDULED'].includes(item.status) ||
      !item.can_hold || !item.items.length || item.holds.filter(hold => hold.ours).length>=10)) return { ok:false as const,error:'orderHoldUnavailable' }
    const quote:FulfillmentHoldQuote={ fingerprint:createHash('sha256').update(JSON.stringify(order)).digest('hex'),preparations:visible }
    return { ok:true as const,quote }
  } catch { return { ok:false as const,error:'orderHoldUnavailable' } }
}
/** Reads the exact reviewed preparations, including closed or changed outcomes; never applies another hold. */
export async function inspectFulfillmentHold(admin:ShopifyAdmin,orderId:string,quote:FulfillmentHoldQuote):Promise<HoldPreparation[] | null> {
  const id=orderGid(orderId), ids=quote?.preparations?.map(item => item.id)
  if (!id || !Array.isArray(ids) || !ids.length || ids.length>10 || new Set(ids).size!==ids.length || ids.some(value => !/^gid:\/\/shopify\/FulfillmentOrder\/\d{1,20}$/.test(value))) return null
  const { nodes }=await client(admin).graphql<{ nodes:(ProviderPreparation | null)[] }>(`query ObservedHold($ids:[ID!]!){nodes(ids:$ids){... on FulfillmentOrder{${PREPARATION}}}}`,{ ids })
  if (!Array.isArray(nodes) || nodes.length!==ids.length) return null
  const result:HoldPreparation[]=[]
  for (let i=0;i<nodes.length;i++) {
    if (!nodes[i] || nodes[i]!.id!==ids[i]) return null
    const item=preparation(nodes[i]!,id)
    if (!item) return null
    result.push(item)
  }
  return result
}
/** Never rolls back or retries a partially applied batch: its receipts require a fresh human review. */
export async function applyReviewedFulfillmentHold(admin:ShopifyAdmin,orderId:string,quote:FulfillmentHoldQuote,operationId:string,reason:string) {
  const current=await prepareFulfillmentHold(admin,orderId)
  if (!current.ok || current.quote.fingerprint!==quote.fingerprint ||
    JSON.stringify(current.quote.preparations.map(item => item.id))!==JSON.stringify(quote.preparations?.map(item => item.id))) return { ok:false as const,error:current.ok ? 'orderChanged' : current.error }
  const handle=fulfillmentHoldHandle(operationId), receipts:{ preparation_id:string; hold_id:string }[]=[]
  let attempted=false
  try {
    for (const item of current.quote.preparations) {
      attempted=true
      const data=await client(admin).graphql<{ fulfillmentOrderHold?:{ fulfillmentHold?:{ id:string; handle:string | null; heldByRequestingApp:boolean } | null;
        fulfillmentOrder?:{ id:string } | null; userErrors:{ message:string }[] } }>(
        'mutation ApplyReviewedHold($id:ID!,$hold:FulfillmentOrderHoldInput!){fulfillmentOrderHold(id:$id,fulfillmentHold:$hold){fulfillmentHold{id handle heldByRequestingApp} fulfillmentOrder{id} userErrors{field message}}}',
        { id:item.id,hold:{ handle,reason:'OTHER',reasonNotes:reason,notifyMerchant:false } })
      const result=data.fulfillmentOrderHold, hold=result?.fulfillmentHold
      if (result?.userErrors?.length && !hold && !receipts.length) return { ok:false as const,error:'orderHoldRejected' }
      if (!result || result.userErrors?.length || !hold || !/^gid:\/\/shopify\/FulfillmentHold\/\d{1,20}$/.test(hold.id) || hold.handle!==handle || hold.heldByRequestingApp!==true || result.fulfillmentOrder?.id!==item.id) return { ok:false as const,error:'orderResultUnverified',uncertain:true,receipts }
      receipts.push({ preparation_id:item.id,hold_id:hold.id })
    }
    const actual=await inspectFulfillmentHold(admin,orderId,current.quote)
    if (!actual || actual.some(item => item.status!=='ON_HOLD' || !item.holds.some(hold => hold.handle===handle && hold.ours && hold.reason==='OTHER' && hold.reason_notes===reason &&
      receipts.some(receipt => receipt.preparation_id===item.id && receipt.hold_id===hold.id)))) return { ok:false as const,error:'orderResultUnverified',uncertain:true,receipts }
    return { ok:true as const,preparations:actual,receipts,handle }
  } catch { return { ok:false as const,error:attempted ? 'orderResultUnverified' : 'orderHoldUnavailable',...(attempted ? { uncertain:true,receipts } : {}) } }
}
