import { beforeEach,describe,expect,it,vi } from 'vitest'
const m=vi.hoisted(() => ({ context:vi.fn(),csrf:vi.fn(),view:vi.fn(),change:vi.fn() }))
vi.mock('@/lib/inbox/server-context',() => ({ inboxConversation:m.context }))
vi.mock('@/lib/csrf',() => ({ csrfGuard:m.csrf }))
vi.mock('@/lib/inbox/native-block-server',async importOriginal => ({ ...await importOriginal<object>(),nativeBlockView:m.view,changeNativeBlock:m.change }))
vi.mock('@/lib/rate-limit',() => ({ limitByKey:async() => ({ success:true }) }))
import { GET,POST } from './route'
import { NativeBlockContextError } from '@/lib/inbox/native-block-server'
const id='11111111-1111-4111-8111-111111111111',route={ params:Promise.resolve({ id }) }
const req=(body:unknown) => new Request('https://riverz.co/api/conversations/'+id+'/native-block',{ method:'POST',body:JSON.stringify(body) })
beforeEach(() => {
  vi.clearAllMocks();m.csrf.mockResolvedValue(null);m.context.mockResolvedValue({ workspaceId:'ws',userId:'user',conversation:{ id },isAdmin:true,t:(key:string) => key });m.view.mockResolvedValue({ available:true,blocked:false });m.change.mockResolvedValue({ operation:{ id,status:'completed' } })
})
describe('native blocking endpoint',() => {
  it('allows a private status read and rechecks access after provider IO',async() => {
    const r=await GET(req(null),route);expect(r.status).toBe(200);expect(r.headers.get('Cache-Control')).toContain('no-store');expect(m.context).toHaveBeenCalledTimes(2)
    m.context.mockResolvedValueOnce({ workspaceId:'ws',userId:'user',conversation:{ id },isAdmin:true,t:(key:string) => key }).mockResolvedValueOnce({ response:new Response(null,{ status:404 }) })
    expect((await GET(req(null),route)).status).toBe(404)
  })
  it('rejects CSRF and nonadmins before processing',async() => {
    m.csrf.mockResolvedValue(new Response(null,{ status:403 }));expect((await POST(req({ id,action:'execute' }),route)).status).toBe(403)
    m.csrf.mockResolvedValue(null);m.context.mockResolvedValue({ isAdmin:false,t:(key:string) => key });expect((await POST(req({ id,action:'execute' }),route)).status).toBe(403);expect(m.change).not.toHaveBeenCalled()
  })
  it('never accepts a caller recipient, workspace or provider URL',async() => {
    for (const extra of ['recipient','workspace_id','url']) expect((await POST(req({ id,action:'prepare',blocked:true,[extra]:'override' }),route)).status).toBe(400)
    expect(m.change).not.toHaveBeenCalled()
  })
  it('returns a localized conflict and billing restriction without exposing raw database errors',async() => {
    m.change.mockRejectedValue(new NativeBlockContextError('native_block_locked'));const conflict=await POST(req({ id,action:'execute' }),route);expect(conflict.status).toBe(409);expect(await conflict.json()).toEqual({ error:'nativeBlockChanged' })
    m.change.mockRejectedValue(new NativeBlockContextError('subscription_read_only'));expect((await POST(req({ id,action:'execute' }),route)).status).toBe(402)
  })
  it('withholds a mutation receipt if the current workspace changed before response',async() => {
    m.context.mockResolvedValueOnce({ workspaceId:'ws',userId:'user',conversation:{ id },isAdmin:true,t:(key:string) => key }).mockResolvedValueOnce({ workspaceId:'other' })
    expect((await POST(req({ id,action:'execute' }),route)).status).toBe(404)
  })
})
