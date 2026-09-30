import 'server-only'
import { createHash } from 'node:crypto'
import { ShopifyAdminClient } from './admin-client'
import type { ShopifyAdmin } from './order-tags'
import { stageUnfulfilledOrderItems,commitStagedOrderItems } from './order-edit'
import { orderItems,orderPriceDifference,type ReviewedOrderItem,type OrderItemDisplay } from './order-items-contract'
import { refundMoney } from './refund-plan'

export interface OrderItemsQuote {
  calculated_id:string; fingerprint:string; before:OrderItemDisplay[]; after:OrderItemDisplay[];
  total_before:string; total_after:string; difference:string; currency:string
}
interface Money { amount:string; currencyCode:string }
interface Line { id:string; quantity:number; title:string; variantTitle:string | null; variant:{ id:string } | null; hasStagedLineItemDiscount:boolean; discountedUnitPriceSet:{ presentmentMoney:Money } }
interface Connection<T> { pageInfo:{ hasNextPage:boolean }; nodes:T[] }
interface Calculated {
  id:string; originalOrder:{ id:string; cancelledAt:string | null; displayFulfillmentStatus:string; tags:string[]; currentTotalPriceSet:{ presentmentMoney:Money }; lineItems:Connection<{ title:string; variantTitle:string | null; currentQuantity:number; unfulfilledQuantity:number; variant:{ id:string } | null }> };
  totalPriceSet:{ presentmentMoney:Money }; lineItems:Connection<Line>; addedLineItems:Connection<Line>
}
const LINE = 'id quantity title variantTitle variant{id} hasStagedLineItemDiscount discountedUnitPriceSet{presentmentMoney{amount currencyCode}}'
const QUOTE_QUERY = `query ReviewedEdit($id:ID!){node(id:$id){...on CalculatedOrder{id originalOrder{id cancelledAt displayFulfillmentStatus tags currentTotalPriceSet{presentmentMoney{amount currencyCode}} lineItems(first:100){pageInfo{hasNextPage} nodes{title variantTitle currentQuantity unfulfilledQuantity variant{id}}}} totalPriceSet{presentmentMoney{amount currencyCode}} lineItems(first:100){pageInfo{hasNextPage} nodes{${LINE}}} addedLineItems(first:100){pageInfo{hasNextPage} nodes{${LINE}}}}}}`
function client(admin:ShopifyAdmin) { return new ShopifyAdminClient(admin.shopDomain,admin.accessToken,admin.apiVersion,30000) }
function numericVariant(gid:string | undefined) { return typeof gid === 'string' && /^gid:\/\/shopify\/ProductVariant\/\d{1,20}$/.test(gid) ? gid.split('/').pop()! : null }
function validMoney(money:Money | undefined,currency:string):money is Money {
  return !!money && typeof money.amount === 'string' && money.currencyCode === currency && refundMoney(money.amount)!==null && refundMoney(Number(money.amount))===refundMoney(money.amount)
}
async function readQuote(admin:ShopifyAdmin,orderId:string,id:string,requested:ReviewedOrderItem[]):Promise<OrderItemsQuote | null> {
  const { node }=await client(admin).graphql<{ node?:Calculated | null }>(QUOTE_QUERY,{ id })
  const currency=node?.totalPriceSet?.presentmentMoney?.currencyCode
  if (!node || node.id!==id || node.originalOrder?.id!==`gid://shopify/Order/${orderId}` || !/^[A-Z]{3}$/.test(currency ?? '') ||
    node.originalOrder.cancelledAt!==null || !['UNFULFILLED','ON_HOLD','SCHEDULED'].includes(node.originalOrder.displayFulfillmentStatus) ||
    !Array.isArray(node.originalOrder.tags) || node.originalOrder.tags.some(tag => /order\s+sent\s+to\s+dropi/i.test(tag)) ||
    !validMoney(node.totalPriceSet?.presentmentMoney,currency!) || !validMoney(node.originalOrder.currentTotalPriceSet?.presentmentMoney,currency!) ||
    !Array.isArray(node.lineItems?.nodes) || node.lineItems.pageInfo?.hasNextPage!==false ||
    !Array.isArray(node.addedLineItems?.nodes) || node.addedLineItems.pageInfo?.hasNextPage!==false ||
    !Array.isArray(node.originalOrder.lineItems?.nodes) || node.originalOrder.lineItems.pageInfo?.hasNextPage!==false) return null
  const after:OrderItemDisplay[]=[], before:OrderItemDisplay[]=[]
  const ids=new Set<string>()
  for (const line of [...node.lineItems.nodes,...node.addedLineItems.nodes]) {
    if (!line.id || ids.has(line.id) || !Number.isInteger(line.quantity) || line.quantity<0 || typeof line.title!=='string' || typeof line.hasStagedLineItemDiscount!=='boolean') return null
    ids.add(line.id)
    if (!line.quantity) continue
    const variantId=numericVariant(line.variant?.id)
    if (!variantId || !validMoney(line.discountedUnitPriceSet?.presentmentMoney,currency!)) return null
    after.push({ variantId,quantity:line.quantity,free:line.hasStagedLineItemDiscount === true && refundMoney(line.discountedUnitPriceSet.presentmentMoney.amount)===BigInt(0),title:line.title,variantTitle:line.variantTitle ?? '' })
  }
  const normalized=orderItems(after.map(({ variantId,quantity,free }) => ({ variantId,quantity,free })))
  if (!normalized || JSON.stringify(normalized)!==JSON.stringify(orderItems(requested))) return null
  for (const line of node.originalOrder.lineItems.nodes) {
    if (!Number.isInteger(line.currentQuantity) || line.currentQuantity<0 || !Number.isInteger(line.unfulfilledQuantity) || line.unfulfilledQuantity<line.currentQuantity) return null
    if (!line.currentQuantity) continue
    const variantId=numericVariant(line.variant?.id)
    if (!variantId) return null
    before.push({ variantId,quantity:line.currentQuantity,free:false,title:line.title,variantTitle:line.variantTitle ?? '' })
  }
  const total_before=node.originalOrder.currentTotalPriceSet.presentmentMoney.amount, total_after=node.totalPriceSet.presentmentMoney.amount
  const difference=orderPriceDifference(total_after,total_before)!
  if (refundMoney(Math.abs(Number(difference)))!==refundMoney(difference.replace(/^-/,''))) return null
  return { calculated_id:id,fingerprint:createHash('sha256').update(JSON.stringify(node)).digest('hex'),before,after,total_before,total_after,
    difference,currency:currency! }
}
export async function prepareReviewedOrderItems(admin:ShopifyAdmin,orderId:string,requested:ReviewedOrderItem[]) {
  const items=orderItems(requested)
  if (!items) return { ok:false as const,error:'orderItemsInvalid' }
  const staged=await stageUnfulfilledOrderItems(admin,orderId,items)
  if (!staged.ok) return { ok:false as const,error:staged.error === 'missing_scope' ? 'orderItemsScopeMissing' : 'orderItemsUnavailable' }
  try {
    const quote=await readQuote(admin,orderId,staged.id,items)
    return quote ? { ok:true as const,quote } : { ok:false as const,error:'orderItemsUnavailable' }
  } catch { return { ok:false as const,error:'orderItemsUnavailable' } }
}
export async function commitReviewedOrderItems(admin:ShopifyAdmin,orderId:string,requested:ReviewedOrderItem[],quote:OrderItemsQuote,reason:string) {
  const items=orderItems(requested)
  if (!items || !/^gid:\/\/shopify\/CalculatedOrder\/\d{1,20}$/.test(quote?.calculated_id ?? '')) return { ok:false as const,error:'orderItemsInvalid' }
  // Reading a staged edit is harmless. A changed quote never authorizes a fresh commit.
  try {
    const current=await readQuote(admin,orderId,quote.calculated_id,items)
    if (!current || current.fingerprint!==quote.fingerprint) return { ok:false as const,error:'orderChanged' }
  } catch { return { ok:false as const,error:'orderItemsUnavailable' } }
  const result=await commitStagedOrderItems(admin,orderId,{ ok:true,id:quote.calculated_id,items },reason)
  if (!result.ok) return { ok:false as const,error:result.uncertain ? 'orderResultUnverified' : 'orderItemsRejected',uncertain:result.uncertain }
  try {
    const { order }=await client(admin).graphql<{ order?:{ id:string; currentTotalPriceSet:{ presentmentMoney:Money }; lineItems:Connection<{ currentQuantity:number; variant:{ id:string } | null; discountedUnitPriceSet:{ presentmentMoney:Money } }> } }>(
      'query VerifiedEditedOrder($id:ID!){order(id:$id){id currentTotalPriceSet{presentmentMoney{amount currencyCode}} lineItems(first:100){pageInfo{hasNextPage} nodes{currentQuantity variant{id} discountedUnitPriceSet{presentmentMoney{amount currencyCode}}}}}}',{ id:`gid://shopify/Order/${orderId}` })
    if (!order || order.id!==`gid://shopify/Order/${orderId}` || !validMoney(order.currentTotalPriceSet?.presentmentMoney,quote.currency) ||
      refundMoney(order.currentTotalPriceSet.presentmentMoney.amount)!==refundMoney(quote.total_after) || order.lineItems?.pageInfo?.hasNextPage!==false || !Array.isArray(order.lineItems.nodes)) return { ok:false as const,error:'orderResultUnverified',uncertain:true }
    const freeQuantities=new Map<string,number>()
    const actualQuantities=new Map<string,number>(), expectedQuantities=new Map<string,number>()
    for (const item of items) expectedQuantities.set(item.variantId,(expectedQuantities.get(item.variantId) ?? 0)+item.quantity)
    for (const line of order.lineItems.nodes) {
      if (!Number.isInteger(line.currentQuantity) || line.currentQuantity<0) return { ok:false as const,error:'orderResultUnverified',uncertain:true }
      if (!line.currentQuantity) continue
      const variantId=numericVariant(line.variant?.id)
      if (!variantId || !validMoney(line.discountedUnitPriceSet?.presentmentMoney,quote.currency)) return { ok:false as const,error:'orderResultUnverified',uncertain:true }
      actualQuantities.set(variantId,(actualQuantities.get(variantId) ?? 0)+line.currentQuantity)
      if (refundMoney(line.discountedUnitPriceSet.presentmentMoney.amount)===BigInt(0)) freeQuantities.set(variantId,(freeQuantities.get(variantId) ?? 0)+line.currentQuantity)
    }
    if (actualQuantities.size!==expectedQuantities.size || [...expectedQuantities].some(([id,qty]) => actualQuantities.get(id)!==qty) ||
      items.filter(item => item.free).some(item => (freeQuantities.get(item.variantId) ?? 0)<item.quantity)) return { ok:false as const,error:'orderResultUnverified',uncertain:true }
    return { ok:true as const,items:result.verifiedItems,total:order.currentTotalPriceSet.presentmentMoney }
  } catch { return { ok:false as const,error:'orderResultUnverified',uncertain:true } }
}
