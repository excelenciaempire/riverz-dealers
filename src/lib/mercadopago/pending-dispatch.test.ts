import { beforeEach, afterEach, expect, it, vi } from 'vitest'
vi.mock('./pending', async original => ({ ...await original<typeof import('./pending')>(), currentPendingPayment: vi.fn() }))
vi.mock('@/lib/shopify/contact-upsert', () => ({ upsertWhatsappContact: vi.fn() }))
vi.mock('@/lib/whatsapp/opt-out', () => ({ isOptedOut: vi.fn() }))
import { currentPendingPayment } from './pending'
import { upsertWhatsappContact } from '@/lib/shopify/contact-upsert'
import { isOptedOut } from '@/lib/whatsapp/opt-out'
import { dispatchPendingPayments } from './pending-dispatch'
import { sessionRunId } from '@/lib/automations/session-template'
const payment = {id:123,status:'pending',status_detail:'pending_waiting_payment',payment_type_id:'ticket',transaction_amount:100}
const row = { id:'queue',workspace_id:'ws',status:'pending',mp_payment_id:'123',payment_created_at:'2026-09-27T13:00:00Z',phone:'573001234567',payer_name:'Ana',email:'ana@example.com',dispatched_at:null as string|null }
const flow = { id:'flow',workspace_id:'ws',created_at:'2026-09-25T00:00:00Z',activation_requested_at:'2026-09-27T12:00:00Z' }
function fixture() {
  let failAck = false
  const rows = [{ ...row }]
  const logs: {id:string}[] = []
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = []
    let patch: Record<string, unknown> | null = null
    let ids: string[] | null = null
    const query = {
      select: () => query, not: () => query, order: () => query, limit: () => query,
      eq: (key:string,value:unknown) => {filters.push([key,value]);return query},
      is: (key:string,value:unknown) => {filters.push([key,value]);return query},
      in: (key:string,value:string[]) => {if(key==='id')ids=value;return query},
      update: (value:Record<string,unknown>) => {patch=value;return query},
      then: (resolve:(result:unknown)=>unknown) => {
        if(table==='automations')return Promise.resolve(resolve({data:[flow],error:null}))
        if(table==='automation_logs')return Promise.resolve(resolve({data:logs.filter(l=>!ids||ids.includes(l.id)),error:null}))
        const matching = rows.filter(r=>filters.every(([k,v])=>(r as Record<string,unknown>)[k]===v))
        if(patch){
          if(failAck&&patch.dispatched_at){failAck=false;return Promise.resolve(resolve({data:null,error:{message:'ack unavailable'}}))}
          matching.forEach(r=>Object.assign(r,patch))
        }
        return Promise.resolve(resolve({data:matching,error:null}))
      },
    }
    return query
  }
  const dispatch = vi.fn(async () => {
    const id=sessionRunId('ws','flow','payment_pending','buyer',{payment_id:'123'})
    if(!logs.some(l=>l.id===id))logs.push({id})
  })
  return { db:{from} as never,rows,logs,dispatch,failNextAck:()=>{failAck=true} }
}
beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(currentPendingPayment).mockResolvedValue(payment)
  vi.mocked(upsertWhatsappContact).mockResolvedValue('buyer')
  vi.mocked(isOptedOut).mockResolvedValue(false)
})
afterEach(()=>vi.restoreAllMocks())
it('webhook/cron overlap or acknowledgement retries enroll the same durable execution, not a new sequence',async()=>{
  const f=fixture();f.failNextAck()
  expect(await dispatchPendingPayments(f.db,f.dispatch)).toEqual({pending_enrolled:0,pending_failed:1})
  expect(await dispatchPendingPayments(f.db,f.dispatch)).toEqual({pending_enrolled:1,pending_failed:0})
  expect(await dispatchPendingPayments(f.db,f.dispatch)).toEqual({pending_enrolled:0,pending_failed:0})
  expect(f.logs).toHaveLength(1)
  expect(upsertWhatsappContact).toHaveBeenCalledWith(f.db,expect.objectContaining({isShopifyCustomer:false}))
})
it('does not blast payments from before activation even when the draft existed earlier',async()=>{
  const f=fixture();f.rows[0].payment_created_at='2026-09-27T11:00:00Z'
  await dispatchPendingPayments(f.db,f.dispatch)
  expect(f.dispatch).not.toHaveBeenCalled()
  expect(currentPendingPayment).not.toHaveBeenCalled()
  expect(f.rows[0].dispatched_at).toBeTruthy()
})
it('stops approved or expired payments before creating a contact or sending',async()=>{
  const f=fixture();vi.mocked(currentPendingPayment).mockResolvedValue({...payment,status:'approved'})
  await dispatchPendingPayments(f.db,f.dispatch)
  expect(f.dispatch).not.toHaveBeenCalled()
  expect(upsertWhatsappContact).not.toHaveBeenCalled()
})
it('keeps failures retryable, and acknowledges opt-outs so they cannot starve the queue',async()=>{
  const f=fixture();vi.mocked(currentPendingPayment).mockRejectedValueOnce(new Error('offline'))
  expect((await dispatchPendingPayments(f.db,f.dispatch)).pending_failed).toBe(1)
  expect(f.rows[0].dispatched_at).toBeNull()
  vi.mocked(isOptedOut).mockResolvedValue(true)
  await dispatchPendingPayments(f.db,f.dispatch)
  expect(f.dispatch).not.toHaveBeenCalled()
  expect(f.rows[0].dispatched_at).toBeTruthy()
})
