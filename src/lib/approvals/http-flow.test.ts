import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const m=vi.hoisted(()=>({shown:true,locale:'en' as 'es'|'en',access:vi.fn(),load:vi.fn(),bindings:vi.fn(),execute:vi.fn(),resume:vi.fn(),rpc:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return m.shown}}));
vi.mock('@/lib/mcp/access',()=>({userAccess:m.access}));
vi.mock('@/lib/integrations/http-action-store',()=>({loadHttpAction:m.load}));
vi.mock('@/lib/flows/http-approval-resume',()=>({continueHttpApprovalFlow:m.resume}));
vi.mock('@/lib/integrations/http-action-executor',async()=>{const {createHash}=await import('node:crypto');return {
 executeClaimedHttpAction:m.execute,httpActionBindingsForConversation:m.bindings,
 httpExecutionHash:(v:unknown)=>createHash('sha256').update(JSON.stringify(v,(_k,x)=>x && typeof x==='object' && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x)).digest('hex')};});
vi.mock('@/lib/i18n/cuenta',()=>({localeDeCuenta:async()=>m.locale}));
import { canDecideHttpFlow, executeApprovedHttpFlow, httpFlowApprovalPayload, rejectHttpFlow } from './http-flow';
import { decidir } from './resolve';
const ws='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',action='33333333-3333-4333-8333-333333333333';
const run='44444444-4444-4444-8444-444444444444',flow='55555555-5555-4555-8555-555555555555',approval='66666666-6666-4666-8666-666666666666';
const contact='77777777-7777-4777-8777-777777777777',conv='88888888-8888-4888-8888-888888888888';
const config={action_id:action,action_revision:2,input_vars:{reference:'order'},output_prefix:'system',next_node_key:'end'};
const trusted={contact_id:contact,conversation_id:conv,phone:null,email:null};
const payload={tool:`http_flow_action_${action.replaceAll('-','')}_v2`,input:{reference:'123'},contact_id:contact,conversation_id:conv,
 http_action_context:trusted,http_flow:{run_id:run,flow_id:flow,node_key:'lookup',visit_at:'2026-10-01T00:00:00+00:00',node_config:config,grant_revision:1},dedupe_key:'flow-post:one'};
