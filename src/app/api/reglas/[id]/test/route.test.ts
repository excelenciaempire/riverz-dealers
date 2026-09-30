import { beforeEach,describe,expect,it,vi } from 'vitest'
const m=vi.hoisted(() => ({ session:vi.fn(),access:vi.fn(),csrf:vi.fn(),budget:vi.fn(),complete:vi.fn(),writable:vi.fn(),mailbox:vi.fn(),rpc:vi.fn(),calls:[] as unknown[][] }))
vi.mock('@/lib/ai/guidance-server',() => ({ guidanceSession:m.session,guidanceError:() => Response.json({ error:'changed' },{ status:409 }) }))
vi.mock('@/lib/inbox/server-context',() => ({ inboxConversation:m.access }))
vi.mock('@/lib/inbox/access',() => ({ canAccessConversation:m.mailbox }))
vi.mock('@/lib/csrf',() => ({ csrfGuard:m.csrf }))
vi.mock('@/lib/ai/rate-limit',() => ({ aiTestGuard:m.budget }))
vi.mock('@/lib/ai/medido',() => ({ completeTextMedido:m.complete }))
vi.mock('@/lib/i18n/server',() => ({ getLocale:async() => 'en' }))
vi.mock('@/lib/billing/read-only',() => ({ assertWorkspaceWritable:m.writable,BillingReadOnlyError:class extends Error {} }))
import { GET,POST } from './route'
const ws='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',conversation='33333333-3333-4333-8333-333333333333',user='44444444-4444-4444-8444-444444444444',agentId='55555555-5555-4555-8555-555555555555'
const rule={ id,agent_id:null,live_revision:1,titulo:'Verified delivery',cuando:'A shipping question',hacer:'Use confirmed dates only' }
const draft={ base_revision:1,draft_revision:1,snapshot:{ titulo:rule.titulo,cuando:rule.cuando,hacer:'Ask for the order reference' } }
const output={ applies:true,reply:'Please share your order reference.',summary:'A reference is needed.',conflicts:[] }
let rows:Record<string,unknown>,singles:Record<string,unknown>
const ctx=() => ({ workspaceId:ws,userId:user,t:(key:string) => key,db:{ rpc:m.rpc,from:(table:string) => {
 const q:Record<string,unknown>={ then:(resolve:(value:unknown) => unknown) => Promise.resolve({ data:rows[table] ?? [],error:null }).then(resolve) }
 for (const method of ['select','eq','is','neq','ilike','in','or','order','limit']) q[method]=(...args:unknown[]) => { m.calls.push([table,method,...args]);return q }
 q.maybeSingle=async() => ({ data:singles[table] ?? null,error:null });return q
} } })
const request=(body:unknown={ conversation_id:conversation,live_revision:1,draft_revision:1 }) => new Request('https://riverz.co/api/reglas/'+id+'/test',{ method:'POST',body:JSON.stringify(body) })
const route={ params:Promise.resolve({ id }) }
beforeEach(() => {
 vi.clearAllMocks();m.calls.length=0
 rows={ agent_guidance:[],messages:[{ id:'after',sender_type:'agent',content_text:'Actual later reply, excluded from replay',created_at:'2026-09-30T02:00:00Z' },{ id:'customer',sender_type:'customer',content_text:'Where is my order?',created_at:'2026-09-30T01:00:00Z' }],conversations:[{ id:conversation,channel:'gmail',connection_id:agentId,contact_id:user,last_message_at:'2026-09-30T01:00:00Z' }],contacts:[{ id:user,name:'Customer' }] }
 singles={ agent_guidance:rule,guidance_drafts:draft,ai_agents:{ id:agentId,persona:'Helpful',api_key_encrypted:null,updated_at:'2026-09-30T00:00:00Z',tools:null,permissions:null } }
 m.session.mockImplementation(async() => ctx());m.access.mockImplementation(async() => ({ ...ctx(),conversation:{ id:conversation } }));m.mailbox.mockResolvedValue(true);m.csrf.mockResolvedValue(null);m.budget.mockResolvedValue(null);m.writable.mockResolvedValue(undefined);m.complete.mockResolvedValue(JSON.stringify(output));m.rpc.mockResolvedValue({ data:{ id:'receipt' },error:null })
})
describe('real conversation rule tests without customer actions',() => {
 it('uses saved draft and real history only through the latest customer turn, recording an exact-version receipt',async() => {
  const r=await POST(request(),route),body=await r.json();expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('private, no-store');expect(body.result).toEqual(output)
  const args=m.complete.mock.calls[0][1];expect(args.user).toContain(draft.snapshot.hacer);expect(args.user).toContain('Where is my order?');expect(args.user).not.toContain('Actual later reply');expect(args.tools).toBeUndefined()
  expect(m.rpc).toHaveBeenCalledWith('record_guidance_test',expect.objectContaining({ p_workspace_id:ws,p_actor_id:user,p_rule_id:id,p_draft_revision:1,p_conversation_id:conversation,p_result:output }))
  expect(body.source.count).toBe(1);expect(body.source.hash).toMatch(/^[a-f0-9]{64}$/);expect(body).not.toHaveProperty('conversation')
 })
 it('enforces CSRF and rejects invented texts or foreign active-workspace cases before spending',async() => {
  m.csrf.mockResolvedValueOnce(Response.json({}, { status:403 }));expect((await POST(request(),route)).status).toBe(403)
  expect((await POST(request({ conversation_id:conversation,live_revision:1,draft_revision:1,text:'invented' }),route)).status).toBe(400)
  m.access.mockResolvedValueOnce({ ...ctx(),workspaceId:agentId });expect((await POST(request(),route)).status).toBe(404);expect(m.complete).not.toHaveBeenCalled()
 })
 it('rejects stale drafts, unavailable assistants and exhausted budgets before model use',async() => {
  singles.guidance_drafts={ ...draft,base_revision:2 };expect((await POST(request(),route)).status).toBe(409)
  singles.guidance_drafts=draft;singles.ai_agents=null;expect((await POST(request(),route)).status).toBe(409)
  singles.ai_agents={ id:agentId,persona:'Helpful' };m.budget.mockResolvedValue(Response.json({}, { status:429 }));expect((await POST(request(),route)).status).toBe(429);expect(m.complete).not.toHaveBeenCalled()
 })
 it('denies an unavailable or revoked private mailbox and never returns the model reply',async() => {
  m.access.mockResolvedValueOnce({ response:Response.json({}, { status:404 }) });expect((await POST(request(),route)).status).toBe(404);expect(m.complete).not.toHaveBeenCalled()
  m.access.mockImplementationOnce(async() => ({ ...ctx(),conversation:{ id:conversation } })).mockResolvedValueOnce({ response:Response.json({}, { status:404 }) })
  const response=await POST(request(),route);expect(response.status).toBe(404);expect(await response.text()).not.toContain(output.reply);expect(m.rpc).not.toHaveBeenCalled()
 })
 it('rejects malformed model results, unknown peer references and post-model rule changes',async() => {
  m.complete.mockResolvedValueOnce(JSON.stringify({ ...output,reasoning:'private' }));expect((await POST(request(),route)).status).toBe(503)
  m.complete.mockResolvedValueOnce(JSON.stringify({ ...output,conflicts:[{ rule_id:agentId,reason:'Foreign' }] }));expect((await POST(request(),route)).status).toBe(503)
  m.rpc.mockResolvedValue({ data:null,error:{ message:'guidance_changed' } });expect((await POST(request(),route)).status).toBe(409)
 })
 it('does not spend on empty customer history or a test exceeding prompt capacity',async() => {
  rows.messages=[];expect((await POST(request(),route)).status).toBe(409)
  rows.messages=[{ id:'c',sender_type:'customer',content_text:'Help',created_at:'now' }];singles.ai_agents={ id:agentId,persona:'x'.repeat(120001) };expect((await POST(request(),route)).status).toBe(409);expect(m.complete).not.toHaveBeenCalled()
 })
 it('lists only cases in the current workspace with fresh mailbox access, without private snippets',async() => {
  const r=await GET(new Request('https://riverz.co/api/reglas/'+id+'/test'),route),body=await r.json();expect(r.status).toBe(200);expect(body.cases).toHaveLength(1);expect(body.cases[0]).not.toHaveProperty('snippet');expect(m.calls).toContainEqual(['conversations','eq','workspace_id',ws])
  m.mailbox.mockResolvedValue(false);expect((await (await GET(new Request('https://riverz.co/api/reglas/'+id+'/test'),route)).json()).cases).toEqual([])
 })
})
