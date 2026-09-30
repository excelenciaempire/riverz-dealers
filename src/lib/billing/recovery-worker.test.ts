import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
const mocks=vi.hoisted(()=>({sync:vi.fn(),runner:vi.fn(),paused:vi.fn(),motor:vi.fn()}));
vi.mock('./external-replies',()=>({syncExternalReplies:mocks.sync}));
vi.mock('./read-only',()=>({workspaceReadOnly:mocks.paused}));
vi.mock('@/lib/workspaces/motor',()=>({motorApagado:mocks.motor}));
vi.mock('@/lib/ai/runner',()=>({runAiAgent:mocks.runner}));
vi.mock('@/lib/comments/router',()=>({routeComment:vi.fn()}));
vi.mock('@/lib/i18n/cuenta',()=>({localeDeCuenta:async()=> 'es'}));
import {recoverBillingReplies} from './recovery';
function fixture(attempts=1) {
 const state={answered:false};
 const writes:Array<{table:string;values:Record<string,unknown>;filters:Record<string,unknown>}>=[];
 const conversation={id:'c',workspace_id:'w',contact_id:'contact',connection_id:'conn',channel:'whatsapp',ai_enabled:true,status:'open',assigned_agent_id:null,deleted_at:null};
 const inbound={id:'m',conversation_id:'c',channel:'whatsapp',sender_type:'customer',status:'delivered',content_text:'Hola',created_at:'2026-10-01T01:00:00Z'};
 const db={rpc:async()=>({data:[{inbound_message_id:'m',workspace_id:'w',conversation_id:'c',connection_id:'conn',lease_id:'lease',attempts,queued_at:'2026-10-01T01:00:00Z'}]}),from:(table:string)=>{
  const filters:Record<string,unknown>={};
  let selection='';
  const value=()=>table==='conversations'?conversation:table==='contacts'?{id:'contact',workspace_id:'w',external_id:'1555'}:table==='channel_connections'?{id:'conn',workspace_id:'w',channel:'whatsapp',status:'connected',config:{}}:table==='messages'?inbound:null;
  const chain={select:(v:string)=>{selection=v;return chain;},eq:(k:string,v:unknown)=>{filters[k]=v;return chain;},neq:()=>chain,gte:()=>chain,lte:()=>chain,is:()=>chain,order:()=>chain,limit:()=>chain,
   update:(values:Record<string,unknown>)=>{writes.push({table,values,filters});return chain;},
   maybeSingle:async()=>({data:value()}),single:async()=>({data:value()}),
   then:(resolve:(result:unknown)=>unknown)=>Promise.resolve({data:table==='messages' && selection.includes('sender_type')?(state.answered?[{id:'native',sender_type:'agent',status:'sent',created_at:'2026-10-01T01:01:00Z'}]:[]):null}).then(resolve),
  };return chain;
 }} as unknown as SupabaseClient;
 return {db,state,writes};
}
beforeEach(()=>{mocks.sync.mockReset().mockResolvedValue(undefined);mocks.runner.mockReset().mockResolvedValue(undefined);mocks.paused.mockReset().mockResolvedValue(false);mocks.motor.mockReset().mockResolvedValue(false);});
describe('durable post-payment catch-up',()=>{
 it('imports a native app reply and completes the queued task without spending AI',async()=>{
  const f=fixture();mocks.sync.mockImplementation(async()=>{f.state.answered=true;});
  await recoverBillingReplies(f.db);
  expect(mocks.runner).not.toHaveBeenCalled();
  expect(f.writes[0].values).toMatchObject({status:'done',outcome:'already_answered'});
  expect(f.writes[0].filters).toMatchObject({inbound_message_id:'m',lease_id:'lease'});
 });
 it('answers only after external sync succeeded',async()=>{
  const f=fixture();mocks.runner.mockImplementation(async()=>{expect(mocks.sync).toHaveBeenCalled();f.state.answered=true;});
  const result=await recoverBillingReplies(f.db);
  expect(result.completed).toBe(1);expect(mocks.runner).toHaveBeenCalledTimes(1);
  expect(f.writes[0].values.status).toBe('done');
 });
 it('keeps an uncertain external history pending rather than assuming no reply',async()=>{
  const f=fixture();mocks.sync.mockRejectedValue(new Error('provider unavailable'));
  await recoverBillingReplies(f.db);
  expect(mocks.runner).not.toHaveBeenCalled();expect(f.writes[0].values.status).toBe('pending');
 });
 it('makes persistently unverifiable histories visible for human review',async()=>{
  const f=fixture(5);mocks.sync.mockRejectedValue(new Error('provider unavailable'));
  await recoverBillingReplies(f.db);
  expect(f.writes[0].values).toMatchObject({status:'review',outcome:'external_history_unverified'});
  expect(f.writes.some(w=>w.table==='conversations' && w.values.needs_human_reason==='answer_gap')).toBe(true);
 });
 it('payment becoming overdue again stops catch-up',async()=>{
  const f=fixture();mocks.paused.mockResolvedValue(true);
  await recoverBillingReplies(f.db);
  expect(mocks.sync).not.toHaveBeenCalled();expect(mocks.runner).not.toHaveBeenCalled();
  expect(f.writes[0].values).toMatchObject({status:'pending',outcome:'monthly_payment_pending'});
 });
});
