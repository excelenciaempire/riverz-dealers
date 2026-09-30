import { beforeEach,describe,expect,it,vi } from 'vitest'
const mocks=vi.hoisted(() => ({ session:vi.fn(),csrf:vi.fn(),single:vi.fn(),history:vi.fn(),rpc:vi.fn(),from:vi.fn(),eq:vi.fn() }))
vi.mock('@/lib/inbox/server-context',() => ({ inboxSession:mocks.session }))
vi.mock('@/lib/csrf',() => ({ csrfGuard:mocks.csrf }))
vi.mock('@/lib/i18n/server',() => ({ getLocale:async() => 'en' }))
vi.mock('@/lib/i18n/translate',() => ({ translate:(_locale:string,key:string) => key }))
import { GET,POST } from './route'
const ws='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',agent='44444444-4444-4444-8444-444444444444',receipt='77777777-7777-4777-8777-777777777777',policy={ ig_comment:{ crear_pedido:'aprobacion' } }
const ctx={ workspaceId:ws,userId:actor,isAdmin:true,db:{ from:mocks.from,rpc:mocks.rpc } },params={ params:Promise.resolve({ id:agent }) },input={ id:receipt,expected_revision:1,policy }
const write=(body:unknown=input) => POST(new Request('https://riverz.co/',{ method:'POST',body:JSON.stringify(body) }),params),read=() => GET(new Request('https://riverz.co/'),params)
beforeEach(() => {
 vi.clearAllMocks();mocks.session.mockResolvedValue(ctx);mocks.csrf.mockResolvedValue(null);mocks.single.mockResolvedValue({ data:{ id:agent,revision:1,policy },error:null });mocks.history.mockResolvedValue({ data:[],error:null });mocks.rpc.mockResolvedValue({ data:{ ok:true,revision:2,policy },error:null })
 const q:Record<string,unknown>={ select:() => q,eq:mocks.eq,is:() => q,order:() => q,maybeSingle:mocks.single,limit:mocks.history };mocks.eq.mockReturnValue(q);mocks.from.mockReturnValue(q)
})
describe('current-admin context policy adapter',() => {
 it('uses the authenticated business and author with strict versioned input',async() => {
  expect((await write()).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('save_ai_tool_context_policy',{ p_id:receipt,p_workspace_id:ws,p_actor_id:actor,p_agent_id:agent,p_expected_revision:1,p_policy:policy })
 })
 it('preserves CSRF and current role denials before mutating policy',async() => {
  mocks.csrf.mockResolvedValueOnce(Response.json({}, { status:403 }));expect((await write()).status).toBe(403);expect(mocks.session).not.toHaveBeenCalled();mocks.session.mockResolvedValueOnce({ ...ctx,isAdmin:false });expect((await write()).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled()
 })
 it('rejects global enabling, unknown tools and caller scope before database mutation',async() => {
  for (const body of [{ ...input,workspace_id:ws },{ ...input,policy:{ whatsapp:{ reembolsar:'auto' } } },{ ...input,policy:{ whatsapp:{ lookup_order:'aprobacion' } } },{ ...input,policy:{ whatsapp:{ unknown:'off' } } },{ ...input,expected_revision:-1 }]) expect((await write(body)).status).toBe(400)
  expect(mocks.rpc).not.toHaveBeenCalled()
 })
 it('reports conflicts and read-only state without retries',async() => {
  mocks.rpc.mockResolvedValueOnce({ data:null,error:{ message:'tool_context_changed' } });expect((await write()).status).toBe(409);mocks.rpc.mockResolvedValueOnce({ data:null,error:{ message:'subscription_read_only' } });expect((await write()).status).toBe(402);expect(mocks.rpc).toHaveBeenCalledTimes(2)
 })
 it('reads bounded history with fresh access and distinguishes absent configuration',async() => {
  mocks.single.mockResolvedValueOnce({ data:{ id:agent },error:null }).mockResolvedValueOnce({ data:null,error:null }).mockResolvedValueOnce({ data:{ id:agent },error:null });mocks.history.mockResolvedValueOnce({ data:Array.from({ length:21 },(_,revision) => ({ revision })),error:null });const r=await read(),body=await r.json();expect(body).toMatchObject({ revision:0,policy:{},can_edit:true,truncated:true });expect(body.history).toHaveLength(20);expect(r.headers.get('Cache-Control')).toContain('no-store');expect(mocks.session).toHaveBeenCalledTimes(2)
 })
 it('does not return policies after workspace or assistant access changes',async() => {
  mocks.session.mockResolvedValueOnce(ctx).mockResolvedValueOnce({ ...ctx,workspaceId:agent });expect((await read()).status).toBe(404)
  mocks.single.mockResolvedValueOnce({ data:null,error:null });expect((await write()).status).toBe(404);expect(mocks.rpc).not.toHaveBeenCalled()
 })
})
