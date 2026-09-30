import 'server-only'
import { createHash } from 'node:crypto'
import type { ShopifyAdmin } from './order-tags'
import { ShopifyAdminClient } from './admin-client'
import { REPLACEMENT_DRAFT_TAG,replacementDraftTag } from './borradores'
import { orderItems,type ReviewedOrderItem,type OrderItemDisplay } from './order-items-contract'
import { providerShippingAddress,sameShippingAddress,type ProviderShippingAddress,type OrderShippingAddress } from './shipping-address-contract'
import { refundMoney } from './refund-plan'
export interface ReplacementSource { id:string | number; name:string; currency:string; customer?:{ id:string | number } | null; shipping_address?:ProviderShippingAddress | null }
export interface ReplacementQuote { fingerprint:string; customer_id:string; shipping_address:OrderShippingAddress; items:OrderItemDisplay[]; total:string; currency:string }
interface Money { amount:string; currencyCode:string }
interface DraftLine { title:string; variantTitle:string | null; variant:{ id:string } | null; product:{ title:string; status:string } | null; quantity:number; appliedDiscount:{ value:string | number; valueType:string } | null; discountedTotalSet:{ presentmentMoney:Money } }
export interface ReplacementDraftState { id:string; name:string; status:string; total:string; currency:string; items:OrderItemDisplay[]; invoice_sent_at:string | null; order_id:string | null;
  visible_to_customer:boolean; shipping_address:OrderShippingAddress | null; recipient:{ first_name:string; last_name:string; company:string; phone:string } }
interface ProviderDraft { id:string; name:string; status:string; tags:string[]; customer:{ id:string } | null; invoiceSentAt:string | null; visibleToCustomer:boolean; order:{ id:string } | null; totalPriceSet:{ presentmentMoney:Money };
  shippingAddress:{ address1:string | null; address2:string | null; city:string | null; province:string | null; zip:string | null; countryCodeV2:string | null; firstName:string | null; lastName:string | null; company:string | null; phone:string | null } | null;
  lineItems:{ pageInfo:{ hasNextPage:boolean }; nodes:DraftLine[] } }
