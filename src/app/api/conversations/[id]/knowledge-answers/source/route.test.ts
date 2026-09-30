import { beforeEach,describe,expect,it,vi } from 'vitest'
const mocks=vi.hoisted(() => ({ context:vi.fn(),read:vi.fn(),from:vi.fn(),select:vi.fn(),eq:vi.fn() }))
vi.mock('@/lib/inbox/server-context',() => ({ inboxConversation:mocks.context }))
vi.mock('@/lib/api/errors',() => ({ serverError:(_e:unknown,message:string) => Response.json({ error:message },{ status:500 }) }))
import { GET } from './route'
const workspace='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',conversation='44444444-4444-4444-8444-444444444444',id='77777777-7777-4777-8777-777777777777'
const source={ id,question_snapshot:'Delivery?',answer:'Exception for this case',revision:2,created_at:'2026-09-30T12:00:00Z',actor_id:actor }
const query={ select:mocks.select,eq:mocks.eq,maybeSingle:mocks.read },client={ from:mocks.from },ctx={ client,workspaceId:workspace,userId:actor,t:(key:string) => key }
const read=(answerId=id) => GET(new Request(`https://riverz.co/api/conversations/${conversation}/knowledge-answers/source?answer_id=${answerId}`),{ params:Promise.resolve({ id:conversation }) })
beforeEach(() => { vi.clearAllMocks();mocks.context.mockResolvedValue(ctx);mocks.from.mockReturnValue(query);mocks.select.mockReturnValue(query);mocks.eq.mockReturnValue(query);mocks.read.mockResolvedValue({ data:source,error:null }) })
describe('immutable case answer evidence under current authenticated RLS',() => {
 it('returns the exact version only after two access and RLS checks, without caching',async() => {
  const result=await read();expect(await result.json()).toEqual({ source,scope:'case_only' });expect(result.headers.get('Cache-Control')).toContain('no-store');expect(mocks.context).toHaveBeenCalledTimes(2);expect(mocks.from).toHaveBeenCalledTimes(2)
  expect(mocks.eq.mock.calls).toEqual([['workspace_id',workspace],['conversation_id',conversation],['id',id],['workspace_id',workspace],['conversation_id',conversation],['id',id]])
 })
 it('denies invalid identifiers and inaccessible cases before database reads',async() => {
  expect((await read('invalid')).status).toBe(400);expect(mocks.from).not.toHaveBeenCalled();mocks.context.mockResolvedValue({ response:Response.json({}, { status:404 }) });expect((await read()).status).toBe(404);expect(mocks.from).not.toHaveBeenCalled()
 })
 it('does not invent a question snapshot for historical or deleted source versions',async() => {
  for (const data of [null,{ ...source,question_snapshot:null }]) { mocks.read.mockResolvedValueOnce({ data,error:null });expect((await read()).status).toBe(404) }
  expect(mocks.read).toHaveBeenCalledTimes(2)
 })
 it('fails closed when authorization changes after the first source read',async() => {
  for (const fresh of [{ ...ctx,workspaceId:id },{ ...ctx,userId:id },{ response:Response.json({}, { status:404 }) }]) {
   mocks.context.mockResolvedValueOnce(ctx).mockResolvedValueOnce(fresh);expect((await read()).status).toBe(404)
  }
  expect(mocks.read).toHaveBeenCalledTimes(3)
 })
 it('does not expose the earlier read if the source is removed before the final RLS check',async() => {
  mocks.read.mockResolvedValueOnce({ data:source,error:null }).mockResolvedValueOnce({ data:null,error:null });expect((await read()).status).toBe(404)
 })
 it('does not retry database errors or expose their details',async() => {
  mocks.read.mockResolvedValueOnce({ data:null,error:{ message:'private schema information' } });const result=await read();expect(result.status).toBe(500);expect(await result.text()).not.toContain('private schema');expect(mocks.read).toHaveBeenCalledTimes(1)
 })
})
