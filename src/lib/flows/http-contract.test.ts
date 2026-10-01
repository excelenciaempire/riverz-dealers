import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/ui/improvements-preview',()=>({SHOW_RIVERZ_IMPROVEMENTS:true}));
import { httpFlowConfig,httpFlowConfigMatches,httpFlowInputs,httpFlowOutput,httpFlowActionAllowed } from './http-contract';
import { validateFlowForActivation,reachableFromEntry } from './validate';
import type { HttpActionDefinition } from '@/lib/integrations/http-action-contract';
const id='11111111-1111-4111-8111-111111111111';
const config={action_id:id,action_revision:2,input_vars:{reference:'order'},output_prefix:'system',next_node_key:'end'};
const definition:HttpActionDefinition={name:'Lookup',description:'Lookup a contact reference',method:'GET',url:'https://example.com/query',credential_kind:'none',
 parameters:[{key:'contact',type:'string',required:true,source:'contact_id'},{key:'reference',type:'string',required:true,source:'input'}],
 outputs:[{key:'status',path:['status'],type:'string',required:true},{key:'reference',path:['reference'],type:'string',required:false}]};
describe('native HTTP flow contract',()=>{
 it('matches reviewed mappings independently of JSON database key order',()=>{
  const left={...config,input_vars:{reference:'order',note:'message'}};
  expect(httpFlowConfigMatches(left,{...config,input_vars:{note:'message',reference:'order'}})).toBe(true);
  expect(httpFlowConfigMatches(left,{...config,input_vars:{note:'other',reference:'order'}})).toBe(false);
 });
 it('binds only free fields to exact scalar variables',()=>expect(httpFlowInputs(config,definition,{order:'123',contact:'forged'})).toEqual({reference:'123'}));
 it('rejects mappings into server identity fields',()=>expect(()=>httpFlowInputs({...config,input_vars:{contact:'order'}},definition,{order:'123'})).toThrow());
 it('rejects required missing variables rather than converting them to empty strings',()=>expect(()=>httpFlowInputs(config,definition,{})).toThrow());
 it('requires conversation-scoped individual review for writes and rejects unscoped identity',()=>{
   expect(httpFlowActionAllowed({...definition,method:'POST'})).toBe(false);
   expect(httpFlowActionAllowed({...definition,method:'POST',parameters:[...definition.parameters,{key:'conversation',type:'string',source:'conversation_id',required:true}]})).toBe(true);
   expect(httpFlowActionAllowed({...definition,parameters:definition.parameters.slice(1)})).toBe(false);
   expect(httpFlowActionAllowed({...definition,parameters:[...definition.parameters,{key:'email',type:'string',source:'email',required:false}]})).toBe(false);
 });
 it('clears absent optional outputs and preserves unrelated variables',()=>expect(httpFlowOutput(config,definition,{order:'123',system_reference:'old'},{status:'received'}))
   .toEqual({order:'123',system_status:'received'}));
 it('rejects unknown response fields',()=>expect(()=>httpFlowOutput(config,definition,{}, {secret:'no'})).toThrow());
 it.each(['__proto__','constructor','prototype','a.b','x'.repeat(49)])('rejects unsafe result prefix %s',prefix=>expect(httpFlowConfig.safeParse({...config,output_prefix:prefix}).success).toBe(false));
 it('rejects destination, credentials and arbitrary runtime identity in the node graph',()=>{
   for (const field of ['url','secret','actor_id','confirmed']) expect(httpFlowConfig.safeParse({...config,[field]:'forged'}).success).toBe(false);
 });
 it('validates traversal and catches automatic HTTP cycles',()=>{
   const flow={name:'Lookup',trigger_type:'manual' as const,trigger_config:{},entry_node_id:'lookup'};
   const nodes=[{node_key:'lookup',node_type:'http_action',config},{node_key:'end',node_type:'end',config:{}}];
   expect(validateFlowForActivation(flow,nodes)).toEqual([]);
   expect(reachableFromEntry('lookup',nodes).has('end')).toBe(true);
   expect(validateFlowForActivation(flow,[{...nodes[0],config:{...config,next_node_key:'lookup'}}]).some(i=>i.scope==='flow')).toBe(true);
 });
 it('provides localized validation of incomplete nodes',()=>{
   const flow={name:'Lookup',trigger_type:'manual' as const,trigger_config:{},entry_node_id:'lookup'};
   const nodes=[{node_key:'lookup',node_type:'http_action',config:{}}];
   expect(validateFlowForActivation(flow,nodes,'en').some(i=>i.message.includes('Configure the action'))).toBe(true);
   expect(validateFlowForActivation(flow,nodes,'es').some(i=>i.message.includes('Configura la acción'))).toBe(true);
 });
});
