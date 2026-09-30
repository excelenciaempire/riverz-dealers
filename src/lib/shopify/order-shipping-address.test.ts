import { beforeEach,describe,expect,it,vi } from 'vitest'
const m=vi.hoisted(() => ({ rest:vi.fn(),gql:vi.fn() }))
vi.mock('./admin-client',() => ({ ShopifyAdminClient:class { rest=m.rest; graphql=m.gql } }))
import { updateOrderShippingAddress } from './order-shipping-address'
import { providerShippingAddress,shippingAddress,shippingChangeAllowed } from './shipping-address-contract'
const admin={ shopDomain:'test.myshopify.com',accessToken:'test',apiVersion:'2025-10' }
const original={ address1:'10 Main St',address2:'Unit 4',city:'Austin',province:'Texas',zip:'78701',country_code:'US',first_name:'Ana',last_name:'Rivera',phone:'+15125550100',company:'Example' }
const expected={ id:100,updated_at:'2026-09-30',cancelled_at:null,fulfillment_status:null,fulfillments:[],shipping_address:original }
const address={ ...providerShippingAddress(original)!,address1:'20 Main St' }
beforeEach(() => {
  m.rest.mockReset().mockResolvedValueOnce({ order:expected }).mockResolvedValue({ order:{ ...expected,shipping_address:{ ...original,address1:address.address1 } } })
  m.gql.mockReset().mockResolvedValue({ orderUpdate:{ order:{ id:'gid://shopify/Order/100' },userErrors:[] } })
})
describe('verified shipping changes',() => {
  it('changes only the reviewed address, preserves recipient identity and records a fresh provider read',async () => {
    expect(await updateOrderShippingAddress(admin,'100',address,expected)).toEqual({ ok:true,before:providerShippingAddress(original),after:address })
    expect(m.gql).toHaveBeenCalledTimes(1)
    expect(m.gql.mock.calls[0][1]).toEqual({ input:{ id:'gid://shopify/Order/100',shippingAddress:{ ...address,firstName:'Ana',lastName:'Rivera',phone:'+15125550100',company:'Example' } } })
    expect(m.rest).toHaveBeenCalledTimes(2)
  })
  it('never sends the mutation when the fresh order changed after the snapshot',async () => {
    m.rest.mockReset().mockResolvedValue({ order:{ ...expected,updated_at:'later' } })
    expect(await updateOrderShippingAddress(admin,'100',address,expected)).toEqual({ ok:false,error:'orderChanged' })
    expect(m.gql).not.toHaveBeenCalled()
  })
  it('blocks a cancelled or dispatched order even when the caller supplied the matching snapshot',async () => {
    for (const patch of [{ cancelled_at:'2026-09-30' },{ fulfillment_status:'partial' },{ fulfillments:[{ status:'success' }] }]) {
      const order={ ...expected,...patch }; m.rest.mockReset().mockResolvedValue({ order })
      expect(await updateOrderShippingAddress(admin,'100',address,order)).toEqual({ ok:false,error:'orderAlreadyShipped' })
    }
    expect(m.gql).not.toHaveBeenCalled()
  })
  it('does not treat a successful HTTP response or a changed recipient as verified',async () => {
    m.rest.mockReset().mockResolvedValueOnce({ order:expected }).mockResolvedValue({ order:{ ...expected,shipping_address:{ ...original,address1:address.address1,first_name:'Someone else' } } })
    expect(await updateOrderShippingAddress(admin,'100',address,expected)).toMatchObject({ ok:false,uncertain:true,error:'orderResultUnverified' })
    m.rest.mockReset().mockResolvedValue({ order:expected }); m.gql.mockResolvedValue({ orderUpdate:{ order:{ id:'gid://shopify/Order/999' },userErrors:[] } })
    expect(await updateOrderShippingAddress(admin,'100',address,expected)).toMatchObject({ ok:false,uncertain:true })
  })
  it('distinguishes a rejected mutation from a lost response and never retries the mutation',async () => {
    m.gql.mockResolvedValue({ orderUpdate:{ order:null,userErrors:[{ message:'Invalid address' }] } })
    expect(await updateOrderShippingAddress(admin,'100',address,expected)).toEqual({ ok:false,error:'orderAddressRejected' })
    m.rest.mockReset().mockResolvedValue({ order:expected }); m.gql.mockReset().mockRejectedValue(new Error('timeout'))
    expect(await updateOrderShippingAddress(admin,'100',address,expected)).toEqual({ ok:false,error:'orderResultUnverified',uncertain:true })
    expect(m.gql).toHaveBeenCalledTimes(1)
  })
  it('requires the actual address to match the review after saving',async () => {
    m.rest.mockReset().mockResolvedValue({ order:expected })
    expect(await updateOrderShippingAddress(admin,'100',address,expected)).toMatchObject({ ok:false,uncertain:true })
  })
  it('refuses unchanged addresses, malformed targets, unknown fields and invalid countries before writing',async () => {
    expect(await updateOrderShippingAddress(admin,'100',providerShippingAddress(original)!,expected)).toEqual({ ok:false,error:'orderAddressUnchanged' })
    expect(await updateOrderShippingAddress(admin,'100/other',address,expected)).toEqual({ ok:false,error:'orderAddressInvalid' })
    expect(shippingAddress({ ...address,email:'foreign@example.com' })).toBeNull()
    expect(shippingAddress({ ...address,countryCode:'ZZ' })).toBeNull()
    expect(shippingAddress({ ...address,address1:'Main\nSt' })).toBeNull()
    expect(shippingChangeAllowed({ cancelled_at:null,fulfillment_status:null,fulfillments:[{ status:'cancelled' }] })).toBe(true)
    expect(shippingChangeAllowed({})).toBe(false)
    expect(m.gql).not.toHaveBeenCalled()
  })
})
