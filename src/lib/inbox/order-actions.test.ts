import { beforeEach,describe,it,expect,vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CaseOrderAction,CaseOrderOperation } from './order-action-contract'
const m=vi.hoisted(() => ({ rest:vi.fn(),gql:vi.fn(),refund:vi.fn(),cancel:vi.fn(),mirror:vi.fn(),address:vi.fn(),validate:vi.fn(),items:vi.fn() }))
vi.mock('@/lib/shopify/order-tags',() => ({ resolveShopifyAdmin:async () => ({ shopDomain:'test.myshopify.com',accessToken:'test',apiVersion:'2025-10' }) }))
vi.mock('@/lib/shopify/admin-client',() => ({ ShopifyAdminClient:class { rest=m.rest; graphql=m.gql } }))
vi.mock('@/lib/shopify/order-cancel',() => ({ refundOrder:m.refund,cancelOrder:m.cancel }))
vi.mock('@/lib/addresses/google-validation',() => ({ validateWorkspaceShippingAddress:m.validate }))
vi.mock('@/lib/shopify/order-shipping-address',() => ({ updateOrderShippingAddress:m.address }))
vi.mock('@/lib/shopify/reviewed-order-items',() => ({ commitReviewedOrderItems:m.items }))
import { caseOrderSnapshot,executeCaseOrderAction,uncertainCaseOrderSnapshot } from './order-actions'
const live={ id:100,name:'#100',updated_at:'2026-09-30',currency:'USD',financial_status:'paid',fulfillment_status:null,cancelled_at:null,total_price:'100.00',fulfillments:[],email:'customer@example.com' }
const transactions=[{ id:1,kind:'sale',status:'success',amount:'100.00',gateway:'card' }]
function fixture(privateContext?:{ lock:{ source_id:string; source_kind:string; status:string }; action:CaseOrderAction }) {
  let operation:CaseOrderOperation
  const rpc=vi.fn(async (name:string,args:Record<string,unknown>) => {
    if (name === 'claim_inbox_order_action') {
      const claimed=operation.status === 'preview'
      if (claimed) operation.status='running'
      return { data:{ claimed,operation:{ ...operation } },error:null }
    }
    operation={ ...operation,status:args.p_status as CaseOrderOperation['status'],result:args.p_result as Record<string,unknown> }
    return { data:operation,error:null }
  })
  const db={ rpc,from:(table:string) => {
    const q={ select:() => q,eq:() => q,update:(patch:unknown) => { m.mirror(patch); return q },
      maybeSingle:async () => ({ data:table === 'order_execution_locks' ? privateContext?.lock : table === 'inbox_order_actions' ? { action:privateContext?.action } : table === 'contacts' ? { email:'customer@example.com',phone:null } : { id:'local',shopify_order_id:'100',shop_domain:'test.myshopify.com',order_number:'#100',platform:'shopify' },error:null }),
      then:(done:(value:unknown) => unknown) => Promise.resolve({ error:null }).then(done) }
    return q
  } } as unknown as SupabaseClient
  const prepare=async (action:CaseOrderAction={ type:'refund',amount:25,reason:'Damage' },quote?:CaseOrderOperation['preview']['item_change']) => {
    const snapshot=await caseOrderSnapshot(db,'ws','contact','local',action)
    if (quote) snapshot.preview.item_change=quote
    operation={ id:'op',order_id:'local',requested_by:'agent',approved_by:'admin',action,preview:snapshot.preview,fingerprint:snapshot.fingerprint,
      status:'preview',expires_at:'2026-10-01',created_at:'2026-09-30',approved_at:null,result:null }
  }
  return { db,rpc,prepare,run:() => executeCaseOrderAction(db,'ws','conv','contact','admin','op') }
}
beforeEach(() => {
  m.rest.mockReset().mockImplementation(async (path:string) => path.includes('transactions') ? { transactions } : { order:{ ...live } })
  m.gql.mockReset().mockResolvedValue({ currentAppInstallation:{ accessScopes:[{ handle:'write_orders' }] } })
  m.refund.mockReset(); m.cancel.mockReset(); m.mirror.mockReset()
  m.address.mockReset(); m.validate.mockReset().mockImplementation(async (_ws:string,address:unknown) => ({ status:'disabled',address }))
  m.items.mockReset()
})
describe('reviewed item execution',() => {
  const items=[{ variantId:'222',quantity:2,free:false }], action:CaseOrderAction={ type:'items',items,reason:'Size change' }
  const quote={ calculated_id:'gid://shopify/CalculatedOrder/1',fingerprint:'a'.repeat(64),before:[],after:[{ ...items[0],title:'Product',variantTitle:'Large' }],total_before:'100.00',total_after:'120.00',difference:'20.00',currency:'USD' }
  function enable() { m.gql.mockResolvedValue({ currentAppInstallation:{ accessScopes:[{ handle:'write_orders' },{ handle:'write_order_edits' }] } }) }
  it('checks the actual edit scope and dispatch state before preparing',async () => {
    const f=fixture()
    await expect(caseOrderSnapshot(f.db,'ws','contact','local',action)).rejects.toThrow('orderItemsScopeMissing')
    enable(); m.rest.mockResolvedValue({ order:{ ...live,fulfillment_status:'partial' } })
    await expect(caseOrderSnapshot(f.db,'ws','contact','local',action)).rejects.toThrow('orderAlreadyShipped')
    expect(m.items).not.toHaveBeenCalled()
  })
  it('executes the persisted quote once and never issues a refund or changes the payment mirror',async () => {
    enable(); const f=fixture(); await f.prepare(action,quote)
    m.items.mockResolvedValue({ ok:true,items:quote.after,total:{ amount:'120.00',currencyCode:'USD' } })
    expect(await f.run()).toMatchObject({ status:'completed',result:{ items:quote.after,total:{ amount:'120.00',currencyCode:'USD' },price_difference:'20.00' } })
    await f.run(); expect(m.items).toHaveBeenCalledTimes(1)
    expect(m.items).toHaveBeenCalledWith(expect.anything(),'100',items,quote,'Size change')
    expect(m.refund).not.toHaveBeenCalled(); expect(m.mirror).not.toHaveBeenCalled()
  })
  it('does not rebuild a quote after a known failure, or repeat an uncertain commit',async () => {
    enable(); const f=fixture(); await f.prepare(action,quote)
    m.items.mockResolvedValue({ ok:false,error:'orderChanged' })
    expect(await f.run()).toMatchObject({ status:'failed',result:{ error:'orderChanged' } })
    await f.prepare(action,quote); m.items.mockResolvedValue({ ok:false,uncertain:true,error:'orderResultUnverified' })
    expect(await f.run()).toMatchObject({ status:'uncertain' }); await f.run()
    expect(m.items).toHaveBeenCalledTimes(2)
  })
  it('reviews uncertain item edits with their current products and total instead of a refund balance or address',async () => {
    enable(); m.rest.mockResolvedValue({ order:{ ...live,current_total_price:'120.00',line_items:[{ variant_id:222,title:'Product',variant_title:'Large',current_quantity:2,price:'60.00',total_discount:'0.00' }] } })
    const f=fixture({ lock:{ source_id:'op',source_kind:'inbox',status:'uncertain' },action })
    const result=await uncertainCaseOrderSnapshot(f.db,'ws','contact','local')
    expect(result.snapshot.preview).toMatchObject({ item_current:{ total:'120.00',currency:'USD',items:[{ variantId:'222',quantity:2 }] } })
    expect(result.snapshot.preview.shipping_address).toBeUndefined()
    expect(m.refund).not.toHaveBeenCalled(); expect(m.items).not.toHaveBeenCalled()
  })
})
const before={ address1:'10 Main St',address2:'',city:'Austin',province:'Texas',zip:'78701',countryCode:'US' }
const after={ ...before,address1:'20 Main St' }
function shippingFixture() {
  m.rest.mockImplementation(async () => ({ order:{ ...live,financial_status:'pending',shipping_address:{ ...before,country_code:'US' } } }))
  return fixture()
}
describe('reviewed address execution',() => {
  it('reviews an uncertain address using the actual address, without requiring a refundable balance or releasing a running operation',async () => {
    shippingFixture()
    const privateContext={ lock:{ source_id:'op',source_kind:'inbox',status:'uncertain' },action:{ type:'address',address:after,reason:'Customer request' } as CaseOrderAction }
    const f=fixture(privateContext)
    expect(await uncertainCaseOrderSnapshot(f.db,'ws','contact','local')).toMatchObject({ source_id:'op',snapshot:{ preview:{ shipping_address:before,amount:null } } })
    expect(m.rest.mock.calls.every(call => !String(call[0]).includes('transactions'))).toBe(true)
    privateContext.lock.status='running'
    await expect(uncertainCaseOrderSnapshot(f.db,'ws','contact','local')).rejects.toThrow('orderBusy')
    expect(f.rpc).not.toHaveBeenCalled(); expect(m.address).not.toHaveBeenCalled()
  })
  it('prepares and verifies a change for an unpaid order without requiring a captured balance',async () => {
    const f=shippingFixture(); await f.prepare({ type:'address',address:after,reason:'Customer request' })
    m.address.mockResolvedValue({ ok:true,before,after })
    expect(await f.run()).toMatchObject({ status:'completed',result:{ shipping_before:before,shipping_after:after } })
    expect(m.address).toHaveBeenCalledWith(expect.anything(),'100',after,expect.anything())
    expect(m.rest.mock.calls.every(call => !String(call[0]).includes('transactions'))).toBe(true)
    expect(m.refund).not.toHaveBeenCalled(); expect(m.cancel).not.toHaveBeenCalled(); expect(m.mirror).not.toHaveBeenCalled()
    await f.run(); expect(m.address).toHaveBeenCalledTimes(1)
  })
  it('blocks configured validation failures and adopts the exact reviewed normalized address',async () => {
    const f=shippingFixture(), action:CaseOrderAction={ type:'address',address:after,reason:'Customer request' }
    for (const status of ['fix','unavailable']) {
      m.validate.mockResolvedValue({ status })
      await expect(caseOrderSnapshot(f.db,'ws','contact','local',action)).rejects.toThrow(status === 'fix' ? 'orderAddressInvalid' : 'orderAddressValidationUnavailable')
    }
    m.validate.mockResolvedValue({ status:'confirm',address:{ ...after,address1:'20 Main Street' } })
    await f.prepare(action)
    m.address.mockResolvedValue({ ok:true,before,after:{ ...after,address1:'20 Main Street' } })
    expect(await f.run()).toMatchObject({ status:'completed',preview:{ shipping_change:{ after:{ address1:'20 Main Street' },validation:'confirm' } } })
    expect(m.address).toHaveBeenCalledWith(expect.anything(),'100',{ ...after,address1:'20 Main Street' },expect.anything())
  })
  it('requires a new review if validation changes and keeps uncertain saves locked',async () => {
    const f=shippingFixture(); await f.prepare({ type:'address',address:after,reason:'Customer request' })
    m.validate.mockResolvedValue({ status:'accept',address:{ ...after,address1:'22 Main Street' } })
    expect(await f.run()).toMatchObject({ status:'failed',result:{ error:'orderChanged' } })
    expect(m.address).not.toHaveBeenCalled()
    m.validate.mockResolvedValue({ status:'disabled',address:after })
    await f.prepare({ type:'address',address:after,reason:'Customer request' })
    m.address.mockResolvedValue({ ok:false,uncertain:true,error:'orderResultUnverified' })
    expect(await f.run()).toMatchObject({ status:'uncertain' }); await f.run()
    expect(m.address).toHaveBeenCalledTimes(1)
  })
})
describe('reviewed financial execution',() => {
  it('executes the exact reviewed partial amount, stores provider facts and recovers the same result without another call',async () => {
    const f=fixture(); await f.prepare()
    m.refund.mockResolvedValue({ ok:true,refundedAmount:'25.00',currency:'USD',refundId:'500',financialStatus:'partially_refunded' })
    expect(await f.run()).toMatchObject({ status:'completed',result:{ refunded_amount:'25.00',refund_id:'500',financial_status:'partially_refunded' } })
    expect(m.refund).toHaveBeenCalledWith(expect.anything(),'100',{ amount:25,reason:'Damage' })
    expect(m.mirror).toHaveBeenCalledWith({ financial_status:'partially_refunded' })
    await f.run(); expect(m.refund).toHaveBeenCalledTimes(1)
  })
  it('refuses a changed order before any outward mutation and finishes the claim as not applied',async () => {
    const f=fixture(); await f.prepare()
    m.rest.mockImplementation(async (path:string) => path.includes('transactions') ? { transactions } : { order:{ ...live,updated_at:'changed' } })
    expect(await f.run()).toMatchObject({ status:'failed',result:{ error:'orderChanged' } })
    expect(m.refund).not.toHaveBeenCalled(); expect(m.cancel).not.toHaveBeenCalled(); expect(m.mirror).not.toHaveBeenCalled()
  })
  it('never updates the financial mirror or retries an uncertain transaction',async () => {
    const f=fixture(); await f.prepare()
    m.refund.mockResolvedValue({ ok:false,uncertain:true,refundId:'500',error:'refund_result_unverified' })
    expect(await f.run()).toMatchObject({ status:'uncertain',result:{ refund_id:'500' } })
    await f.run(); expect(m.refund).toHaveBeenCalledTimes(1)
    expect(m.mirror).not.toHaveBeenCalled()
  })
  it('checks dispatch state, permissions and pending refunds while preparing, without a provider mutation',async () => {
    const f=fixture()
    m.rest.mockResolvedValue({ order:{ ...live,fulfillment_status:'partial' } })
    await expect(caseOrderSnapshot(f.db,'ws','contact','local',{ type:'cancel',reason:'Customer request' })).rejects.toThrow('orderAlreadyShipped')
    m.rest.mockImplementation(async (path:string) => path.includes('transactions') ? { transactions:[...transactions,{ id:2,parent_id:1,kind:'refund',status:'pending',amount:'10.00',gateway:'card' }] } : { order:live })
    await expect(caseOrderSnapshot(f.db,'ws','contact','local',null)).rejects.toThrow('orderRefundPending')
    m.gql.mockResolvedValue({ currentAppInstallation:{ accessScopes:[] } })
    await expect(caseOrderSnapshot(f.db,'ws','contact','local',null)).rejects.toThrow('orderScopeMissing')
    expect(m.refund).not.toHaveBeenCalled(); expect(m.cancel).not.toHaveBeenCalled()
  })
  it('rejects a rounded conversion of an exact remaining balance before it can be approved',async () => {
    const f=fixture()
    m.rest.mockImplementation(async (path:string) => path.includes('transactions') ? { transactions:[{ ...transactions[0],amount:'99999999999999.123456' }] } : { order:live })
    await expect(caseOrderSnapshot(f.db,'ws','contact','local',null)).rejects.toThrow('orderBalanceUnknown')
  })
  it('does not prepare a financial action when the live provider customer no longer matches the contact',async () => {
    const f=fixture()
    m.rest.mockResolvedValue({ order:{ ...live,email:'someone-else@example.com' } })
    await expect(caseOrderSnapshot(f.db,'ws','contact','local',{ type:'refund',amount:25,reason:'Damage' })).rejects.toThrow('orderIdentityUnknown')
    expect(m.refund).not.toHaveBeenCalled()
  })
})
