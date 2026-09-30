import { beforeEach,describe,it,expect,vi } from 'vitest'
const m=vi.hoisted(() => ({ context:vi.fn(),snapshot:vi.fn(),rpc:vi.fn(),csrf:vi.fn() }))
vi.mock('@/lib/csrf',() => ({ csrfGuard:m.csrf }))
vi.mock('@/lib/inbox/server-context',() => ({ inboxConversation:m.context }))
vi.mock('@/lib/inbox/order-actions',() => ({ uncertainCaseOrderSnapshot:m.snapshot,CaseOrderError:class extends Error {} }))
import { GET,POST } from './route'
const source='11111111-1111-4111-8111-111111111111', order='22222222-2222-4222-8222-222222222222', fingerprint='a'.repeat(64)
const route={ params:Promise.resolve({ id:'conversation',operationId:order }) }
const body={ source_id:source,fingerprint,confirmed:true,reason:'Verified in Shopify' }
const request=(data:unknown=body) => new Request('https://riverz.co/api/test',{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify(data) })
beforeEach(() => {
  m.context.mockReset().mockResolvedValue({ db:{ rpc:m.rpc },isAdmin:true,workspaceId:'ws',userId:'admin',conversation:{ id:'conversation',contact_id:'contact' },t:(key:string) => key })
  m.snapshot.mockReset().mockResolvedValue({ source_id:source,action_type:'refund',snapshot:{ fingerprint,preview:{ amount:'25.00',currency:'USD' } } })
  m.rpc.mockReset().mockResolvedValue({ data:{ id:'review' },error:null }); m.csrf.mockReset().mockResolvedValue(null)
})
describe('reconciliation of the actual reviewed operation',() => {
  it('exposes the actual kind with uncached facts, retaining legacy financial confirmation',async () => {
    const r=await GET(request(),route)
    expect(r.headers.get('cache-control')).toBe('private, no-store'); expect(await r.json()).toMatchObject({ action_type:'refund',fingerprint })
    expect((await POST(request(),route)).status).toBe(200)
    expect(m.rpc).toHaveBeenCalledWith('review_order_execution',expect.objectContaining({ p_actor_id:'admin',p_snapshot:{ amount:'25.00',currency:'USD',action_type:'refund',fingerprint } }))
  })
  it('requires a client that showed the correct address, items, replacement or hold review',async () => {
    for (const kind of ['address','items','replacement','hold']) {
      m.snapshot.mockResolvedValue({ source_id:source,action_type:kind,snapshot:{ fingerprint,preview:{} } })
      expect((await POST(request(),route)).status).toBe(409)
      expect((await POST(request({ ...body,action_type:'refund' }),route)).status).toBe(409)
      expect(m.rpc).not.toHaveBeenCalled()
      expect((await POST(request({ ...body,action_type:kind }),route)).status).toBe(200)
      m.rpc.mockClear()
    }
  })
  it('refuses changed facts, identifiers, permissions, truthy confirmation and arbitrary provider arguments',async () => {
    for (const changed of [{ ...body,confirmed:'true' },{ ...body,reason:'' },{ ...body,hold_ids:['foreign'] }]) expect((await POST(request(changed),route)).status).toBe(400)
    m.snapshot.mockResolvedValue({ source_id:source,action_type:'refund',snapshot:{ fingerprint:'b'.repeat(64),preview:{} } })
    expect((await POST(request(),route)).status).toBe(409)
    m.context.mockResolvedValueOnce({ isAdmin:false,t:(key:string) => key }); expect((await POST(request(),route)).status).toBe(403)
    m.csrf.mockResolvedValueOnce(Response.json({}, { status:403 })); expect((await POST(request(),route)).status).toBe(403)
    expect(m.rpc).not.toHaveBeenCalled()
  })
})
