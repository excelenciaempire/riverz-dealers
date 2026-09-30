import { beforeEach,expect,it,vi } from 'vitest'
const m=vi.hoisted(() => ({ session:vi.fn(),rpc:vi.fn() }))
vi.mock('@/lib/ai/guidance-server',() => ({ guidanceSession:m.session }))
import { GET } from './route'
const id='11111111-1111-4111-8111-111111111111',ctx={ workspaceId:'workspace',userId:'actor',t:(key:string) => key,db:{ rpc:m.rpc } }
const request=new Request('https://riverz.co/api/reglas/'+id+'/activity'),route={ params:Promise.resolve({ id }) }
beforeEach(() => { vi.clearAllMocks();m.session.mockResolvedValue(ctx);m.rpc.mockResolvedValue({ data:{ attribution:'context_only',recorded_turns:0 },error:null }) })
it('derives workspace and actor from the session and preserves unknown attribution',async() => {
 const r=await GET(request,route);expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('private, no-store');expect(await r.json()).toMatchObject({ attribution:'context_only' })
 expect(m.rpc).toHaveBeenCalledWith('ai_rule_context_metrics',{ p_workspace_id:'workspace',p_actor_id:'actor',p_rule_id:id })
})
it('denies revoked context and a workspace switch before exposing aggregate counts',async() => {
 m.session.mockResolvedValueOnce(ctx).mockResolvedValueOnce({ response:Response.json({}, { status:403 }) });expect((await GET(request,route)).status).toBe(403)
 m.session.mockResolvedValueOnce(ctx).mockResolvedValueOnce({ ...ctx,workspaceId:'another' });expect((await GET(request,route)).status).toBe(404)
})
it('does not represent missing permission or a foreign rule as zero observed turns',async() => {
 m.rpc.mockResolvedValue({ data:null,error:{ message:'invalid_ai_evidence' } });expect((await GET(request,route)).status).toBe(404)
})
