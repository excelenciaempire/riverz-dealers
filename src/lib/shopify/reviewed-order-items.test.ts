import { beforeEach,describe,expect,it,vi } from 'vitest'
const m=vi.hoisted(() => ({ gql:vi.fn(),stage:vi.fn(),commit:vi.fn() }))
vi.mock('./admin-client',() => ({ ShopifyAdminClient:class { graphql=m.gql } }))
vi.mock('./order-edit',() => ({ stageUnfulfilledOrderItems:m.stage,commitStagedOrderItems:m.commit }))
import { prepareReviewedOrderItems,commitReviewedOrderItems } from './reviewed-order-items'
import { orderItems,orderPriceDifference } from './order-items-contract'
const admin={ shopDomain:'test.myshopify.com',accessToken:'test',apiVersion:'2025-10' }, id='gid://shopify/CalculatedOrder/1'
const requested=[{ variantId:'222',quantity:2,free:false }]
const connection=<T>(nodes:T[]) => ({ pageInfo:{ hasNextPage:false },nodes })
const money=(amount:string) => ({ presentmentMoney:{ amount,currencyCode:'USD' } })
function calculated() {
  return { id,originalOrder:{ id:'gid://shopify/Order/100',cancelledAt:null,displayFulfillmentStatus:'UNFULFILLED',tags:[],currentTotalPriceSet:money('100.00'),lineItems:connection([{ title:'Old',variantTitle:'Small',currentQuantity:1,unfulfilledQuantity:1,variant:{ id:'gid://shopify/ProductVariant/111' } }]) },
    totalPriceSet:money('120.00'),lineItems:connection([]),addedLineItems:connection([{ id:'line-2',quantity:2,title:'New',variantTitle:'Large',variant:{ id:'gid://shopify/ProductVariant/222' },hasStagedLineItemDiscount:false,discountedUnitPriceSet:money('60.00') }]) }
}
function verified(amount='120.00',variant='222',quantity=2) {
  return { order:{ id:'gid://shopify/Order/100',currentTotalPriceSet:money(amount),lineItems:connection([{ currentQuantity:quantity,variant:{ id:`gid://shopify/ProductVariant/${variant}` },discountedUnitPriceSet:money('60.00') }]) } }
}
beforeEach(() => {
  m.gql.mockReset().mockResolvedValue({ node:calculated() })
  m.stage.mockReset().mockResolvedValue({ ok:true,id,items:requested })
  m.commit.mockReset().mockResolvedValue({ ok:true,verifiedItems:[{ variantId:'222',quantity:2,title:'New',variantTitle:'Large' }] })
})
describe('reviewed item changes and real totals',() => {
  it('prepares only a staged edit and presents the provider total and exact difference, without committing',async () => {
    expect(await prepareReviewedOrderItems(admin,'100',requested)).toMatchObject({ ok:true,quote:{ calculated_id:id,total_before:'100.00',total_after:'120.00',difference:'20.00',currency:'USD',after:[{ variantId:'222',quantity:2 }] } })
    expect(m.stage).toHaveBeenCalledWith(admin,'100',requested); expect(m.commit).not.toHaveBeenCalled()
    expect(orderPriceDifference('70.125','100.000')).toBe('-29.875')
  })
  it('commits the reviewed session exactly and verifies current items and total afterward',async () => {
    const prepared=await prepareReviewedOrderItems(admin,'100',requested); if (!prepared.ok) throw new Error('prepare failed')
    m.gql.mockResolvedValueOnce({ node:calculated() }).mockResolvedValueOnce(verified())
    expect(await commitReviewedOrderItems(admin,'100',requested,prepared.quote,'Customer request')).toMatchObject({ ok:true,total:{ amount:'120.00',currencyCode:'USD' } })
    expect(m.commit).toHaveBeenCalledWith(admin,'100',{ ok:true,id,items:requested },'Customer request')
    expect(m.stage).toHaveBeenCalledTimes(1)
  })
  it('requires a new review when the real quote changes, instead of silently rebuilding or committing',async () => {
    const prepared=await prepareReviewedOrderItems(admin,'100',requested); if (!prepared.ok) throw new Error('prepare failed')
    m.gql.mockResolvedValue({ node:{ ...calculated(),totalPriceSet:money('125.00') } })
    expect(await commitReviewedOrderItems(admin,'100',requested,prepared.quote,'Customer request')).toEqual({ ok:false,error:'orderChanged' })
    expect(m.commit).not.toHaveBeenCalled(); expect(m.stage).toHaveBeenCalledTimes(1)
  })
  it('refuses truncated, mismatched and foreign staged lines before confirmation',async () => {
    for (const patch of [{ addedLineItems:{ ...calculated().addedLineItems,pageInfo:{ hasNextPage:true } } },{ originalOrder:{ ...calculated().originalOrder,id:'gid://shopify/Order/999' } },{ addedLineItems:connection([{ ...calculated().addedLineItems.nodes[0],quantity:1 }]) }]) {
      m.gql.mockResolvedValue({ node:{ ...calculated(),...patch } })
      expect(await prepareReviewedOrderItems(admin,'100',requested)).toEqual({ ok:false,error:'orderItemsUnavailable' })
    }
    expect(m.commit).not.toHaveBeenCalled()
  })
  it('marks a mismatched price or changed variant after the commit as uncertain',async () => {
    for (const actual of [verified('125.00'),verified('120.00','999'),verified('120.00','222',1)]) {
      m.gql.mockResolvedValue({ node:calculated() })
      const prepared=await prepareReviewedOrderItems(admin,'100',requested); if (!prepared.ok) throw new Error('prepare failed')
      m.gql.mockResolvedValueOnce({ node:calculated() }).mockResolvedValueOnce(actual)
      expect(await commitReviewedOrderItems(admin,'100',requested,prepared.quote,'Customer request')).toMatchObject({ ok:false,uncertain:true,error:'orderResultUnverified' })
    }
  })
  it('never retries a commit with an uncertain provider response',async () => {
    const prepared=await prepareReviewedOrderItems(admin,'100',requested); if (!prepared.ok) throw new Error('prepare failed')
    m.commit.mockResolvedValue({ ok:false,uncertain:true,error:'order_edit_commit_failed' })
    expect(await commitReviewedOrderItems(admin,'100',requested,prepared.quote,'Customer request')).toMatchObject({ ok:false,uncertain:true })
    expect(m.commit).toHaveBeenCalledTimes(1)
  })
  it('blocks dispatch or a logistics handoff that starts before confirming the staged edit',async () => {
    const prepared=await prepareReviewedOrderItems(admin,'100',requested); if (!prepared.ok) throw new Error('prepare failed')
    for (const patch of [{ displayFulfillmentStatus:'FULFILLED' },{ cancelledAt:'2026-09-30' },{ tags:['Order sent to dropi'] }]) {
      m.gql.mockResolvedValue({ node:{ ...calculated(),originalOrder:{ ...calculated().originalOrder,...patch } } })
      expect(await commitReviewedOrderItems(admin,'100',requested,prepared.quote,'Customer request')).toEqual({ ok:false,error:'orderChanged' })
    }
    expect(m.commit).not.toHaveBeenCalled()
  })
  it('validates integer quantities, nested fields, grouped limits and explicit discounts',() => {
    expect(orderItems([{ variantId:'222',quantity:1,free:false },{ variantId:'222',quantity:2,free:false }])).toEqual([{ variantId:'222',quantity:3,free:false }])
    for (const value of [[],[{ variantId:'abc222',quantity:1,free:false }],[{ variantId:'222',quantity:1.5,free:false }],[{ variantId:'222',quantity:1,free:'yes' }],[{ variantId:'222',quantity:1,free:false,price:0 }],[{ variantId:'222',quantity:20,free:false },{ variantId:'222',quantity:1,free:false }]]) expect(orderItems(value)).toBeNull()
  })
})
