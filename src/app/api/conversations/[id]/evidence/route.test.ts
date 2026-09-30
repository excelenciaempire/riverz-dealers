import { beforeEach,describe,expect,it,vi } from 'vitest'
const m=vi.hoisted(() => ({ context:vi.fn(),calls:[] as unknown[][] }))
vi.mock('@/lib/inbox/server-context',() => ({ inboxConversation:m.context }))
import { GET } from './route'
const ws='11111111-1111-4111-8111-111111111111',conversation='22222222-2222-4222-8222-222222222222',message='33333333-3333-4333-8333-333333333333'
let found:boolean
function ctx() { return { workspaceId:ws,userId:'user',conversation:{ id:conversation },t:(key:string) => key,db:{ from:(table:string) => {
 const q:Record<string,unknown>={ then:(resolve:(v:unknown) => unknown) => Promise.resolve({ data:table==='ai_turn_evidence' ? [{ id:'receipt',status:'failed',evidence:{ version:1 },created_at:'now' }] : [],error:null }).then(resolve) }
 for (const method of ['select','eq','is','or','order','limit']) q[method]=(...args:unknown[]) => { m.calls.push([table,method,...args]);return q }
 q.maybeSingle=async() => ({ data:found ? { id:message } : null,error:null });return q
} } } }
const request=(id=message) => new Request('https://riverz.co/api/conversations/'+conversation+'/evidence?message_id='+id)
const route={ params:Promise.resolve({ id:conversation }) }
beforeEach(() => { vi.clearAllMocks();m.calls.length=0;found=true;m.context.mockImplementation(async() => ctx()) })
describe('message-scoped public evidence',() => {
 it('scopes both current and legacy logs to the workspace, exact live case and exact message',async() => {
  const r=await GET(request(),route);expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('private, no-store')
  expect(m.calls).toContainEqual(['ai_turn_evidence','eq','workspace_id',ws]);expect(m.calls).toContainEqual(['ai_replies','eq','conversation_id',conversation]);expect(m.calls).toContainEqual(['ai_replies','eq','message_id',message])
  const selected=m.calls.filter(row => row[1]==='select').map(row => row[2]);expect(selected.join(',')).not.toContain('error,');expect(selected.join(',')).not.toContain('content_text')
 })
 it('denies missing or foreign messages and malformed message selectors',async() => {
  expect((await GET(request('invalid'),route)).status).toBe(400);found=false;expect((await GET(request(),route)).status).toBe(404)
 })
 it('rechecks private case access after the reads and returns no record after revocation',async() => {
  m.context.mockImplementationOnce(async() => ctx()).mockResolvedValueOnce({ response:Response.json({}, { status:404 }) })
  const response=await GET(request(),route);expect(response.status).toBe(404);expect(await response.text()).not.toContain('receipt')
 })
 it('does not return records after an active-workspace switch or message deletion',async() => {
  m.context.mockImplementationOnce(async() => ctx()).mockImplementationOnce(async() => ({ ...ctx(),workspaceId:message }));expect((await GET(request(),route)).status).toBe(404)
  m.context.mockImplementationOnce(async() => ctx()).mockImplementationOnce(async() => { found=false;return ctx() });expect((await GET(request(),route)).status).toBe(404)
 })
})
