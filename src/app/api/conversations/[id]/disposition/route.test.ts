import { beforeEach,describe,expect,it,vi } from 'vitest'
const m=vi.hoisted(() => ({ context:vi.fn(),csrf:vi.fn(),rpc:vi.fn() }))
vi.mock('@/lib/inbox/server-context',() => ({ inboxConversation:m.context }))
vi.mock('@/lib/csrf',() => ({ csrfGuard:m.csrf }))
import { GET,POST } from './route'
import { POST as READ } from '../read/route'
import { isBusinessMutation } from '@/lib/billing/read-only'
const id='11111111-1111-4111-8111-111111111111'
const route={ params:Promise.resolve({ id }) }
const request=(body:unknown) => new Request('https://riverz.co/api/conversations/'+id+'/disposition',{ method:'POST',body:JSON.stringify(body) })
const input={ id,action:'unread',expected_version:2 }
beforeEach(() => {
  vi.clearAllMocks();m.csrf.mockResolvedValue(null);m.rpc.mockResolvedValue({ data:{ manual_unread:true,is_spam:false,version:3 },error:null })
  m.context.mockResolvedValue({ db:{ rpc:m.rpc },workspaceId:'server-ws',userId:'server-user',conversation:{ id,manual_unread:false,is_spam:false,inbox_control_version:2 },t:(k:string) => k })
})
describe('case disposition authorization',() => {
  it('derives tenant and actor from authenticated context, returning a private result',async() => {
    const r=await POST(request(input),route)
    expect(r.status).toBe(200);expect(r.headers.get('Cache-Control')).toContain('no-store')
    expect(m.rpc).toHaveBeenCalledWith('set_inbox_disposition',{ p_id:id,p_workspace_id:'server-ws',p_conversation_id:id,p_actor_id:'server-user',p_action:'unread',p_expected_version:2 })
    const view=await GET(request(null),route);expect(await view.json()).toEqual({ manual_unread:false,is_spam:false,version:2 })
  })
  it('rejects tenant/body overrides, CSRF and inaccessible cases without an RPC',async() => {
    expect((await POST(request({ ...input,user_id:'other' }),route)).status).toBe(400)
    m.csrf.mockResolvedValue(new Response(null,{ status:403 }));expect((await POST(request(input),route)).status).toBe(403)
    m.csrf.mockResolvedValue(null);m.context.mockResolvedValue({ response:new Response(null,{ status:404 }) });expect((await POST(request(input),route)).status).toBe(404)
    expect(m.rpc).not.toHaveBeenCalled()
  })
  it('lets the billing exception read only, never spam, restore or unread',async() => {
    expect(isBusinessMutation('/api/conversations/'+id+'/read','POST')).toBe(false)
    expect(isBusinessMutation('/api/conversations/'+id+'/disposition','POST')).toBe(true)
    for (const action of ['unread','spam','restore']) expect((await READ(request({ ...input,action }),route)).status).toBe(400)
    expect(m.rpc).not.toHaveBeenCalled()
    expect((await READ(request({ ...input,action:'read' }),route)).status).toBe(200)
  })
  it('exposes conflicts without reapplying and preserves the billing edit gate',async() => {
    for (const [message,status] of [['inbox_disposition_changed',409],['inbox_disposition_conflict',409],['subscription_read_only',402],['invalid_inbox_disposition',404]] as const) {
      m.rpc.mockResolvedValue({ error:{ message } });expect((await POST(request(input),route)).status).toBe(status)
    }
    expect(m.rpc).toHaveBeenCalledTimes(4)
  })
})
