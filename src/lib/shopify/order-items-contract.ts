import { refundMoney,refundMoneyText } from './refund-plan'
export interface ReviewedOrderItem { variantId:string; quantity:number; free:boolean }
export interface OrderItemDisplay extends ReviewedOrderItem { title:string; variantTitle:string }
export function orderItems(raw:unknown):ReviewedOrderItem[] | null {
  if (!Array.isArray(raw) || !raw.length || raw.length>20) return null
  const grouped = new Map<string,ReviewedOrderItem>()
  for (const value of raw) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['variantId','quantity','free'].includes(k)) ||
      typeof value.variantId !== 'string' || !/^\d{1,20}$/.test(value.variantId) || !Number.isInteger(value.quantity) || value.quantity<1 || value.quantity>20 || typeof value.free !== 'boolean') return null
    const key=`${value.variantId}:${value.free}`
    const previous=grouped.get(key)
    const quantity=(previous?.quantity ?? 0)+value.quantity
    if (quantity>20) return null
    grouped.set(key,{ variantId:value.variantId,quantity,free:value.free })
  }
  const items=[...grouped.values()].sort((a,b) => `${a.variantId}:${a.free}`.localeCompare(`${b.variantId}:${b.free}`))
  return items.reduce((sum,item) => sum+item.quantity,0)>100 ? null : items
}
export function orderPriceDifference(after:string,before:string):string | null {
  const a=refundMoney(after), b=refundMoney(before)
  if (a===null || b===null) return null
  const difference=a-b
  return `${difference<BigInt(0) ? '-' : ''}${refundMoneyText(difference<BigInt(0) ? -difference : difference)}`
}
