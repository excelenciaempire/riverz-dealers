import { beforeEach,describe,it,expect,vi } from 'vitest'
const m=vi.hoisted(() => ({ graphql:vi.fn() }))
vi.mock('./admin-client',() => ({ ShopifyAdminClient:class { graphql=m.graphql } }))
import { createReplacementDraft,inspectReplacementDraft,prepareReplacementDraft } from './replacement-draft'
const admin={ shopDomain:'test.myshopify.com',accessToken:'test',apiVersion:'2025-10' }
const op='11111111-1111-4111-8111-111111111111', customer='gid://shopify/Customer/22', draftId='gid://shopify/DraftOrder/44'
const address={ address1:'10 Main St',address2:'',city:'Austin',province:'Texas',zip:'78701',country_code:'US',first_name:'Ana',last_name:'Rivera',company:'',phone:'+15551234567' }
const source={ id:100,name:'#100',currency:'USD',customer:{ id:22 },shipping_address:address }
const items=[{ variantId:'222',quantity:2,free:false }]
function line(free=false) { return { title:'Product',variantTitle:'Large',variant:{ id:'gid://shopify/ProductVariant/222' },product:{ title:'Product',status:'ACTIVE' },quantity:2,
  appliedDiscount:free ? { value:100,valueType:'PERCENTAGE' } : null,discountedTotalSet:{ presentmentMoney:{ amount:free ? '0.00' : '40.00',currencyCode:'USD' } } } }
function calculated(free=false) { return { customer:{ id:customer },totalPriceSet:{ presentmentMoney:{ amount:free ? '0.00' : '44.00',currencyCode:'USD' } },lineItems:[line(free)] } }
function draft(free=false) { return { id:draftId,name:'#D44',status:'OPEN',tags:['riverz_replacement',`riverz_replacement_${op}`],customer:{ id:customer },invoiceSentAt:null,visibleToCustomer:false,order:null,
  totalPriceSet:calculated(free).totalPriceSet,shippingAddress:{ address1:address.address1,address2:'',city:address.city,province:address.province,zip:address.zip,countryCodeV2:'US',firstName:'Ana',lastName:'Rivera',company:'',phone:address.phone },
  lineItems:{ pageInfo:{ hasNextPage:false },nodes:[line(free)] } } }
