import { beforeEach,describe,expect,it,vi } from 'vitest'
const mocks=vi.hoisted(() => ({ rpc:vi.fn(),session:vi.fn(),from:vi.fn(),csrf:vi.fn() }))
vi.mock('@/lib/ai/gap-knowledge-server',() => ({ gapSession:mocks.session,gapHeaders:{ 'Cache-Control':'private, no-store' },gapError:(e:{message:string}) => Response.json({ error:e.message },{ status:502 }) }))
vi.mock('@/lib/csrf',() => ({ csrfGuard:mocks.csrf }))
import { GET,PATCH } from './route'
const ctx={ workspaceId:'active-store',userId:'current-member',isAdmin:true,t:(k:string) => k,db:{ rpc:mocks.rpc },client:{ from:mocks.from } }
const row={ id:'gap',question:'Delivery?',question_key:'delivery',missing:'Date',conversation_id:'case',created_at:'2026-09-30T10:00:00Z' }
beforeEach(() => {
 vi.clearAllMocks();mocks.csrf.mockResolvedValue(null);mocks.session.mockResolvedValue(ctx);mocks.rpc.mockResolvedValue({ data:[row,{ ...row,id:'gap-2' }],error:null })
 const q={ select:() => q,eq:() => q,order:() => q,limit:async() => ({ data:[],error:null }) };mocks.from.mockReturnValue(q)
})
describe('private current-store knowledge gaps',() => {
 it('groups accessible occurrences only and reads history through the authenticated RLS client',async() => {
  const r=await GET(new Request('https://riverz.co/api/huecos'));expect(r.status).toBe(200);expect((await r.json()).gaps).toEqual([{ key:'delivery',question:'Delivery?',veces:2,ultima:row.created_at,missing:'Date',conversation_id:'case' }]);expect(mocks.rpc).toHaveBeenCalledWith('list_visible_answer_gaps',{ p_workspace_id:'active-store',p_actor_id:'current-member',p_resolved:false });expect(mocks.from).toHaveBeenCalledWith('gap_knowledge_reviews');expect(r.headers.get('Cache-Control')).toContain('no-store')
 })
 it('reports the real 500-record sample limit',async() => {
  mocks.rpc.mockResolvedValue({ data:Array.from({length:501},(_,i) => ({ ...row,id:String(i) })),error:null });expect(await (await GET(new Request('https://riverz.co/api/huecos'))).json()).toMatchObject({ truncated:true,gaps:[{ veces:500 }] })
 })
 it('does not return data if the store changed while reading',async() => {
  mocks.session.mockResolvedValueOnce(ctx).mockResolvedValueOnce({ ...ctx,workspaceId:'another-store' });expect((await GET(new Request('https://riverz.co/api/huecos'))).status).toBe(409)
 })
 it('does not turn database errors into an empty successful list',async() => {
  mocks.rpc.mockResolvedValue({ data:null,error:{ message:'read_failed' } });expect((await GET(new Request('https://riverz.co/api/huecos'))).status).toBe(502)
 })
 it('requires an actual resolution receipt in the authorized current context',async() => {
  mocks.rpc.mockResolvedValue({ data:2,error:null });const r=await PATCH(new Request('https://riverz.co/api/huecos',{ method:'PATCH',body:JSON.stringify({ key:'delivery' }) }));expect(await r.json()).toEqual({ ok:true,resolved_count:2 });expect(mocks.rpc).toHaveBeenCalledWith('resolve_visible_answer_gaps',{ p_workspace_id:'active-store',p_actor_id:'current-member',p_key:'delivery' })
 })
})
