import { beforeEach,describe,expect,it,vi } from 'vitest'
const mocks=vi.hoisted(() => ({ rpc:vi.fn(),context:vi.fn(),csrf:vi.fn() }))
vi.mock('@/lib/inbox/server-context',() => ({ inboxConversation:mocks.context }))
vi.mock('@/lib/i18n/server',() => ({ getLocale:async() => 'en' }))
vi.mock('@/lib/i18n/translate',() => ({ translate:(_locale:string,key:string) => key }))
vi.mock('@/lib/ai/gap-knowledge-server',() => ({ gapHeaders:{ 'Cache-Control':'private, no-store' },gapError:(e:{message:string}) => Response.json({ error:e.message },{ status:e.message==='gap_changed' ? 409 : 404 }) }))
vi.mock('@/lib/csrf',() => ({ csrfGuard:mocks.csrf }))
import { GET,POST } from './route'
const workspace='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',conversation='44444444-4444-4444-8444-444444444444',gap='55555555-5555-4555-8555-555555555555',id='77777777-7777-4777-8777-777777777777'
const input={ id,gap_id:gap,expected_revision:0,answer:'Only this case' },params={ params:Promise.resolve({ id:conversation }) },ctx={ db:{ rpc:mocks.rpc },workspaceId:workspace,userId:actor,conversation:{ id:conversation } }
const read=() => GET(new Request('https://riverz.co/'),params)
const write=(body:unknown=input) => POST(new Request('https://riverz.co/',{ method:'POST',body:JSON.stringify(body) }),params)
beforeEach(() => { vi.clearAllMocks();mocks.context.mockResolvedValue(ctx);mocks.csrf.mockResolvedValue(null);mocks.rpc.mockResolvedValue({ data:[],error:null }) })
describe('current-access, case-only team answer API',() => {
 it('reads only the authorized case and reports its sampling limit without caching',async() => {
  mocks.rpc.mockResolvedValue({ data:Array.from({ length:51 },(_,i) => ({ gap_id:`gap-${i}` })),error:null })
  const r=await read(),body=await r.json();expect(body.questions).toHaveLength(50);expect(body.truncated).toBe(true);expect(r.headers.get('Cache-Control')).toContain('no-store')
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('list_case_gap_answers',{ p_workspace_id:workspace,p_actor_id:actor,p_conversation_id:conversation });expect(mocks.context).toHaveBeenCalledTimes(2)
 })
 it('fails closed if the workspace or case access changes after reading',async() => {
  mocks.context.mockResolvedValueOnce(ctx).mockResolvedValueOnce({ ...ctx,workspaceId:'changed' });expect((await read()).status).toBe(409)
  mocks.context.mockResolvedValueOnce(ctx).mockResolvedValueOnce({ response:Response.json({}, { status:404 }) });expect((await read()).status).toBe(404)
 })
 it('saves the exact receipt and version under the authenticated context, without publishing or sending',async() => {
  mocks.rpc.mockResolvedValue({ data:{ ok:true,scope:'case_only',revision:1 },error:null });const r=await write();expect(await r.json()).toMatchObject({ ok:true,scope:'case_only' })
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('save_case_gap_answer',{ p_id:id,p_workspace_id:workspace,p_actor_id:actor,p_conversation_id:conversation,p_gap_id:gap,p_expected_revision:0,p_answer:input.answer })
 })
 it('does not retry a conflict or invent success',async() => {
  mocks.rpc.mockResolvedValue({ data:null,error:{ message:'gap_changed' } });expect((await write()).status).toBe(409);expect(mocks.rpc).toHaveBeenCalledTimes(1)
 })
 it('denies arbitrary caller scope and oversized answers before RPC',async() => {
  for (const body of [{ ...input,workspace_id:workspace },{ ...input,answer:'a'.repeat(2001) },{ ...input,expected_revision:undefined }]) expect((await write(body)).status).toBe(400)
  expect(mocks.rpc).not.toHaveBeenCalled()
 })
 it('preserves CSRF and authenticated case denials before database work',async() => {
  mocks.csrf.mockResolvedValue(Response.json({}, { status:403 }));expect((await write()).status).toBe(403);expect(mocks.context).not.toHaveBeenCalled()
  mocks.csrf.mockResolvedValue(null);mocks.context.mockResolvedValue({ response:Response.json({}, { status:404 }) });expect((await write()).status).toBe(404);expect(mocks.rpc).not.toHaveBeenCalled()
 })
})
