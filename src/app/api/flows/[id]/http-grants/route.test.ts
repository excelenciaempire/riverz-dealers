import {beforeEach,describe,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({shown:true,auth:vi.fn(),resolve:vi.fn(),access:vi.fn(),csrf:vi.fn(),limit:vi.fn(),from:vi.fn(),rpc:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return m.shown}}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:m.auth}})}));
vi.mock('@/lib/channels/admin-client',()=>({supabaseAdmin:()=>({from:m.from,rpc:m.rpc})}));
vi.mock('@/lib/workspaces/resolve',()=>({resolveWorkspaceIdForUser:m.resolve}));
vi.mock('@/lib/mcp/access',()=>({userAccess:m.access}));
vi.mock('@/lib/csrf',()=>({csrfGuard:m.csrf}));
vi.mock('@/lib/rate-limit',()=>({limitByKey:m.limit}));
vi.mock('@/lib/i18n/server',()=>({getLocale:async()=>'en'}));
import {GET,POST} from './route';
const ws='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',flow='33333333-3333-4333-8333-333333333333',action='44444444-4444-4444-8444-444444444444';
const config={action_id:action,action_revision:2,input_vars:{},output_prefix:'system',next_node_key:'end'};
const params={params:Promise.resolve({id:flow})};
const request=(body?:unknown)=>new Request(`https://riverz.co/api/flows/${flow}/http-grants`,body===undefined?undefined:
 {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{
 vi.clearAllMocks();m.shown=true;m.auth.mockResolvedValue({data:{user:{id:actor}},error:null});m.resolve.mockResolvedValue(ws);
 m.access.mockResolvedValue({admin:true,sections:null});m.csrf.mockResolvedValue(null);m.limit.mockResolvedValue({success:true});
 m.rpc.mockResolvedValue({data:{grants:[]},error:null});
 m.from.mockImplementation((table:string)=>{const q:Record<string,unknown>={};for(const name of ['select','eq','is'])q[name]=()=>q;
   q.maybeSingle=async()=>({data:{id:flow},error:null});q.limit=async()=>({data:table==='http_actions'?[{id:action,revision:2,definition:{name:'Lookup',description:'Read',method:'GET',url:'https://example.com/read',credential_kind:'none',
     parameters:[{key:'contact',source:'contact_id',type:'string',required:true}],outputs:[{key:'status',path:['status'],type:'string',required:true}]}}]:[],error:null});return q;});
});
describe('native flow HTTP grant API',()=>{
 it('does not expose any new route outside comparison',async()=>{m.shown=false;expect((await GET(request(),params)).status).toBe(404);expect(m.auth).not.toHaveBeenCalled();});
 it('requires authentication and current administrator access',async()=>{
  m.auth.mockResolvedValue({data:{user:null}});expect((await GET(request(),params)).status).toBe(401);
  m.auth.mockResolvedValue({data:{user:{id:actor}}});m.access.mockResolvedValue({admin:false});expect((await GET(request(),params)).status).toBe(403);expect(m.rpc).not.toHaveBeenCalled();
 });
 it('requires both the automation and inbox sections',async()=>{m.access.mockResolvedValue({admin:true,sections:['/automatizaciones']});expect((await GET(request(),params)).status).toBe(403);});
 it('returns bounded action metadata without endpoint or credentials',async()=>{
  const response=await GET(request(),params),body=await response.json();expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toContain('no-store');
  expect(body.actions).toEqual([{id:action,revision:2,name:'Lookup',method:'GET',inputs:[],outputs:['status']}]);expect(JSON.stringify(body)).not.toContain('example.com');
 });
 it('checks CSRF before changing a grant',async()=>{m.csrf.mockResolvedValue(new Response(null,{status:403}));expect((await POST(request({}),params)).status).toBe(403);expect(m.rpc).not.toHaveBeenCalled();});
 it('requires the exact reviewed node configuration for save',async()=>{
  expect((await POST(request({operation:'save',node_key:'lookup',expected_revision:0}),params)).status).toBe(400);expect(m.rpc).not.toHaveBeenCalled();
  const response=await POST(request({operation:'save',node_key:'lookup',expected_revision:0,reviewed_config:config}),params);expect(response.status).toBe(200);
  expect(m.rpc.mock.calls[0][1]).toMatchObject({p_actor_id:actor,p_workspace_id:ws,p_flow_id:flow,p_reviewed_config:config});
 });
 it('allows explicit withdrawal after a node was removed',async()=>{expect((await POST(request({operation:'withdraw',node_key:'lookup',expected_revision:1}),params)).status).toBe(200);});
 it('does not accept a browser-supplied principal or workspace',async()=>{
  expect((await POST(request({operation:'save',node_key:'lookup',expected_revision:0,reviewed_config:config,actor_id:actor}),params)).status).toBe(400);
  const req=request();req.headers.set('x-riverz-workspace',action);expect((await GET(req,params)).status).toBe(409);expect(m.rpc).not.toHaveBeenCalled();
 });
 it('limits requests and rejects oversized bodies before granting',async()=>{
  m.limit.mockResolvedValue({success:false});expect((await GET(request(),params)).status).toBe(429);m.limit.mockResolvedValue({success:true});
  expect((await POST(request({data:'a'.repeat(17000)}),params)).status).toBe(413);expect(m.rpc).not.toHaveBeenCalled();
 });
 it('localizes public failures without disclosing SQL or credentials',async()=>{
  m.rpc.mockResolvedValue({error:{message:'secret-private-database-error'}});const response=await GET(request(),params),body=await response.json();
  expect(response.status).toBe(409);expect(body.error).toContain('Could not verify');expect(body.error).not.toContain('secret');
 });
});
