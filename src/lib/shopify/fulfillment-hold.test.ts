import { beforeEach,describe,it,expect,vi } from 'vitest'
const m=vi.hoisted(() => ({ graphql:vi.fn() }))
vi.mock('./admin-client',() => ({ ShopifyAdminClient:class { graphql=m.graphql } }))
import { applyReviewedFulfillmentHold,fulfillmentHoldHandle,inspectFulfillmentHold,prepareFulfillmentHold } from './fulfillment-hold'
const admin={ shopDomain:'test.myshopify.com',accessToken:'test',apiVersion:'2025-10' }, orderId='gid://shopify/Order/100'
const op='11111111-1111-4111-8111-111111111111', handle=`riverz_${op}`, reason='Customer requested a pause'
function node(id='1',held=false) { return { id:`gid://shopify/FulfillmentOrder/${id}`,order:{ id:orderId },assignedLocation:{ name:'Main warehouse' },status:held ? 'ON_HOLD' : 'OPEN',requestStatus:'UNSUBMITTED',updatedAt:'2026-09-30T10:00:00Z',supportedActions:[{ action:'HOLD' }],
  fulfillmentHolds:held ? [{ id:`gid://shopify/FulfillmentHold/${id}`,handle,reason:'OTHER',reasonNotes:reason,heldByRequestingApp:true }] : [],
  lineItems:{ pageInfo:{ hasNextPage:false },nodes:[{ remainingQuantity:2,lineItem:{ title:'Product',variantTitle:'Large' } }] } } }
