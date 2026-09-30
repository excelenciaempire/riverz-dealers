import { beforeEach,describe,expect,it,vi } from 'vitest'
const m=vi.hoisted(() => ({ session:vi.fn(),csrf:vi.fn(),rpc:vi.fn(),queries:[] as Array<{ table:string;ops:Array<unknown> }>,versions:[] as unknown[],draft:null as unknown }))
vi.mock('@/lib/ai/guidance-server',async importOriginal => ({ ...await importOriginal<object>(),guidanceSession:m.session }))
vi.mock('@/lib/csrf',() => ({ csrfGuard:m.csrf }))
import { GET,POST } from './route'
const id='11111111-1111-4111-8111-111111111111',route={ params:Promise.resolve({ id }) }
const request=(body:unknown,url='https://riverz.co/api/reglas/'+id+'/versions') => new Request(url,{ method:'POST',body:JSON.stringify(body) })
beforeEach(() => {
  vi.clearAllMocks();m.queries=[];m.versions=[];m.draft=null;m.csrf.mockResolvedValue(null);m.rpc.mockResolvedValue({ data:{ live_revision:2 },error:null })
  const db={ rpc:m.rpc,from(table:string) {
    const call={ table,ops:[] as unknown[] };m.queries.push(call)
    const answer=() => ({ data:table==='agent_guidance' ? { id,live_revision:1 } : table==='guidance_drafts' ? m.draft : m.versions,error:null })
    return { select(...args:unknown[]){ call.ops.push(['select',...args]);return this },eq(...args:unknown[]){ call.ops.push(['eq',...args]);return this },order(){ return this },limit(n:number){ call.ops.push(['limit',n]);return this },lt(...args:unknown[]){ call.ops.push(['lt',...args]);return this },maybeSingle:async() => answer(),then(resolve:(v:unknown) => unknown){ return Promise.resolve(answer()).then(resolve) } }
  } }
  m.session.mockResolvedValue({ db,workspaceId:'server-workspace',userId:'server-actor',isAdmin:true,t:(key:string) => key })
})
describe('scoped rule version API',() => {
  it('paginates exact revisions without disclosing another business',async() => {
    m.versions=Array.from({ length:51 },(_,i) => ({ rule_id:id,revision:100-i }))
    const r=await GET(request(null,'https://riverz.co/api/reglas/'+id+'/versions?before=101'),route),body=await r.json()
    expect(body.versions).toHaveLength(50);expect(body.next_before).toBe(51);expect(r.headers.get('Cache-Control')).toContain('no-store')
    for (const q of m.queries) expect(q.ops).toContainEqual(['eq','workspace_id','server-workspace'])
    expect(m.queries.find(q => q.table==='guidance_live_versions')?.ops).toContainEqual(['lt','revision',101])
  })
  it('rejects forged scopes and invalid pagination before database writes',async() => {
    expect((await POST(request({ action:'publish',live_revision:1,draft_revision:1,workspace_id:'other' }),route)).status).toBe(400)
    expect((await GET(request(null,'https://riverz.co/api/reglas/'+id+'/versions?before=1.2'),route)).status).toBe(400);expect(m.rpc).not.toHaveBeenCalled()
  })
  it('derives author and workspace and passes exact version checks to the atomic RPC',async() => {
    expect((await POST(request({ action:'publish',live_revision:2,draft_revision:3 }),route)).status).toBe(200)
    expect(m.rpc).toHaveBeenCalledWith('publish_guidance_draft',{ p_workspace_id:'server-workspace',p_rule_id:id,p_actor_id:'server-actor',p_live_revision:2,p_draft_revision:3 })
  })
  it('denies nonadmin publication and CSRF but allows a member to prepare a draft',async() => {
    const ctx=await m.session();m.session.mockResolvedValue({ ...ctx,isAdmin:false })
    expect((await POST(request({ action:'publish',live_revision:1,draft_revision:1 }),route)).status).toBe(403)
    expect((await POST(request({ action:'save',live_revision:1,draft_revision:0,snapshot:{ titulo:'Draft',hacer:'Draft instruction' } }),route)).status).toBe(200)
    m.csrf.mockResolvedValue(new Response(null,{ status:403 }));expect((await POST(request({ action:'discard',draft_revision:1 }),route)).status).toBe(403);expect(m.rpc).toHaveBeenCalledTimes(1)
  })
  it('localizes a concurrent version conflict and the billing gate',async() => {
    m.rpc.mockResolvedValue({ error:{ message:'guidance_changed' } });expect((await POST(request({ action:'publish',live_revision:1,draft_revision:1 }),route)).status).toBe(409)
    m.rpc.mockResolvedValue({ error:{ message:'subscription_read_only' } });expect((await POST(request({ action:'publish',live_revision:1,draft_revision:1 }),route)).status).toBe(402)
  })
})
