import { beforeEach, describe, expect, it, vi } from 'vitest'
import { draftTemplateProof } from '@/lib/broadcasts/draft'
const state=vi.hoisted(()=>({ blocked:false,csrf:false,admin:false,user:'owner',ws:'workspace',freshWs:'workspace',sessions:0,row:{} as Record<string,unknown>,filters:[] as unknown[][],template:{} as Record<string,unknown>,recipients:[] as Record<string,unknown>[],rpc:vi.fn(),prepare:vi.fn(),error:vi.fn() }))
vi.mock('@/lib/inbox/server-context',()=>({inboxSession:async()=>{
 state.sessions++;if(state.blocked)return {response:new Response('{}',{status:401})}
 return {workspaceId:state.sessions>1?state.freshWs:state.ws,userId:state.user,isAdmin:state.admin,db:{from:()=>{const q={select:()=>q,eq:(...v:unknown[])=>{state.filters.push(v);return q},maybeSingle:async()=>({data:state.row,error:null})};return q},rpc:state.rpc}}
}}))
vi.mock('@/lib/csrf',()=>({csrfGuard:async()=>state.csrf?new Response('{}',{status:403}):null}))
vi.mock('@/lib/i18n/server',()=>({getLocale:async()=>'en'}))
vi.mock('@/lib/api/errors',()=>({serverError:(error:unknown,message:string)=>{state.error(error);return Response.json({error:message},{status:500})}}))
vi.mock('@/lib/rate-limit',()=>({checkRateLimit:()=>({success:true}),rateLimitResponse:()=>new Response('{}',{status:429})}))
vi.mock('@/lib/broadcasts/draft-server',()=>({draftTemplate:async()=>state.template,prepareDraftRecipients:async(...args:unknown[])=>{state.prepare(...args);return state.recipients}}))
import { GET, PATCH, POST } from './route'
const id='11111111-1111-4111-8111-111111111111', version='2026-10-01T12:00:00.123456+00:00'
const config={name:'Edit',template_name:'hello',template_language:'es',voice_note:null,variables:{'1':{type:'static',value:'Ana'}},audience_filter:{type:'all'},scheduled_at:null,create_conversations:true}
const request=(method:string,body:unknown)=>new Request('https://riverz.co/api/broadcasts/draft',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
const write=()=>({id,expected_updated_at:version,config,expected_template:draftTemplateProof(state.template)})
beforeEach(()=>{
 vi.clearAllMocks();state.blocked=false;state.csrf=false;state.admin=false;state.user='owner';state.ws='workspace';state.freshWs='workspace';state.sessions=0;state.filters=[]
 state.row={id,user_id:'owner',status:'draft',updated_at:version,...config,template_variables:{'1':'Ana'}}
 state.template={id:'template',category:'Utility',body_text:'Hi {{1}}',header_type:null,header_content:null,footer_text:null,buttons:null}
 state.recipients=[{contact_id:'contact',phone:'573003364305',params:['Ana']}]
 state.rpc.mockResolvedValue({data:{id,updated_at:version,status:'draft',total_recipients:1},error:null})
})
describe('current-business editable draft API',()=>{
 it.each(['GET','PATCH','POST'])('requires a session for %s without writing or preparing sends',async method=>{
  state.blocked=true
  const result=method==='GET'?await GET(new Request(`https://riverz.co/api/broadcasts/draft?id=${id}`)):await (method==='PATCH'?PATCH:POST)(request(method,write()))
  expect(result.status).toBe(401);expect(state.rpc).not.toHaveBeenCalled();expect(state.prepare).not.toHaveBeenCalled()
 })
 it.each(['PATCH','POST'])('checks CSRF before %s',async method=>{state.csrf=true;expect((await (method==='PATCH'?PATCH:POST)(request(method,write()))).status).toBe(403);expect(state.rpc).not.toHaveBeenCalled()})
 it('reads the same draft config with an exact workspace filter and does not write',async()=>{
  const response=await GET(new Request(`https://riverz.co/api/broadcasts/draft?id=${id}`));expect(response.status).toBe(200)
  expect((await response.json()).config.variables).toEqual({'1':{type:'static',value:'Ana'}})
  expect(state.filters).toContainEqual(['workspace_id','workspace']);expect(state.filters).toContainEqual(['id',id]);expect(state.rpc).not.toHaveBeenCalled()
 })
 it('rejects another creator without admin permission',async()=>{
  state.user='member';expect((await PATCH(request('PATCH',write()))).status).toBe(404);expect(state.rpc).not.toHaveBeenCalled()
 })
 it('rejects a stale version or changed visible template before saving',async()=>{
  expect((await PATCH(request('PATCH',{...write(),expected_updated_at:'2025-01-01T00:00:00Z'}))).status).toBe(409)
  expect((await PATCH(request('PATCH',{...write(),expected_template:{...draftTemplateProof(state.template),body_text:'Different'}}))).status).toBe(409)
  expect(state.rpc).not.toHaveBeenCalled();expect(state.prepare).not.toHaveBeenCalled()
 })
 it('stores only server-resolved recipients and retains draft state until a separate confirmation',async()=>{
  const response=await PATCH(request('PATCH',write()));expect(response.status).toBe(200);expect((await response.json()).estimated_cost).toEqual(expect.any(Number))
  expect(state.rpc).toHaveBeenCalledWith('save_broadcast_draft',expect.objectContaining({p_workspace_id:'workspace',p_actor_id:'owner',p_recipients:state.recipients,p_expected_updated_at:version}))
  expect(state.rpc).not.toHaveBeenCalledWith('launch_reviewed_broadcast_draft',expect.anything())
 })
 it('rejects caller-controlled recipients, workspace and extra launch arguments',async()=>{
  expect((await PATCH(request('PATCH',{...write(),recipients:['other']}))).status).toBe(404)
  expect((await POST(request('POST',{id,expected_updated_at:version,workspace_id:'other'}))).status).toBe(404)
  expect(state.rpc).not.toHaveBeenCalled()
 })
 it('rechecks business selection after preparing without saving the old workspace',async()=>{
  state.freshWs='other';expect((await PATCH(request('PATCH',write()))).status).toBe(409);expect(state.rpc).not.toHaveBeenCalled()
 })
 it('queues the same reviewed id and exact version without resolving a bigger audience',async()=>{
  state.rpc.mockResolvedValue({data:{id,status:'scheduled',updated_at:version},error:null})
  expect((await POST(request('POST',{id,expected_updated_at:version}))).status).toBe(200)
  expect(state.rpc).toHaveBeenCalledWith('launch_reviewed_broadcast_draft',{p_workspace_id:'workspace',p_broadcast_id:id,p_actor_id:'owner',p_expected_updated_at:version});expect(state.prepare).not.toHaveBeenCalled()
 })
 it('does not expose private database errors',async()=>{
  state.rpc.mockResolvedValue({data:null,error:{message:'private provider and customer data'}})
  const response=await PATCH(request('PATCH',write()));expect(response.status).toBe(500);expect(await response.text()).not.toContain('private provider')
 })
})
