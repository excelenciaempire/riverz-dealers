import { beforeEach,describe,expect,it,vi } from 'vitest'
const mocks=vi.hoisted(() => ({ rpc:vi.fn(),session:vi.fn(),from:vi.fn(),csrf:vi.fn() }))
vi.mock('@/lib/ai/gap-knowledge-server',() => ({ gapSession:mocks.session,gapHeaders:{ 'Cache-Control':'private, no-store' },gapError:(e:{message:string}) => Response.json({ error:e.message },{ status:e.message==='gap_changed' ? 409 : e.message==='invalid_gap_context' ? 404 : 502 }) }))
vi.mock('@/lib/csrf',() => ({ csrfGuard:mocks.csrf }))
import { POST } from './route'
const ws='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',product='66666666-6666-4666-8666-666666666666',gap='55555555-5555-4555-8555-555555555555',review='77777777-7777-4777-8777-777777777777'
const input={ action:'preview',key:'delivery',question:'Delivery?',answer:'Only confirmed dates',product_id:product }
const ctx={ db:{ from:mocks.from,rpc:mocks.rpc },workspaceId:ws,userId:actor,isAdmin:true,locale:'en',t:(k:string) => k }
const request=(body:unknown) => POST(new Request('https://riverz.co/api/huecos/responder',{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify(body) }))
beforeEach(() => {
 vi.clearAllMocks();mocks.csrf.mockResolvedValue(null);mocks.session.mockResolvedValue(ctx)
 mocks.rpc.mockImplementation(async(name:string) => name==='list_visible_answer_gaps' ? { data:[{ id:gap,question_key:'delivery',question:'Delivery?' }],error:null } : name==='prepare_gap_knowledge_review' ? { data:{ id:review },error:null } : { data:{ ok:true },error:null })
 const q={ select:() => q,eq:() => q,maybeSingle:async() => ({ data:{ id:product,workspace_id:ws,title:'Existing product',description:'Keep this',custom_faqs:[] },error:null }) };mocks.from.mockReturnValue(q)
})
describe('authorized review before supervised publication',() => {
 it('prepares the existing product destination by default without publishing or resolving',async() => {
  const r=await request(input);expect(r.status).toBe(200);expect(await r.json()).toEqual({ review:{ id:review } });expect(r.headers.get('Cache-Control')).toContain('no-store')
  const args=mocks.rpc.mock.calls.find(c => c[0]==='prepare_gap_knowledge_review')![1];expect(args).toMatchObject({ p_workspace_id:ws,p_actor_id:actor,p_destination:'producto',p_source_ids:[gap],p_expected:{ id:product },p_prepared:{ custom_faqs:[{ q:input.question,a:input.answer }] } });expect(args.p_prepared.training_material).toContain('Keep this');expect(mocks.rpc.mock.calls.some(c => c[0]==='confirm_gap_knowledge_review')).toBe(false)
 })
 it('prepares an account-wide rule only for an administrator without requiring a product',async() => {
  const q={ select:() => q,eq:() => q,maybeSingle:async() => ({ data:null,error:null }) };mocks.from.mockReturnValue(q)
  expect((await request({ ...input,destino:'regla',product_id:'' })).status).toBe(200)
  expect(mocks.rpc.mock.calls.find(c => c[0]==='prepare_gap_knowledge_review')![1]).toMatchObject({ p_destination:'regla',p_target_id:null,p_expected:null,p_prepared:{} })
  mocks.session.mockResolvedValue({ ...ctx,isAdmin:false });mocks.rpc.mockClear();expect((await request({ ...input,destino:'regla' })).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled()
 })
 it('rejects missing, foreign or changed source questions before preparing knowledge',async() => {
  expect((await request({ ...input,question:'Different question' })).status).toBe(404);expect(mocks.rpc.mock.calls.some(c => c[0]==='prepare_gap_knowledge_review')).toBe(false)
  mocks.rpc.mockResolvedValue({ data:[],error:null });expect((await request(input)).status).toBe(404)
 })
 it('confirms only the exact receipt in the active session context',async() => {
  expect((await request({ action:'confirm',review_id:review })).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('confirm_gap_knowledge_review',{ p_workspace_id:ws,p_actor_id:actor,p_review_id:review })
 })
 it('does not retry conflicts or present failed publication as successful',async() => {
  mocks.rpc.mockResolvedValue({ data:null,error:{ message:'gap_changed' } });expect((await request({ action:'confirm',review_id:review })).status).toBe(409);expect(mocks.rpc).toHaveBeenCalledTimes(1)
 })
 it('rejects oversized, arbitrary and legacy unreviewed payloads without writing',async() => {
  for (const body of [{ ...input,answer:'a'.repeat(2001) },{ ...input,destino:'other' },{ ...input,workspace_id:ws },{ action:'confirm',review_id:review,answer:'Different' }]) expect((await request(body)).status).toBe(400)
  expect((await request({ ...input,action:undefined })).status).toBe(409);expect(mocks.rpc).not.toHaveBeenCalled()
 })
 it('preserves CSRF and session denials before any source or catalogue lookup',async() => {
  mocks.csrf.mockResolvedValue(Response.json({ error:'csrf' },{ status:403 }));expect((await request(input)).status).toBe(403);expect(mocks.session).not.toHaveBeenCalled()
  mocks.csrf.mockResolvedValue(null);mocks.session.mockResolvedValue({ response:Response.json({ error:'unauthorized' },{ status:401 }) });expect((await request(input)).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled()
 })
})