const ctx={workspaceId:ws,approvalId:approval,actorId:actor};
const db={rpc:m.rpc} as unknown as SupabaseClient;
beforeEach(()=>{
 vi.clearAllMocks();m.shown=true;m.locale='en';m.access.mockResolvedValue({admin:true,sections:null});m.bindings.mockResolvedValue(trusted);m.resume.mockResolvedValue(true);
 m.load.mockResolvedValue({state:'active',revision:2,definition:{name:'Submit',description:'Write request',method:'POST',url:'https://example.com/submit',credential_kind:'none',
  parameters:[{key:'contact',type:'string',required:true,source:'contact_id'},{key:'conversation',type:'string',required:true,source:'conversation_id'},{key:'reference',type:'string',required:true,source:'input'}],outputs:[]}});
 m.execute.mockResolvedValue({id:run,state:'acknowledged',status_code:200,cached:false,result:{private_selected:'PRIVATE_RESULT'}});
 m.rpc.mockImplementation(async(name:string)=>({error:null,data:name==='review_http_flow_post' ? {approval_id:approval,payload:Object.fromEntries(Object.entries(payload).filter(([k])=>k!=='dedupe_key'))}
  :name==='claim_http_flow_post'?{claim:{claimed:true,id:run,state:'claimed',lease_id:contact},invocation_key:'a'.repeat(64)}:true}));
});
describe('authenticated native Flow POST consumer',()=>{
 it('validates the private pending proposal before a panel decision',async()=>{
  expect(await canDecideHttpFlow(db,ws,actor,approval,payload,'panel')).toBe(true);
  expect(m.rpc).toHaveBeenCalledWith('review_http_flow_post',{p_workspace_id:ws,p_approval_id:approval,p_actor_id:actor,p_approved:null});
 });
 it.each(['hidden','whatsapp','missing_actor','missing_section','wrong_snapshot','malformed','agent','confirmed'])('blocks %s before consuming review',async kind=>{
  if(kind==='hidden')m.shown=false;
  if(kind==='missing_section')m.access.mockResolvedValue({admin:true,sections:['/automatizaciones','/bandeja']});
  if(kind==='wrong_snapshot')m.rpc.mockResolvedValue({data:{approval_id:approval,payload:{...payload,input:{reference:'changed'}}},error:null});
  const p=kind==='malformed'?{...payload,tool:'http_flow_action_malformed'}:kind==='agent'?{...payload,agent_id:actor}:kind==='confirmed'?{...payload,confirmed:true}:payload;
  expect(await canDecideHttpFlow(db,ws,kind==='missing_actor'?null:actor,approval,p,kind==='whatsapp'?'whatsapp':'panel')).toBe(false);
  expect(m.execute).not.toHaveBeenCalled();
 });
 it('uses the actual decider and private lease, without impersonating an assistant or exposing output values',async()=>{
  expect(await executeApprovedHttpFlow(db,ctx,payload,'en')).toMatchObject({ok:true,execution:{receipt_id:run,flow_continuation_attempted:true,business_completion_verified:false}});
  expect(m.rpc.mock.calls[0]).toEqual(['claim_http_flow_post',expect.objectContaining({p_actor_id:actor,p_approval_id:approval,p_workspace_id:ws})]);
  expect(m.execute.mock.calls[0][1]).toEqual({workspaceId:ws,actionId:action,invocationKey:'a'.repeat(64)});
  expect(m.execute.mock.calls[0][3].body).toContain(contact);
  const result=await executeApprovedHttpFlow(db,ctx,payload,'es');expect(JSON.stringify(result)).not.toContain('PRIVATE_RESULT');expect(result.message).toContain('Respuesta');
 });
 it.each(['action','revision','identity','claim'])('blocks changed %s before dispatch',async kind=>{
  if(kind==='action'){const a=await m.load();a.definition.method='GET';m.load.mockResolvedValue(a);}
  if(kind==='revision'){const a=await m.load();a.revision=3;m.load.mockResolvedValue(a);}
  if(kind==='identity')m.bindings.mockResolvedValue({...trusted,email:'new@example.com'});
  if(kind==='claim')m.rpc.mockResolvedValue({error:{message:'PRIVATE_DATABASE_ERROR'},data:null});
  const result=await executeApprovedHttpFlow(db,ctx,payload,'en');expect(result.ok).toBe(false);expect(m.execute).not.toHaveBeenCalled();expect(JSON.stringify(result)).not.toContain('PRIVATE_DATABASE_ERROR');
 });
 it.each(['claimed','blocked','uncertain'])('retains %s receipt and stops only its observed run',async state=>{
  m.execute.mockResolvedValue({id:run,state,status_code:null,cached:false,result:null});
  expect(await executeApprovedHttpFlow(db,ctx,payload,'en')).toMatchObject({ok:false,uncertain:state!=='blocked',execution:{state}});
  expect(m.rpc).toHaveBeenCalledWith('stop_http_flow_post',{p_workspace_id:ws,p_approval_id:approval,p_actor_id:actor});expect(m.resume).not.toHaveBeenCalled();
 });
 it('reports continuation failure separately from the acknowledged provider response',async()=>{
  m.resume.mockRejectedValue(new Error('PRIVATE_ENGINE_ERROR'));const result=await executeApprovedHttpFlow(db,ctx,payload,'en');
  expect(result).toMatchObject({ok:true,execution:{state:'acknowledged',flow_continuation_attempted:false}});expect(result.message).toContain('could not continue');
  expect(m.rpc).not.toHaveBeenCalledWith('stop_http_flow_post',expect.anything());expect(JSON.stringify(result)).not.toContain('PRIVATE_ENGINE_ERROR');
 });
 it('rejects without HTTP and fails closed on SQL errors',async()=>{
  expect((await rejectHttpFlow(db,ws,approval,actor,'en')).ok).toBe(true);expect(m.execute).not.toHaveBeenCalled();
  m.rpc.mockResolvedValue({error:{message:'PRIVATE_SQL'}});const result=await rejectHttpFlow(db,ws,approval,actor,'es');
  expect(result.ok).toBe(false);expect(result.message).not.toContain('PRIVATE_SQL');
 });
 it('parses only the dedicated exact flow snapshot',()=>{
  expect(httpFlowApprovalPayload.safeParse(payload).success).toBe(true);
  expect(httpFlowApprovalPayload.safeParse({...payload,contact_id:actor}).success).toBe(false);
 });
});

