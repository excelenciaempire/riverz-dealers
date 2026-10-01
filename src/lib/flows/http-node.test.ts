import { beforeEach,describe,expect,it,vi } from 'vitest';
import type { FlowNodeRow,FlowRunRow } from './types';
const m=vi.hoisted(()=>({shown:true,access:vi.fn(),load:vi.fn(),bindings:vi.fn(),execute:vi.fn(),rpc:vi.fn(),from:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return m.shown}}));
vi.mock('@/lib/mcp/access',()=>({userAccess:m.access}));
vi.mock('@/lib/i18n/cuenta',()=>({localeDeCuenta:async()=>'en'}));
vi.mock('@/lib/integrations/http-action-store',()=>({loadHttpAction:m.load}));
vi.mock('@/lib/integrations/http-action-executor',async()=>{const {createHash}=await import('node:crypto');return {
 executeClaimedHttpAction:m.execute,httpActionBindingsForConversation:m.bindings,
 httpExecutionHash:(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex')};});
import { failHttpFlowNode, runHttpFlowNode } from './http-node';
const ws='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',action='33333333-3333-4333-8333-333333333333';
const flow='44444444-4444-4444-8444-444444444444',runId='55555555-5555-4555-8555-555555555555';
const conv='66666666-6666-4666-8666-666666666666',contact='77777777-7777-4777-8777-777777777777',receipt='88888888-8888-4888-8888-888888888888';
const config={action_id:action,action_revision:2,input_vars:{reference:'order'},output_prefix:'system',next_node_key:'end'};
const node:FlowNodeRow={id:'node',node_key:'lookup',node_type:'http_action',flow_id:flow,config,position_x:0,position_y:0,created_at:'2026-10-01T00:00:00Z'};
const run:FlowRunRow={id:runId,workspace_id:ws,flow_id:flow,contact_id:contact,conversation_id:conv,status:'active',current_node_key:'start',
 last_advanced_at:'2026-10-01T00:00:00Z',vars:{order:'123'},last_prompt_message_id:null,reprompt_count:0,
 started_at:'2026-10-01T00:00:00Z',ended_at:null,end_reason:null,call_stack:[]};
let grant:Record<string,unknown>,current:Record<string,unknown>;
beforeEach(()=>{
 vi.clearAllMocks();m.shown=true;
 grant={workspace_id:ws,flow_id:flow,node_key:'lookup',action_id:action,action_revision:2,node_config:config,revision:1,state:'active',granted_by:actor};
 current={id:runId,workspace_id:ws,contact_id:contact,conversation_id:conv,status:'active',current_node_key:'lookup',
   last_advanced_at:'2026-10-01T00:01:00Z',vars:run.vars};
 m.access.mockResolvedValue({admin:true,sections:null});m.bindings.mockResolvedValue({contact_id:contact,conversation_id:conv,phone:null,email:null});
 m.load.mockResolvedValue({id:action,workspace_id:ws,state:'active',revision:2,definition:{name:'Lookup',description:'Read',method:'GET',url:'https://example.com/read',credential_kind:'none',
   parameters:[{key:'contact',type:'string',required:true,source:'contact_id'},{key:'reference',type:'string',required:true,source:'input'}],
   outputs:[{key:'status',type:'string',path:['status'],required:true}]}});
 m.from.mockImplementation((table:string)=>{const q:Record<string,unknown>={};for(const name of ['select','eq'])q[name]=()=>q;
   q.maybeSingle=async()=>({data:table==='flow_runs'?current:grant,error:null});return q;});
 m.rpc.mockImplementation(async(name:string)=>({data:name==='finish_http_action_flow'?true:{claimed:true},error:null}));
 m.execute.mockResolvedValue({id:receipt,state:'acknowledged',result:{status:'received'}});
});
const db={from:m.from,rpc:m.rpc} as unknown as Parameters<typeof runHttpFlowNode>[0];
describe('native HTTP flow runner',()=>{
 it('recovery only observes the exact recorded approval and never prepares or claims',async()=>{
   const action=await m.load();action.definition.method='POST';action.definition.parameters.push({key:'conversation',type:'string',required:true,source:'conversation_id'});
   m.load.mockResolvedValue(action);m.rpc.mockImplementation(async(name:string)=>({data:name==='finish_http_flow_post'?true:
    {approval_id:receipt,status:'aprobada',receipt:{id:receipt,state:'acknowledged',result:{status:'received'},status_code:200,error_code:null},invocation_key:'a'.repeat(64)},error:null}));
   expect(await runHttpFlowNode(db,run,node,receipt)).toMatchObject({state:'advanced',replayed:true});
   expect(m.rpc.mock.calls.map(call=>call[0])).toEqual(['observe_http_flow_post','finish_http_flow_post']);
   expect(m.rpc.mock.calls[0][1]).toMatchObject({p_run_id:runId,p_flow_id:flow,p_node_key:'lookup',p_visit_at:current.last_advanced_at,p_config:config,p_vars:run.vars,p_grant_revision:1});
   expect(m.execute.mock.lastCall?.[4]).toMatchObject({claimed:false,state:'acknowledged'});
 });
 it('recovery cannot dispatch a GET if the action method changed',async()=>{
   await expect(runHttpFlowNode(db,run,node,receipt)).rejects.toThrow('review_required');expect(m.rpc).not.toHaveBeenCalled();expect(m.execute).not.toHaveBeenCalled();
 });
 it.each(['pendiente','claimed','wrong_approval'])('recovery rejects %s without preparing or dispatching',async kind=>{
   const action=await m.load();action.definition.method='POST';action.definition.parameters.push({key:'conversation',type:'string',required:true,source:'conversation_id'});
   m.load.mockResolvedValue(action);m.rpc.mockResolvedValue({data:{approval_id:kind==='wrong_approval'?contact:receipt,status:kind==='pendiente'?'pendiente':'aprobada',
    receipt:{state:kind==='claimed'?'claimed':'acknowledged'},invocation_key:'a'.repeat(64)},error:null});
   await expect(runHttpFlowNode(db,run,node,receipt)).rejects.toThrow('review_required');expect(m.rpc.mock.calls.map(call=>call[0])).toEqual(['observe_http_flow_post']);expect(m.execute).not.toHaveBeenCalled();
 });
 it('parks a POST proposal without dispatch, input mutation or advancement',async()=>{
   const action=await m.load();
   action.definition.method='POST';action.definition.parameters.push({key:'conversation',type:'string',required:true,source:'conversation_id'});
   m.load.mockResolvedValue(action);m.rpc.mockResolvedValue({data:{approval_id:receipt,status:'pendiente',receipt:null,invocation_key:'a'.repeat(64)},error:null});
   expect(await runHttpFlowNode(db,run,node)).toEqual({state:'pending'});expect(m.execute).not.toHaveBeenCalled();
   expect(m.rpc.mock.lastCall).toEqual(['prepare_http_flow_post',expect.objectContaining({p_vars:run.vars,p_locale:'en',p_expected_node:'lookup'})]);
 });
 it('advances an approved POST only by validating the existing receipt and guarded finish',async()=>{
   const action=await m.load();action.definition.method='POST';action.definition.parameters.push({key:'conversation',type:'string',required:true,source:'conversation_id'});
   m.load.mockResolvedValue(action);m.rpc.mockImplementation(async(name:string)=>({data:name==='finish_http_flow_post'?true:
    {approval_id:receipt,status:'aprobada',receipt:{id:receipt,state:'acknowledged',result:{status:'received'},status_code:200,error_code:null},invocation_key:'a'.repeat(64)},error:null}));
   expect(await runHttpFlowNode(db,run,node)).toMatchObject({state:'advanced',replayed:true,vars:{order:'123',system_status:'received'}});
   expect(m.execute.mock.lastCall?.[4]).toMatchObject({claimed:false,state:'acknowledged'});
   expect(m.rpc.mock.lastCall).toEqual(['finish_http_flow_post',expect.objectContaining({p_approval_id:receipt})]);
 });
 it.each(['rechazada','vencida','fallida'])('does not advance a %s POST proposal',async status=>{
   const action=await m.load();action.definition.method='POST';action.definition.parameters.push({key:'conversation',type:'string',required:true,source:'conversation_id'});
   m.load.mockResolvedValue(action);m.rpc.mockResolvedValue({data:{approval_id:receipt,status,receipt:null,invocation_key:'a'.repeat(64)},error:null});
   await expect(runHttpFlowNode(db,run,node)).rejects.toThrow('review_required');expect(m.execute).not.toHaveBeenCalled();
 });
 it('uses the fresh durable cursor, configured variables and trusted contact',async()=>{
   const output=await runHttpFlowNode(db,run,node);expect(output).toMatchObject({state:'advanced',next:'end',vars:{order:'123',system_status:'received'}});
   expect(m.rpc.mock.calls[0][1]).toMatchObject({p_expected_node:'lookup',p_expected_advanced_at:current.last_advanced_at,p_context:{contact_id:contact}});
   expect(m.execute.mock.calls[0][3].url).toContain(`contact=${contact}`);
 });
 it('does nothing when comparison is disabled',async()=>{m.shown=false;await expect(runHttpFlowNode(db,run,node)).rejects.toThrow('hidden');expect(m.from).not.toHaveBeenCalled();});
 it.each(['workspace_id','flow_id','node_key','action_id','action_revision'])('rejects a mismatched grant field %s',async key=>{
   grant[key]=key==='action_revision'?3:'99999999-9999-4999-8999-999999999999';await expect(runHttpFlowNode(db,run,node)).rejects.toThrow();expect(m.execute).not.toHaveBeenCalled();
 });
 it('rejects a saved graph that differs from the reviewed grant',async()=>{grant.node_config={...config,output_prefix:'other'};await expect(runHttpFlowNode(db,run,node)).rejects.toThrow();expect(m.execute).not.toHaveBeenCalled();});
 it('rechecks the grantor current authority',async()=>{m.access.mockResolvedValue({admin:false,sections:null});await expect(runHttpFlowNode(db,run,node)).rejects.toThrow();expect(m.execute).not.toHaveBeenCalled();});
 it.each(['vars','cursor','paused','identity'])('ignores a superseded %s before transport',async kind=>{
   if(kind==='vars')current.vars={order:'other'};
   if(kind==='cursor')current.current_node_key='end';
   if(kind==='paused')current.status='paused_by_agent';
   if(kind==='identity')current.contact_id='99999999-9999-4999-8999-999999999999';
   expect(await runHttpFlowNode(db,run,node)).toEqual({state:'superseded'});expect(m.execute).not.toHaveBeenCalled();
 });
 it('stops a failed visit only through the observed cursor version',async()=>{
   m.execute.mockResolvedValue({state:'uncertain'});
   const error=await runHttpFlowNode(db,run,node).catch(e=>e);
   m.rpc.mockResolvedValue({data:true,error:null});expect(await failHttpFlowNode(db,run,node,error)).toBe(true);
   expect(m.rpc.mock.lastCall).toEqual(['fail_http_action_flow',expect.objectContaining({p_expected_node:'lookup',p_expected_advanced_at:current.last_advanced_at,p_expected_vars:run.vars})]);
 });
 it('does not stop an unobserved error or claim success after a stop race',async()=>{
   expect(await failHttpFlowNode(db,run,node,new Error('unobserved'))).toBe(false);expect(m.rpc).not.toHaveBeenCalled();
   m.execute.mockResolvedValue({state:'uncertain'});const error=await runHttpFlowNode(db,run,node).catch(e=>e);
   m.rpc.mockResolvedValue({data:false,error:null});expect(await failHttpFlowNode(db,run,node,error)).toBe(false);
 });
 it('does not dispatch when the private database claim fails',async()=>{m.rpc.mockResolvedValue({error:{message:'changed'}});await expect(runHttpFlowNode(db,run,node)).rejects.toThrow();expect(m.execute).not.toHaveBeenCalled();});
 it('leaves an in-flight receipt pending without progressing or replaying',async()=>{m.execute.mockResolvedValue({state:'claimed'});expect(await runHttpFlowNode(db,run,node)).toEqual({state:'pending'});expect(m.rpc).toHaveBeenCalledTimes(1);});
 it.each(['blocked','uncertain'])('halts after %s result instead of presenting completion',async state=>{m.execute.mockResolvedValue({state});await expect(runHttpFlowNode(db,run,node)).rejects.toThrow('review_required');expect(m.rpc).toHaveBeenCalledTimes(1);});
 it('does not continue when another worker already advanced',async()=>{m.rpc.mockImplementation(async(name:string)=>({data:name==='finish_http_action_flow'?false:{claimed:true},error:null}));expect(await runHttpFlowNode(db,run,node)).toEqual({state:'superseded'});});
 it('attributes a prior receipt as replay instead of a new HTTP read',async()=>{
   m.rpc.mockImplementation(async(name:string)=>({data:name==='finish_http_action_flow'?true:{claimed:false,state:'acknowledged'},error:null}));
   expect(await runHttpFlowNode(db,run,node)).toMatchObject({state:'advanced',replayed:true});
 });
});
