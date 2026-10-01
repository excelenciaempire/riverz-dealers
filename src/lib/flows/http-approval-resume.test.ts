import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { httpFlowApprovalPayload } from '@/lib/approvals/http-flow';
const m=vi.hoisted(()=>({shown:true,advance:vi.fn(),from:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return m.shown}}));
vi.mock('./engine',()=>({__advanceFromNodeKeyForResume:m.advance}));
import { continueHttpApprovalFlow } from './http-approval-resume';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const p=httpFlowApprovalPayload.parse({tool:`http_flow_action_${id.replaceAll('-','')}_v1`,input:{},contact_id:id,conversation_id:id,dedupe_key:'test',
 http_action_context:{contact_id:id,conversation_id:id,phone:null,email:null},http_flow:{run_id:id,flow_id:id,node_key:'request',visit_at:'2026-10-01T00:00:00Z',grant_revision:1,
 node_config:{action_id:id,action_revision:1,input_vars:{},output_prefix:'system',next_node_key:'end'}}});
let run:Record<string,unknown>,nodes:Array<Record<string,unknown>>;
const db={from:m.from} as unknown as SupabaseClient;
beforeEach(()=>{
 vi.clearAllMocks();m.shown=true;run={id,workspace_id:id,flow_id:id,status:'active',current_node_key:'request',contact_id:id,conversation_id:id,last_advanced_at:'2026-10-01T00:00:00+00:00',vars:{},call_stack:[]};
 nodes=[{flow_id:id,node_key:'request',node_type:'http_action'},{flow_id:id,node_key:'end',node_type:'end'}];
 m.from.mockImplementation((table:string)=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:run,error:null}),then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:table==='flow_nodes'?nodes:run,error:null}).then(resolve)};return q;});
});
describe('POST callback resumes only its protected HTTP node',()=>{
 it('threads recorded approval identity into a single-node replay',async()=>{
  expect(await continueHttpApprovalFlow(db,id,p,id)).toBe(true);expect(m.advance.mock.calls[0][4]).toEqual({nodeKey:'request',approvalId:id});
 });
 it('re-enters the HTTP node rather than bypassing its finish CAS',async()=>{
  expect(await continueHttpApprovalFlow(db,id,p)).toBe(true);expect(m.advance.mock.calls[0][2]).toBe('request');expect(m.advance.mock.calls[0][2]).not.toBe('end');
 });
 it('preserves PostgreSQL microseconds when comparing visits',async()=>{
  run.last_advanced_at='2026-10-01T00:00:00.000001+00:00';
  expect(await continueHttpApprovalFlow(db,id,p)).toBe(false);expect(m.advance).not.toHaveBeenCalled();
  run.last_advanced_at='2026-10-01T00:00:00.000000+00:00';expect(await continueHttpApprovalFlow(db,id,p)).toBe(true);
 });
 it.each(['hidden','cursor','visit','paused','contact','conversation','subflow','node','workspace','run'])('does not resume changed %s',async kind=>{
  if(kind==='hidden')m.shown=false;if(kind==='cursor')run.current_node_key='end';if(kind==='visit')run.last_advanced_at='2026-10-01T00:01:00Z';
  if(kind==='paused')run.status='paused_by_agent';if(kind==='contact')run.contact_id=other;if(kind==='conversation')run.conversation_id=other;
  if(kind==='subflow')run.call_stack=[{flow_id:other}];if(kind==='node')nodes[0].node_type='send_message';
  if(kind==='workspace')run.workspace_id=other;if(kind==='run')run.id=other;
  expect(await continueHttpApprovalFlow(db,id,p)).toBe(false);expect(m.advance).not.toHaveBeenCalled();
 });
});