const LINE='title variantTitle variant{id} product{title status} quantity appliedDiscount{value valueType} discountedTotalSet{presentmentMoney{amount currencyCode}}'
const DRAFT=`id name status tags customer{id} invoiceSentAt visibleToCustomer order{id} totalPriceSet{presentmentMoney{amount currencyCode}} shippingAddress{address1 address2 city province zip countryCodeV2 firstName lastName company phone} lineItems(first:100){pageInfo{hasNextPage} nodes{${LINE}}}`
function client(admin:ShopifyAdmin) { return new ShopifyAdminClient(admin.shopDomain,admin.accessToken,admin.apiVersion,30000) }
function providerId(raw:unknown):string | null { return (typeof raw==='string' || typeof raw==='number' && Number.isSafeInteger(raw)) && /^\d{1,20}$/.test(String(raw)) ? String(raw) : null }
function money(m:Money | undefined,currency:string):m is Money { return !!m && typeof m.amount==='string' && m.currencyCode===currency && refundMoney(m.amount)!==null && refundMoney(Number(m.amount))===refundMoney(m.amount) }
function input(source:ReplacementSource,requested:ReviewedOrderItem[],operationId:string,reason:string) {
  const customerId=providerId(source.customer?.id), sourceId=providerId(source.id), address=providerShippingAddress(source.shipping_address), items=orderItems(requested)
  if (!customerId || !sourceId || !address || !items || !/^[A-Z]{3}$/.test(source.currency)) return null
  const recipient=source.shipping_address!
  return { purchasingEntity:{ customerId:`gid://shopify/Customer/${customerId}` },presentmentCurrencyCode:source.currency,
    shippingAddress:{ ...address,firstName:recipient.first_name ?? '',lastName:recipient.last_name ?? '',company:recipient.company ?? '',phone:recipient.phone ?? '' },
    lineItems:items.map(item => ({ variantId:`gid://shopify/ProductVariant/${item.variantId}`,quantity:item.quantity,
      ...(item.free ? { appliedDiscount:{ description:'Riverz replacement',value:100,valueType:'PERCENTAGE' } } : {}) })),
    tags:[REPLACEMENT_DRAFT_TAG,replacementDraftTag(operationId),`riverz_source_order_${sourceId}`],note:`Riverz replacement · ${source.name} · ${reason}`.slice(0,255),
    useCustomerDefaultAddress:false,acceptAutomaticDiscounts:false,allowDiscountCodesInCheckout:false,visibleToCustomer:false }
}
function lines(raw:DraftLine[],currency:string,requested?:ReviewedOrderItem[]):OrderItemDisplay[] | null {
  if (!Array.isArray(raw) || !raw.length || raw.length>20) return null
  const items:OrderItemDisplay[]=[]
  for (const line of raw) {
    if (!/^gid:\/\/shopify\/ProductVariant\/\d{1,20}$/.test(line.variant?.id ?? '') || !Number.isInteger(line.quantity) || line.quantity<1 ||
      !money(line.discountedTotalSet?.presentmentMoney,currency)) return null
    const free=line.appliedDiscount?.valueType==='PERCENTAGE' && Number(line.appliedDiscount.value)===100
    if (free && refundMoney(line.discountedTotalSet.presentmentMoney.amount)!==BigInt(0)) return null
    items.push({ variantId:line.variant!.id.split('/').pop()!,quantity:line.quantity,free,title:line.product?.title || line.title,variantTitle:line.variantTitle ?? '' })
  }
  const normalized=orderItems(items.map(({ variantId,quantity,free }) => ({ variantId,quantity,free })))
  if (!normalized || requested && JSON.stringify(normalized)!==JSON.stringify(orderItems(requested))) return null
  return items
}
export async function prepareReplacementDraft(admin:ShopifyAdmin,source:ReplacementSource,requested:ReviewedOrderItem[],operationId:string,reason:string) {
  try {
    const prepared=input(source,requested,operationId,reason)
    if (!prepared) return { ok:false as const,error:'orderDraftUnavailable' }
    const data=await client(admin).graphql<{ draftOrderCalculate?:{ calculatedDraftOrder?:{ customer:{ id:string } | null; totalPriceSet:{ presentmentMoney:Money }; lineItems:DraftLine[] }; userErrors:{ message:string }[] } }>(
      `mutation ReplacementQuote($input:DraftOrderInput!){draftOrderCalculate(input:$input){calculatedDraftOrder{customer{id} totalPriceSet{presentmentMoney{amount currencyCode}} lineItems{${LINE}}} userErrors{field message}}}`,{ input:prepared })
    const calculated=data.draftOrderCalculate?.calculatedDraftOrder
    if (!calculated || data.draftOrderCalculate?.userErrors?.length || calculated.customer?.id!==prepared.purchasingEntity.customerId ||
      !money(calculated.totalPriceSet?.presentmentMoney,source.currency) || calculated.lineItems?.some(line => line.product?.status!=='ACTIVE')) return { ok:false as const,error:'orderDraftUnavailable' }
    const items=lines(calculated.lineItems,source.currency,requested)
    if (!items) return { ok:false as const,error:'orderDraftUnavailable' }
    const quote:ReplacementQuote={ fingerprint:createHash('sha256').update(JSON.stringify({ input:prepared,calculated })).digest('hex'),customer_id:prepared.purchasingEntity.customerId,
      shipping_address:providerShippingAddress(source.shipping_address)!,items,total:calculated.totalPriceSet.presentmentMoney.amount,currency:source.currency }
    return { ok:true as const,quote }
  } catch { return { ok:false as const,error:'orderDraftUnavailable' } }
}
export async function inspectReplacementDraft(admin:ShopifyAdmin,source:ReplacementSource,operationId:string,draftId?:string):Promise<ReplacementDraftState | null> {
  const token=replacementDraftTag(operationId), c=client(admin)
  const draft=draftId && /^gid:\/\/shopify\/DraftOrder\/\d{1,20}$/.test(draftId)
    ? (await c.graphql<{ draftOrder?:ProviderDraft | null }>(`query ReplacementDraft($id:ID!){draftOrder(id:$id){${DRAFT}}}`,{ id:draftId })).draftOrder
    : await c.graphql<{ draftOrders:{ pageInfo:{ hasNextPage:boolean }; nodes:ProviderDraft[] } }>(`query FindReplacement($query:String!){draftOrders(first:2,query:$query){pageInfo{hasNextPage} nodes{${DRAFT}}}}`,{ query:`tag:${token}` }).then(data => data.draftOrders?.pageInfo?.hasNextPage===false && data.draftOrders.nodes.length===1 ? data.draftOrders.nodes[0] : null)
  if (!draft || !/^gid:\/\/shopify\/DraftOrder\/\d{1,20}$/.test(draft.id) || draft.customer?.id!==`gid://shopify/Customer/${providerId(source.customer?.id)}` ||
    !draft.tags?.includes(token) || !draft.tags.includes(REPLACEMENT_DRAFT_TAG) || !money(draft.totalPriceSet?.presentmentMoney,source.currency) ||
    draft.lineItems?.pageInfo?.hasNextPage!==false || !['OPEN','INVOICE_SENT','COMPLETED'].includes(draft.status) || typeof draft.visibleToCustomer!=='boolean' ||
    draft.invoiceSentAt!==null && typeof draft.invoiceSentAt!=='string' ||
    draft.order!==null && !/^gid:\/\/shopify\/Order\/\d{1,20}$/.test(draft.order?.id ?? '')) return null
  const items=lines(draft.lineItems.nodes,source.currency)
  if (!items) return null
  const address=draft.shippingAddress
  return { id:draft.id,name:draft.name,status:draft.status,total:draft.totalPriceSet.presentmentMoney.amount,currency:source.currency,items,invoice_sent_at:draft.invoiceSentAt,order_id:draft.order?.id ?? null,
    visible_to_customer:draft.visibleToCustomer,shipping_address:address ? providerShippingAddress({ ...address,country_code:address.countryCodeV2 }) : null,
    recipient:{ first_name:address?.firstName ?? '',last_name:address?.lastName ?? '',company:address?.company ?? '',phone:address?.phone ?? '' } }
}
/** Creates a hidden draft once, without invoicing, payment capture, completion or fulfillment. */
export async function createReplacementDraft(admin:ShopifyAdmin,source:ReplacementSource,requested:ReviewedOrderItem[],quote:ReplacementQuote,operationId:string,reason:string) {
  const current=await prepareReplacementDraft(admin,source,requested,operationId,reason)
  if (!current.ok || current.quote.fingerprint!==quote.fingerprint) return { ok:false as const,error:current.ok ? 'orderChanged' : current.error }
  let draftId:string | undefined, attempted=false
  try {
    const prepared=input(source,requested,operationId,reason)!
    attempted=true
    const created=await client(admin).graphql<{ draftOrderCreate?:{ draftOrder?:{ id:string } | null; userErrors:{ message:string }[] } }>(
      'mutation CreateReplacement($input:DraftOrderInput!){draftOrderCreate(input:$input){draftOrder{id} userErrors{field message}}',{ input:prepared })
    const result=created.draftOrderCreate
    if (result?.userErrors?.length && !result.draftOrder) return { ok:false as const,error:'orderDraftRejected' }
    draftId=result?.draftOrder?.id
    if (!draftId || result?.userErrors?.length) return { ok:false as const,error:'orderResultUnverified',uncertain:true,draftId }
    const actual=await inspectReplacementDraft(admin,source,operationId,draftId)
    const recipient=source.shipping_address!
    if (!actual || actual.status!=='OPEN' || actual.invoice_sent_at!==null || actual.order_id!==null || actual.visible_to_customer!==false || !sameShippingAddress(actual.shipping_address,quote.shipping_address) ||
      !(['first_name','last_name','company','phone'] as const).every(field => actual.recipient[field]===(recipient[field] ?? '')) ||
      refundMoney(actual.total)!==refundMoney(quote.total) || JSON.stringify(orderItems(actual.items.map(({ variantId,quantity,free }) => ({ variantId,quantity,free }))))!==JSON.stringify(orderItems(requested))) return { ok:false as const,error:'orderResultUnverified',uncertain:true,draftId }
    return { ok:true as const,draft:actual }
  } catch { return { ok:false as const,error:attempted ? 'orderResultUnverified' : 'orderDraftUnavailable',...(attempted ? { uncertain:true,draftId } : {}) } }
}
