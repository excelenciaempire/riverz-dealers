import { beforeEach,describe,it,expect,vi } from 'vitest'
const m=vi.hoisted(() => ({ context:vi.fn(),execute:vi.fn(),csrf:vi.fn(),stored:vi.fn(),filters:vi.fn() }))
vi.mock('@/lib/csrf',() => ({ csrfGuard:m.csrf }))
vi.mock('@/lib/inbox/server-context',() => ({ inboxConversation:m.context }))
vi.mock('@/lib/inbox/order-actions',() => ({ executeCaseOrderAction:m.execute,CaseOrderError:class extends Error {} }))
import { POST } from './route'
const route={ params:Promise.resolve({ id:'case',operationId:'11111111-1111-4111-8111-111111111111' }) }
const request=(body:unknown) => new Request('https://riverz.co/api/conversations/case/orders/op/execute',{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify(body) })
beforeEach(() => {
  const q={ select:() => q,eq:(...args:unknown[]) => { m.filters(...args); return q },maybeSingle:m.stored }
  m.stored.mockReset().mockResolvedValue({ data:{ action:{ type:'refund' } },error:null }); m.filters.mockReset()
  m.execute.mockReset(); m.csrf.mockReset().mockResolvedValue(null)
  m.context.mockReset().mockResolvedValue({ isAdmin:true,db:{ from:() => q },workspaceId:'ws',userId:'actor',conversation:{ contact_id:'contact' },t:(key:string) => key })
})
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
    expect(m.execute).toHaveBeenCalledWith(expect.anything(),'ws','case','contact','actor','11111111-1111-4111-8111-111111111111')
  })
  it('requires a client that reviewed a replacement, and checks the persisted kind in the authorized case',async () => {
    m.stored.mockResolvedValue({ data:{ action:{ type:'replacement' } },error:null })
    for (const body of [{ confirmed:true },{ confirmed:true,action_type:'refund' }]) expect((await POST(request(body),route)).status).toBe(409)
    expect(m.execute).not.toHaveBeenCalled()
    m.execute.mockResolvedValue({ status:'completed' })
    expect((await POST(request({ confirmed:true,action_type:'replacement' }),route)).status).toBe(200)
    expect(m.execute).toHaveBeenCalledTimes(1)
    expect(m.filters).toHaveBeenCalledWith('workspace_id','ws'); expect(m.filters).toHaveBeenCalledWith('conversation_id','case')
  })
  it('refuses a missing, unreadable or changed operation before claiming it',async () => {
    for (const result of [{ data:null,error:null },{ data:{ action:{ type:'refund' } },error:{ message:'read failed' } },{ data:{ action:{ type:'cancel' } },error:null }]) {
      m.stored.mockResolvedValue(result)
      expect((await POST(request({ confirmed:true,action_type:'refund' }),route)).status).toBe(409)
    }
    expect(m.execute).not.toHaveBeenCalled()
  })
  it('requires a hold-aware confirmation before claiming a hold operation',async () => {
    m.stored.mockResolvedValue({ data:{ action:{ type:'hold' } },error:null })
    expect((await POST(request({ confirmed:true }),route)).status).toBe(409)
    expect(m.execute).not.toHaveBeenCalled()
    m.execute.mockResolvedValue({ status:'completed' })
    expect((await POST(request({ confirmed:true,action_type:'hold' }),route)).status).toBe(200)
  })
  it('requires a credit-aware confirmation and never interprets an old refund confirmation as credit consent',async () => {
    m.stored.mockResolvedValue({ data:{ action:{ type:'credit' } },error:null })
    expect((await POST(request({ confirmed:true }),route)).status).toBe(409)
    expect((await POST(request({ confirmed:true,action_type:'refund' }),route)).status).toBe(409)
    expect(m.execute).not.toHaveBeenCalled()
    m.execute.mockResolvedValue({ status:'completed' })
    expect((await POST(request({ confirmed:true,action_type:'credit' }),route)).status).toBe(200)
  })
})
