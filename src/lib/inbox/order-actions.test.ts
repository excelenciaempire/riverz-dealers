import { beforeEach,describe,it,expect,vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CaseOrderOperation } from './order-action-contract'
const m=vi.hoisted(() => ({ rest:vi.fn(),gql:vi.fn(),refund:vi.fn(),cancel:vi.fn(),mirror:vi.fn() }))
vi.mock('@/lib/shopify/order-tags',() => ({ resolveShopifyAdmin:async () => ({ shopDomain:'test.myshopify.com',accessToken:'test',apiVersion:'2025-10' }) }))
vi.mock('@/lib/shopify/admin-client',() => ({ ShopifyAdminClient:class { rest=m.rest; graphql=m.gql } }))
vi.mock('@/lib/shopify/order-cancel',() => ({ refundOrder:m.refund,cancelOrder:m.cancel }))
import { caseOrderSnapshot,executeCaseOrderAction } from './order-actions'
const live={ id:100,name:'#100',updated_at:'2026-09-30',currency:'USD',financial_status:'paid',fulfillment_status:null,cancelled_at:null,total_price:'100.00',fulfillments:[],email:'customer@example.com' }
const transactions=[{ id:1,kind:'sale',status:'success',amount:'100.00',gateway:'card' }]
function fixture() {
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
      maybeSingle:async () => ({ data:table === 'contacts' ? { email:'customer@example.com',phone:null } : { id:'local',shopify_order_id:'100',shop_domain:'test.myshopify.com',order_number:'#100',platform:'shopify' },error:null }),
      then:(done:(value:unknown) => unknown) => Promise.resolve({ error:null }).then(done) }
    return q
  } } as unknown as SupabaseClient
  const prepare=async () => {
    const snapshot=await caseOrderSnapshot(db,'ws','contact','local',{ type:'refund',amount:25,reason:'Damage' })
    operation={ id:'op',order_id:'local',requested_by:'agent',approved_by:'admin',action:{ type:'refund',amount:25,reason:'Damage' },preview:snapshot.preview,fingerprint:snapshot.fingerprint,
      status:'preview',expires_at:'2026-10-01',created_at:'2026-09-30',approved_at:null,result:null }
  }
  return { db,rpc,prepare,run:() => executeCaseOrderAction(db,'ws','conv','contact','admin','op') }
}
beforeEach(() => {
  m.rest.mockReset().mockImplementation(async (path:string) => path.includes('transactions') ? { transactions } : { order:{ ...live } })
  m.gql.mockReset().mockResolvedValue({ currentAppInstallation:{ accessScopes:[{ handle:'write_orders' }] } })
  m.refund.mockReset(); m.cancel.mockReset(); m.mirror.mockReset()
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
