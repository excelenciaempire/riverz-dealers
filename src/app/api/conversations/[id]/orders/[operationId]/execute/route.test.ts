import { beforeEach,describe,it,expect,vi } from 'vitest'
const m=vi.hoisted(() => ({ context:vi.fn(),execute:vi.fn(),csrf:vi.fn() }))
vi.mock('@/lib/csrf',() => ({ csrfGuard:m.csrf }))
vi.mock('@/lib/inbox/server-context',() => ({ inboxConversation:m.context }))
vi.mock('@/lib/inbox/order-actions',() => ({ executeCaseOrderAction:m.execute,CaseOrderError:class extends Error {} }))
import { POST } from './route'
const route={ params:Promise.resolve({ id:'case',operationId:'11111111-1111-4111-8111-111111111111' }) }
const request=(body:unknown) => new Request('https://riverz.co/api/conversations/case/orders/op/execute',{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify(body) })
beforeEach(() => { m.execute.mockReset(); m.csrf.mockReset().mockResolvedValue(null); m.context.mockReset().mockResolvedValue({ isAdmin:true,db:{},workspaceId:'ws',userId:'actor',conversation:{ contact_id:'contact' },t:(key:string) => key }) })
describe('explicit human financial confirmation',() => {
  it('refuses an agent, a CSRF rejection and a private or foreign conversation before dispatch',async () => {
    m.context.mockResolvedValueOnce({ isAdmin:false,t:(key:string) => key })
    expect((await POST(request({ confirmed:true }),route)).status).toBe(403)
    m.csrf.mockResolvedValueOnce(Response.json({ error:'CSRF' },{ status:403 }))
    expect((await POST(request({ confirmed:true }),route)).status).toBe(403)
    m.context.mockResolvedValueOnce({ response:Response.json({ error:'Not found' },{ status:404 }) })
    expect((await POST(request({ confirmed:true }),route)).status).toBe(404)
    expect(m.execute).not.toHaveBeenCalled()
  })
  it('never treats a truthy string or a replacement amount as confirmation of the stored preview',async () => {
    for (const body of [{ confirmed:'true' },{ confirmed:false },{ confirmed:true,amount:100 },{}]) expect((await POST(request(body),route)).status).toBe(400)
    expect(m.execute).not.toHaveBeenCalled()
  })
  it('returns the durable result and does not call an uncertain outcome completed',async () => {
    m.execute.mockResolvedValue({ status:'uncertain',id:'op' })
    expect((await POST(request({ confirmed:true }),route)).status).toBe(409)
    expect(m.execute).toHaveBeenCalledWith({},'ws','case','contact','actor','11111111-1111-4111-8111-111111111111')
  })
})