beforeEach(() => {
  m.graphql.mockReset().mockImplementation(async (query:string) => query.includes('draftOrderCalculate') ? { draftOrderCalculate:{ calculatedDraftOrder:calculated(),userErrors:[] } }
    : query.includes('draftOrderCreate') ? { draftOrderCreate:{ draftOrder:{ id:draftId },userErrors:[] } } : { draftOrder:draft() })
})
async function quote() { const q=await prepareReplacementDraft(admin,source,items,op,'Replacement requested'); if (!q.ok) throw Error('invalid fixture'); return q.quote }
describe('reviewed replacement drafts',() => {
  it('calculates without creating a draft, using the verified customer and shipping recipient',async () => {
    expect(await quote()).toMatchObject({ customer_id:customer,total:'44.00',currency:'USD',items:[{ quantity:2,free:false }] })
    expect(m.graphql).toHaveBeenCalledTimes(1)
    const [query,vars]=m.graphql.mock.calls[0]
    expect(query).toContain('draftOrderCalculate'); expect(query).not.toContain('draftOrderCreate')
    expect(vars.input).toMatchObject({ purchasingEntity:{ customerId:customer },shippingAddress:{ firstName:'Ana',phone:address.phone },visibleToCustomer:false,
      useCustomerDefaultAddress:false,acceptAutomaticDiscounts:false,allowDiscountCodesInCheckout:false,tags:expect.arrayContaining(['riverz_replacement',`riverz_replacement_${op}`]) })
    expect(vars.input).not.toHaveProperty('reserveInventoryUntil'); expect(vars.input).not.toHaveProperty('customerId')
  })
  it('creates once with initial exclusion tags and verifies actual totals, recipient and draft state',async () => {
    const reviewed=await quote(); m.graphql.mockClear()
    expect(await createReplacementDraft(admin,source,items,reviewed,op,'Replacement requested')).toMatchObject({ ok:true,draft:{ id:draftId,total:'44.00',invoice_sent_at:null,order_id:null,visible_to_customer:false } })
    expect(m.graphql.mock.calls.filter(([q]) => q.includes('draftOrderCreate'))).toHaveLength(1)
    expect(m.graphql.mock.calls.some(([q]) => /draftOrderInvoiceSend|draftOrderComplete|fulfillmentCreate/.test(q))).toBe(false)
  })
  it('requires another review when calculation or customer changes, before creating anything',async () => {
    const reviewed=await quote()
    for (const change of [{ ...calculated(),totalPriceSet:{ presentmentMoney:{ amount:'45.00',currencyCode:'USD' } } },{ ...calculated(),customer:{ id:'gid://shopify/Customer/99' } }]) {
      m.graphql.mockReset().mockResolvedValue({ draftOrderCalculate:{ calculatedDraftOrder:change,userErrors:[] } })
      expect(await createReplacementDraft(admin,source,items,reviewed,op,'Replacement requested')).toMatchObject({ ok:false })
      expect(m.graphql.mock.calls.some(([q]) => q.includes('draftOrderCreate'))).toBe(false)
    }
  })
  it('rejects unknown customer, missing shipping address and malformed provider lines',async () => {
    for (const bad of [{ ...source,customer:null },{ ...source,shipping_address:null },{ ...source,customer:{ id:22.5 } }]) expect(await prepareReplacementDraft(admin,bad,items,op,'Reason')).toMatchObject({ ok:false })
    expect(m.graphql).not.toHaveBeenCalled()
    for (const badLine of [{ ...line(),quantity:1 },{ ...line(),variant:{ id:'gid://shopify/ProductVariant/999' } },{ ...line(),product:{ title:'Archived',status:'ARCHIVED' } },{ ...line(),discountedTotalSet:{ presentmentMoney:{ amount:'40.00',currencyCode:'EUR' } } }]) {
      m.graphql.mockResolvedValue({ draftOrderCalculate:{ calculatedDraftOrder:{ ...calculated(),lineItems:[badLine] },userErrors:[] } })
      expect(await prepareReplacementDraft(admin,source,items,op,'Reason')).toMatchObject({ ok:false })
    }
  })
  it('accepts a verified free replacement without inventing a paid amount',async () => {
    m.graphql.mockImplementation(async (query:string) => query.includes('draftOrderCalculate') ? { draftOrderCalculate:{ calculatedDraftOrder:calculated(true),userErrors:[] } }
      : query.includes('draftOrderCreate') ? { draftOrderCreate:{ draftOrder:{ id:draftId },userErrors:[] } } : { draftOrder:draft(true) })
    const freeItems=[{ ...items[0],free:true }], q=await prepareReplacementDraft(admin,source,freeItems,op,'Reason')
    expect(q.ok).toBe(true); if (!q.ok) throw Error('invalid fixture')
    expect(await createReplacementDraft(admin,source,freeItems,q.quote,op,'Reason')).toMatchObject({ ok:true,draft:{ total:'0.00',items:[{ free:true }] } })
    expect(m.graphql.mock.calls[0][1].input.lineItems[0].appliedDiscount).toEqual({ description:'Riverz replacement',value:100,valueType:'PERCENTAGE' })
  })
  it('distinguishes a known rejection from a lost creation response and never retries the mutation',async () => {
    const reviewed=await quote()
    m.graphql.mockImplementation(async (query:string) => {
      if (query.includes('draftOrderCalculate')) return { draftOrderCalculate:{ calculatedDraftOrder:calculated(),userErrors:[] } }
      if (query.includes('draftOrderCreate')) return { draftOrderCreate:{ draftOrder:null,userErrors:[{ message:'Rejected' }] } }
      throw Error('unexpected read')
    })
    expect(await createReplacementDraft(admin,source,items,reviewed,op,'Replacement requested')).toEqual({ ok:false,error:'orderDraftRejected' })
    m.graphql.mockClear().mockImplementation(async (query:string) => {
      if (query.includes('draftOrderCalculate')) return { draftOrderCalculate:{ calculatedDraftOrder:calculated(),userErrors:[] } }
      throw Error('connection lost')
    })
    expect(await createReplacementDraft(admin,source,items,reviewed,op,'Replacement requested')).toMatchObject({ ok:false,uncertain:true })
    expect(m.graphql.mock.calls.filter(([q]) => q.includes('draftOrderCreate'))).toHaveLength(1)
  })
  it('keeps a provider receipt uncertain when actual address, visibility, invoice or total differs',async () => {
    const reviewed=await quote()
    for (const patch of [{ shippingAddress:{ ...draft().shippingAddress,phone:'+19999999999' } },{ visibleToCustomer:true },{ invoiceSentAt:'2026-09-30T12:00:00Z' },{ totalPriceSet:{ presentmentMoney:{ amount:'45.00',currencyCode:'USD' } } },{ order:undefined }]) {
      m.graphql.mockImplementation(async (query:string) => query.includes('draftOrderCalculate') ? { draftOrderCalculate:{ calculatedDraftOrder:calculated(),userErrors:[] } }
        : query.includes('draftOrderCreate') ? { draftOrderCreate:{ draftOrder:{ id:draftId },userErrors:[] } } : { draftOrder:{ ...draft(),...patch } })
      expect(await createReplacementDraft(admin,source,items,reviewed,op,'Replacement requested')).toMatchObject({ ok:false,uncertain:true,draftId })
    }
  })
  it('recovers an unknown receipt by its operation tag only when exactly one complete draft matches',async () => {
    m.graphql.mockResolvedValue({ draftOrders:{ pageInfo:{ hasNextPage:false },nodes:[draft()] } })
    expect(await inspectReplacementDraft(admin,source,op)).toMatchObject({ id:draftId })
    expect(m.graphql.mock.calls[0][1]).toEqual({ query:`tag:riverz_replacement_${op}` })
    for (const response of [{ pageInfo:{ hasNextPage:true },nodes:[draft()] },{ pageInfo:{ hasNextPage:false },nodes:[draft(),draft()] },{ pageInfo:{ hasNextPage:false },nodes:[{ ...draft(),customer:{ id:'gid://shopify/Customer/99' } }] },{ pageInfo:{ hasNextPage:false },nodes:[{ ...draft(),tags:['riverz_replacement'] }] }]) {
      m.graphql.mockResolvedValue({ draftOrders:response }); expect(await inspectReplacementDraft(admin,source,op)).toBeNull()
    }
  })
})
