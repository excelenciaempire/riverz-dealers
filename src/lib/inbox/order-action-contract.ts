import { UUID } from './collaboration'
import { refundMoney } from '@/lib/shopify/refund-plan'
import { shippingAddress, type OrderShippingAddress } from '@/lib/shopify/shipping-address-contract'
import { orderItems,type ReviewedOrderItem,type OrderItemDisplay } from '@/lib/shopify/order-items-contract'
import type { OrderItemsQuote } from '@/lib/shopify/reviewed-order-items'
import type { ReplacementQuote,ReplacementDraftState } from '@/lib/shopify/replacement-draft'
import type { FulfillmentHoldQuote,HoldPreparation } from '@/lib/shopify/fulfillment-hold'
import type { StoreCreditQuote,ObservedStoreCredit } from '@/lib/shopify/store-credit'

export type CaseOrderAction = { type: 'refund'; amount: number | null; reason: string } | { type: 'cancel'; reason: string } | { type:'address'; address:OrderShippingAddress; reason:string } | { type:'items'; items:ReviewedOrderItem[]; reason:string } | { type:'replacement'; items:ReviewedOrderItem[]; reason:string } | { type:'hold'; reason:string } | { type:'credit'; amount:number; reason:string }
export interface CaseOrderOperation {
  id: string; order_id: string; requested_by: string; approved_by: string | null;
  action: CaseOrderAction; preview: { order_name: string; amount: string | null; currency: string; financial_status: string; fulfillment_status: string | null;
    shipping_address?:OrderShippingAddress | null; shipping_change?:{ before:OrderShippingAddress | null; after:OrderShippingAddress; validation:'disabled' | 'accept' | 'confirm' }; item_change?:OrderItemsQuote;
    item_current?:{ items:OrderItemDisplay[]; total:string; currency:string }; replacement?:ReplacementQuote; draft_current?:ReplacementDraftState; hold?:FulfillmentHoldQuote; hold_current?:HoldPreparation[]; credit?:StoreCreditQuote; credit_current?:ObservedStoreCredit };
  fingerprint: string; status: 'preview' | 'running' | 'completed' | 'failed' | 'uncertain' | 'expired' | 'reviewed';
  expires_at: string; created_at: string; approved_at: string | null; result: Record<string, unknown> | null
}
export function caseOrderAction(raw: unknown): CaseOrderAction | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const v = raw as Record<string, unknown>
  if (!['refund','cancel','address','items','replacement','hold','credit'].includes(String(v.type)) || typeof v.reason !== 'string' || !v.reason.trim() || v.reason.length > 300) return null
  if (Object.keys(v).some(k => !['type','reason',...(['refund','credit'].includes(String(v.type)) ? ['amount'] : v.type === 'address' ? ['address'] : ['items','replacement'].includes(String(v.type)) ? ['items'] : [])].includes(k))) return null
  if (v.type === 'cancel') return { type: 'cancel', reason: v.reason.trim() }
  if (v.type === 'hold') return { type:'hold',reason:v.reason.trim() }
  if (v.type === 'credit') return typeof v.amount==='number' && (refundMoney(v.amount) ?? BigInt(0))>BigInt(0) ? { type:'credit',amount:v.amount,reason:v.reason.trim() } : null
  if (v.type === 'address') {
    const address = shippingAddress(v.address)
    return address ? { type:'address',address,reason:v.reason.trim() } : null
  }
  if (v.type === 'items' || v.type === 'replacement') {
    const items=orderItems(v.items)
    return items ? { type:v.type,items,reason:v.reason.trim() } : null
  }
  if (v.amount !== null && (typeof v.amount !== 'number' || (refundMoney(v.amount) ?? BigInt(0)) <= BigInt(0))) return null
  return { type: 'refund', amount: v.amount as number | null, reason: v.reason.trim() }
}
/** Compare normalized contracts, including nested addresses, independently of JSONB key ordering. */
export function sameCaseOrderAction(left:unknown,right:unknown):boolean {
  const a=caseOrderAction(left), b=caseOrderAction(right)
  return !!a && !!b && JSON.stringify(a) === JSON.stringify(b)
}
export function orderPreviewInput(raw: unknown): { id: string; order_id: string; action: CaseOrderAction } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const v = raw as Record<string, unknown>, action = caseOrderAction(v.action)
  if (!action || typeof v.id !== 'string' || !UUID.test(v.id) || typeof v.order_id !== 'string' || !UUID.test(v.order_id) || Object.keys(v).some(k => !['id','order_id','action'].includes(k))) return null
  return { id: v.id, order_id: v.order_id, action }
}