function order(nodes=[node()]) { return { id:orderId,cancelledAt:null,displayFulfillmentStatus:'UNFULFILLED',tags:[],fulfillmentOrders:{ pageInfo:{ hasNextPage:false },nodes } } }
beforeEach(() => { m.graphql.mockReset().mockImplementation(async (query:string,vars:Record<string,unknown>) => {
  if (query.includes('query ReviewedHold(')) return { order:order() }
  if (query.includes('ApplyReviewedHold')) { const id=String(vars.id).split('/').pop()!; return { fulfillmentOrderHold:{ fulfillmentHold:{ id:`gid://shopify/FulfillmentHold/${id}`,handle,heldByRequestingApp:true },fulfillmentOrder:{ id:vars.id },userErrors:[] } } }
  return { nodes:[node('1',true)] }
}) })
async function quote() { const r=await prepareFulfillmentHold(admin,'100'); if (!r.ok) throw Error('invalid fixture'); return r.quote }
describe('reviewed Shopify preparation holds',() => {
  it('prepares a read-only review with exact locations and remaining units',async () => {
    expect(await quote()).toMatchObject({ preparations:[{ id:'gid://shopify/FulfillmentOrder/1',location:'Main warehouse',items:[{ quantity:2,title:'Product' }],status:'OPEN' }] })
    expect(m.graphql).toHaveBeenCalledTimes(1); expect(m.graphql.mock.calls[0][0]).not.toContain('mutation')
    expect(fulfillmentHoldHandle(op)).toBe(handle); expect(() => fulfillmentHoldHandle('foreign')).toThrow()
  })
  it('refuses shipped, Dropi, started, unsupported, foreign and incomplete preparations before holding',async () => {
    for (const bad of [{ ...order(),displayFulfillmentStatus:'PARTIALLY_FULFILLED' },{ ...order(),tags:['Order sent to dropi'] },{ ...order(),cancelledAt:'2026-09-30' },
      { ...order(),fulfillmentOrders:{ pageInfo:{ hasNextPage:true },nodes:[node()] } },order([{ ...node(),status:'IN_PROGRESS' }]),order([{ ...node(),supportedActions:[] }]),
      order([{ ...node(),order:{ id:'gid://shopify/Order/999' } }]),order([{ ...node(),lineItems:{ ...node().lineItems,pageInfo:{ hasNextPage:true } } }])]) {
      m.graphql.mockResolvedValue({ order:bad }); expect(await prepareFulfillmentHold(admin,'100')).toMatchObject({ ok:false,error:'orderHoldUnavailable' })
    }
    expect(m.graphql.mock.calls.every(([query]) => !query.includes('mutation'))).toBe(true)
  })
  it('holds each reviewed preparation once and verifies its own unique hold reference afterward',async () => {
    const reviewed=await quote(); m.graphql.mockClear()
    expect(await applyReviewedFulfillmentHold(admin,'100',reviewed,op,reason)).toMatchObject({ ok:true,handle,receipts:[{ preparation_id:'gid://shopify/FulfillmentOrder/1',hold_id:'gid://shopify/FulfillmentHold/1' }],preparations:[{ status:'ON_HOLD' }] })
    const mutations=m.graphql.mock.calls.filter(([q]) => q.includes('ApplyReviewedHold'))
    expect(mutations).toHaveLength(1); expect(mutations[0][1]).toEqual({ id:'gid://shopify/FulfillmentOrder/1',hold:{ handle,reason:'OTHER',reasonNotes:reason,notifyMerchant:false } })
  })
  it('requires another review after routing changes and never trusts substituted provider targets',async () => {
    const reviewed=await quote()
    m.graphql.mockResolvedValue({ order:order([{ ...node(),assignedLocation:{ name:'New warehouse' } }]) })
    expect(await applyReviewedFulfillmentHold(admin,'100',reviewed,op,reason)).toEqual({ ok:false,error:'orderChanged' })
    expect(m.graphql.mock.calls.some(([q]) => q.includes('mutation'))).toBe(false)
  })
  it('refuses a caller-substituted quote list even when its fingerprint was copied',async () => {
    const reviewed=await quote(), changed={ ...reviewed,preparations:[{ ...reviewed.preparations[0],id:'gid://shopify/FulfillmentOrder/999' }] }
    expect(await applyReviewedFulfillmentHold(admin,'100',changed,op,reason)).toMatchObject({ ok:false,error:'orderChanged' })
    expect(m.graphql.mock.calls.filter(([q]) => q.includes('ApplyReviewedHold'))).toHaveLength(0)
  })
  it('does not treat an existing hold from another app as verification of this action',async () => {
    const reviewed=await quote()
    const held=node('1',true); held.fulfillmentHolds[0].heldByRequestingApp=false
    m.graphql.mockImplementation(async (q:string) => q.includes('query ReviewedHold(') ? { order:order() } : q.includes('ApplyReviewedHold') ? { fulfillmentOrderHold:{ fulfillmentHold:{ id:'gid://shopify/FulfillmentHold/1',handle,heldByRequestingApp:true },fulfillmentOrder:{ id:node().id },userErrors:[] } } : { nodes:[held] })
    expect(await applyReviewedFulfillmentHold(admin,'100',reviewed,op,reason)).toMatchObject({ ok:false,uncertain:true,receipts:[{ hold_id:'gid://shopify/FulfillmentHold/1' }] })
  })
  it('distinguishes a first known rejection from a partially applied batch',async () => {
    const reviewed=await quote()
    m.graphql.mockImplementation(async (q:string) => q.includes('query ReviewedHold(') ? { order:order() } : { fulfillmentOrderHold:{ fulfillmentHold:null,userErrors:[{ message:'Rejected' }] } })
    expect(await applyReviewedFulfillmentHold(admin,'100',reviewed,op,reason)).toEqual({ ok:false,error:'orderHoldRejected' })
    const pair=order([node('1'),node('2')]); m.graphql.mockResolvedValue({ order:pair }); const two=await quote()
    m.graphql.mockClear().mockImplementation(async (q:string,vars:Record<string,unknown>) => {
      if (q.includes('query ReviewedHold(')) return { order:pair }
      return vars.id===node('1').id ? { fulfillmentOrderHold:{ fulfillmentHold:{ id:'gid://shopify/FulfillmentHold/1',handle,heldByRequestingApp:true },fulfillmentOrder:{ id:vars.id },userErrors:[] } }
        : { fulfillmentOrderHold:{ fulfillmentHold:null,userErrors:[{ message:'Rejected' }] } }
    })
    expect(await applyReviewedFulfillmentHold(admin,'100',two,op,reason)).toMatchObject({ ok:false,uncertain:true,receipts:[{ preparation_id:node().id }] })
    expect(m.graphql.mock.calls.filter(([q]) => q.includes('mutation'))).toHaveLength(2)
  })
  it('keeps a lost response uncertain without retrying, and reads exact recorded targets for review',async () => {
    const reviewed=await quote(); m.graphql.mockClear().mockImplementation(async (q:string) => { if (q.includes('query ReviewedHold(')) return { order:order() }; throw Error('lost response') })
    expect(await applyReviewedFulfillmentHold(admin,'100',reviewed,op,reason)).toMatchObject({ ok:false,uncertain:true })
    expect(m.graphql.mock.calls.filter(([q]) => q.includes('mutation'))).toHaveLength(1)
    m.graphql.mockResolvedValue({ nodes:[{ ...node('1',true),status:'CLOSED' }] })
    expect(await inspectFulfillmentHold(admin,'100',reviewed)).toMatchObject([{ status:'CLOSED' }])
    m.graphql.mockResolvedValue({ nodes:[{ ...node(),order:{ id:'gid://shopify/Order/999' } }] })
    expect(await inspectFulfillmentHold(admin,'100',reviewed)).toBeNull()
  })
})
