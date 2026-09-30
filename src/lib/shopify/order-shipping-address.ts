import 'server-only'
import { ShopifyAdminClient } from './admin-client'
import type { ShopifyAdmin } from './order-cancel'
import { providerShippingAddress, sameShippingAddress, shippingAddress, shippingChangeAllowed, type OrderShippingAddress, type ProviderShippingAddress } from './shipping-address-contract'

interface ShippingOrder {
  id:number | string; updated_at:string; cancelled_at:string | null; fulfillment_status:string | null;
  fulfillments?:{ status:string }[]; shipping_address?:ProviderShippingAddress | null
}
export type ShippingChangeResult = { ok:true; before:OrderShippingAddress; after:OrderShippingAddress } | { ok:false; error:string; uncertain?:boolean }
const RECIPIENT = ['first_name','last_name','company','phone'] as const
/** Shared service. A successful mutation is followed by a fresh read; a lost response is never replayed here. */
export async function updateOrderShippingAddress(admin:ShopifyAdmin,orderId:string,address:OrderShippingAddress,expected:ShippingOrder):Promise<ShippingChangeResult> {
  const parsed = shippingAddress(address)
  if (!/^\d{1,20}$/.test(orderId) || !parsed) return { ok:false,error:'orderAddressInvalid' }
  const client = new ShopifyAdminClient(admin.shopDomain,admin.accessToken,admin.apiVersion,30000)
  let mutationStarted = false
  try {
    const { order } = await client.rest<{ order?:ShippingOrder }>(`/orders/${orderId}.json`)
    if (!order || String(order.id) !== orderId || JSON.stringify(order) !== JSON.stringify(expected)) return { ok:false,error:'orderChanged' }
    if (!shippingChangeAllowed(order)) return { ok:false,error:'orderAlreadyShipped' }
    const before = providerShippingAddress(order.shipping_address)
    if (!before) return { ok:false,error:'orderAddressUnavailable' }
    if (sameShippingAddress(before,parsed)) return { ok:false,error:'orderAddressUnchanged' }
    const recipient = order.shipping_address!
    mutationStarted = true
    const data = await client.graphql<{ orderUpdate?:{ order?:{ id:string } | null; userErrors?:{ message:string }[] } }>(
      'mutation UpdateShippingAddress($input:OrderInput!){orderUpdate(input:$input){order{id} userErrors{field message}}}',
      { input:{ id:`gid://shopify/Order/${orderId}`,shippingAddress:{ ...parsed,
        firstName:recipient.first_name ?? '',lastName:recipient.last_name ?? '',company:recipient.company ?? '',phone:recipient.phone ?? '' } } },
    )
    const updated = data.orderUpdate
    if (updated?.userErrors?.length && !updated.order) return { ok:false,error:'orderAddressRejected' }
    if (!updated || updated.userErrors?.length || updated.order?.id !== `gid://shopify/Order/${orderId}`) return { ok:false,error:'orderResultUnverified',uncertain:true }
    const verified = (await client.rest<{ order?:ShippingOrder }>(`/orders/${orderId}.json`)).order
    const after = providerShippingAddress(verified?.shipping_address)
    if (!verified || String(verified.id) !== orderId || !after || !sameShippingAddress(after,parsed) ||
      !RECIPIENT.every(field => (verified.shipping_address?.[field] ?? '') === (recipient[field] ?? ''))) return { ok:false,error:'orderResultUnverified',uncertain:true }
    return { ok:true,before,after }
  } catch {
    return { ok:false,error:mutationStarted ? 'orderResultUnverified' : 'orderUnavailable',...(mutationStarted ? { uncertain:true } : {}) }
  }
}
