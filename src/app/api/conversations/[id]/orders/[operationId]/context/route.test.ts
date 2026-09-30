import { beforeEach,describe,expect,it,vi } from 'vitest'
const m=vi.hoisted(() => ({ context:vi.fn(),snapshot:vi.fn() }))
vi.mock('@/lib/inbox/server-context',() => ({ inboxConversation:m.context }))
vi.mock('@/lib/inbox/order-actions',() => ({ caseOrderSnapshot:m.snapshot,CaseOrderError:class extends Error {} }))
import { GET } from './route'
import { CaseOrderError } from '@/lib/inbox/order-actions'
const order='22222222-2222-4222-8222-222222222222'
const route={ params:Promise.resolve({ id:'conversation',operationId:order }) }
const address={ address1:'20 Main St',address2:'',city:'Austin',province:'Texas',zip:'78701',countryCode:'US' }
beforeEach(() => {
  m.context.mockReset().mockResolvedValue({ db:{ marker:'service' },workspaceId:'workspace',conversation:{ contact_id:'contact' },t:(key:string) => 'localized:'+key })
  m.snapshot.mockReset().mockResolvedValue({ preview:{ shipping_address:address },live:{ cancelled_at:null,fulfillment_status:null,fulfillments:[] } })
})
describe('authorized order address context',() => {
  it('keeps conversation and personal-mailbox denials before any provider query',async () => {
    m.context.mockResolvedValue({ response:Response.json({ error:'denied' },{ status:403 }) })
    expect((await GET(new Request('https://riverz.co/api/test'),route)).status).toBe(403)
    expect(m.snapshot).not.toHaveBeenCalled()
  })
  it('binds the local order to the authorized workspace and contact and never caches address data',async () => {
    const r=await GET(new Request('https://riverz.co/api/test'),route)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ shipping_address:address,can_modify:true })
    expect(r.headers.get('cache-control')).toBe('private, no-store')
    expect(m.snapshot).toHaveBeenCalledWith({ marker:'service' },'workspace','contact',order,null,{ shippingOnly:true })
  })
  it('rejects provider identifiers and localizes mismatched customer identity',async () => {
    expect((await GET(new Request('https://riverz.co/api/test'),{ params:Promise.resolve({ id:'conversation',operationId:'100' }) })).status).toBe(404)
    expect(m.snapshot).not.toHaveBeenCalled()
    m.snapshot.mockRejectedValue(new CaseOrderError('orderIdentityUnknown'))
    const r=await GET(new Request('https://riverz.co/api/test'),route)
    expect(r.status).toBe(409); expect(await r.json()).toEqual({ error:'localized:orderIdentityUnknown' })
  })
  it('exposes the current address but disables a dispatched order',async () => {
    m.snapshot.mockResolvedValue({ preview:{ shipping_address:address },live:{ fulfillment_status:'partial' } })
    expect(await (await GET(new Request('https://riverz.co/api/test'),route)).json()).toEqual({ shipping_address:address,can_modify:false })
  })
})
