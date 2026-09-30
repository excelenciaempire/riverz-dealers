import { beforeEach,describe,expect,it,vi } from 'vitest'
const m=vi.hoisted(() => ({ session:vi.fn(),csrf:vi.fn(),rpc:vi.fn(),queries:[] as Array<{ table:string;ops:Array<unknown> }>,row:{ id:'11111111-1111-4111-8111-111111111111',titulo:'Policy',cuando:null as string | null,hacer:'Verified instruction',activa:true,live_revision:3 },draft:null as unknown }))
vi.mock('@/lib/ai/guidance-server',async importOriginal => ({ ...await importOriginal<object>(),guidanceSession:m.session }))
vi.mock('@/lib/csrf',() => ({ csrfGuard:m.csrf }))
import { GET,POST,PATCH,DELETE } from './route'
const request=(body:unknown,method='POST') => new Request('https://riverz.co/api/reglas?id='+m.row.id,{ method,...(method==='DELETE' ? {} : { body:JSON.stringify(body) }) })
beforeEach(() => {
  vi.clearAllMocks();m.queries=[];m.draft=null;m.row={ ...m.row,activa:true,live_revision:3 };m.csrf.mockResolvedValue(null);m.rpc.mockImplementation(async(name:string) => ({ data:name==='workspace_billing_write_allowed' ? true : m.row,error:null }))
  const db={ rpc:m.rpc,from(table:string) {
    const call={ table,ops:[] as unknown[] };m.queries.push(call)
    let patch:Record<string,unknown> | null=null
    const data=() => table==='guidance_drafts' ? m.draft : patch ? { ...m.row,...patch,live_revision:4 } : m.row
    return { select(){ return this },eq(...args:unknown[]){ call.ops.push(['eq',...args]);return this },order(){ return this },update(value:Record<string,unknown>){ patch=value;call.ops.push(['update',value]);return this },delete(){ call.ops.push(['delete']);return this },maybeSingle:async() => ({ data:data(),error:null }),then(resolve:(v:unknown) => unknown){ return Promise.resolve({ data:[data()],error:null }).then(resolve) } }
  } }
  m.session.mockResolvedValue({ db,client:db,workspaceId:'current-ws',userId:'current-user',isAdmin:true,t:(key:string) => key })
})
describe('existing rule editor compatibility and scope',() => {
  it('lists only the active workspace and creates legacy active rules through the audited command',async() => {
    expect((await GET()).status).toBe(200);expect(m.queries[0].ops).toContainEqual(['eq','workspace_id','current-ws'])
    expect((await POST(request({ titulo:'Policy',hacer:'Instruction' }))).status).toBe(201)
    expect(m.rpc).toHaveBeenCalledWith('create_guidance_rule',expect.objectContaining({ p_workspace_id:'current-ws',p_actor_id:'current-user',p_draft:false }))
  })
  it('keeps member creation as an isolated draft and denies publishing, toggling or deleting live rules',async() => {
    const ctx=await m.session();m.session.mockResolvedValue({ ...ctx,isAdmin:false })
    expect((await POST(request({ titulo:'Draft',hacer:'Instruction',draft:true }))).status).toBe(201)
    expect((await POST(request({ titulo:'Live',hacer:'Instruction' }))).status).toBe(403)
    expect((await PATCH(request({ activa:false },'PATCH'))).status).toBe(403);expect((await DELETE(request(null,'DELETE'))).status).toBe(403)
    expect(m.queries).toHaveLength(0)
  })
  it('preserves the existing toggle with a current version check and records its new version',async() => {
    const r=await PATCH(request({ activa:false,live_revision:3 },'PATCH'));expect(r.status).toBe(200);expect((await r.json()).regla.live_revision).toBe(4)
    expect(m.queries.find(q => q.ops.some(op => (op as unknown[])[0]==='update'))?.ops).toContainEqual(['eq','live_revision',3])
    expect((await PATCH(request({ activa:true,live_revision:1 },'PATCH'))).status).toBe(409)
  })
  it('lets the existing switch publish an identical new draft without leaving a stale duplicate',async() => {
    m.row.activa=false;m.draft={ base_revision:3,draft_revision:1,snapshot:{ titulo:m.row.titulo,cuando:null,hacer:m.row.hacer } }
    expect((await PATCH(request({ activa:true,live_revision:3 },'PATCH'))).status).toBe(200)
    expect(m.rpc).toHaveBeenCalledWith('publish_guidance_draft',expect.objectContaining({ p_workspace_id:'current-ws',p_rule_id:m.row.id,p_live_revision:3,p_draft_revision:1 }))
    expect(m.queries.flatMap(q => q.ops).some(op => (op as unknown[])[0]==='update')).toBe(false)
  })
  it('rejects invalid primitives, forged scopes and CSRF before a write',async() => {
    for (const body of [1,true,{ titulo:null },{ activa:false,workspace_id:'other' }]) expect((await PATCH(request(body,'PATCH'))).status).toBe(400)
    m.csrf.mockResolvedValue(new Response(null,{ status:403 }));expect((await POST(request({ titulo:'Policy',hacer:'Instruction' }))).status).toBe(403)
    expect(m.rpc).not.toHaveBeenCalled();expect(m.queries.flatMap(q => q.ops).some(op => (op as unknown[])[0]==='update')).toBe(false)
  })
})