function decisionFixture(){
 let decisionError=false;
 const row:Record<string,unknown>={id:approval,workspace_id:ws,kind:'herramienta',payload,status:'pendiente',title:'Submit',expires_at:new Date(Date.now()+60000).toISOString()};
 const client={rpc:m.rpc,from(){let patch:Record<string,unknown>|undefined;const filters:Array<(row:Record<string,unknown>)=>boolean>=[];
  const q={select:()=>q,update:(v:Record<string,unknown>)=>{patch=v;return q;},eq:(k:string,v:unknown)=>{filters.push(r=>r[k]===v);return q;},
   gt:(k:string,v:string)=>{filters.push(r=>String(r[k])>v);return q;},maybeSingle:async()=>{if(!filters.every(f=>f(row)))return {data:null,error:null};
    if(decisionError && patch && Object.hasOwn(patch,'decided_at'))return {data:null,error:{message:'PRIVATE_DATABASE_DETAIL'}};
    if(patch)Object.assign(row,patch);return {data:{...row},error:null};}};return q;}} as unknown as SupabaseClient;
 return {client,row,failDecision:()=>{decisionError=true;}};
}
describe('native flow decision orchestration',()=>{
 it.each(['es','en'] as const)('localizes %s registration failures without exposing SQL',async locale=>{
  m.locale=locale;const f=decisionFixture();f.failDecision();
  const result=await decidir(f.client,{approvalId:approval,workspaceId:ws,decision:'aprobada',via:'panel',decidedBy:actor});
  expect(result.ok).toBe(false);expect(result.message).not.toContain('PRIVATE_DATABASE_DETAIL');
  expect(result.message).toContain(locale==='en'?'Could not record':'No se pudo registrar');expect(f.row.status).toBe('pendiente');expect(m.execute).not.toHaveBeenCalled();
 });
 it('reports an expired/raced decision in the account language without dispatch',async()=>{
  const f=decisionFixture();f.row.expires_at=new Date(Date.now()-1000).toISOString();
  const result=await decidir(f.client,{approvalId:approval,workspaceId:ws,decision:'aprobada',via:'panel',decidedBy:actor});
  expect(result).toMatchObject({ok:false,message:'This request was already resolved or expired.'});expect(m.execute).not.toHaveBeenCalled();
 });
 it('rejects malformed flow proposals without consuming or falling through to legacy tools',async()=>{
  const {client,row}=decisionFixture();row.payload={...payload,confirmed:true};
  expect((await decidir(client,{approvalId:approval,workspaceId:ws,decision:'aprobada',via:'panel',decidedBy:actor})).ok).toBe(false);
  expect(row.status).toBe('pendiente');expect(m.execute).not.toHaveBeenCalled();
 });
 it('consumes and executes one concurrent authenticated decision only',async()=>{
  const {client,row}=decisionFixture();const args={approvalId:approval,workspaceId:ws,decision:'aprobada' as const,via:'panel' as const,decidedBy:actor};
  const results=await Promise.all([decidir(client,args),decidir(client,args)]);
  expect(results.filter(r=>r.ok)).toHaveLength(1);expect(m.execute).toHaveBeenCalledTimes(1);expect(row.decided_by).toBe(actor);expect(row.status).toBe('aprobada');
 });
});
