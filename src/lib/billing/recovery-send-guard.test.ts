import {describe,expect,it} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {assertRecoveryStillUnanswered,withRecoverySendGuard} from './recovery-send-guard';
function database({human=false,takeover=false,newer=false}={}) {
 const reads:Array<{table:string;filters:Record<string,unknown>}>=[];
 const db={from:(table:string)=>{
  const filters:Record<string,unknown>={};reads.push({table,filters});
  const chain={select:()=>chain,eq:(k:string,v:unknown)=>{filters[k]=v;return chain;},in:()=>chain,gte:()=>chain,gt:()=>chain,is:()=>chain,limit:()=>chain,
   maybeSingle:async()=>({data:{ai_enabled:true,status:'open',assigned_agent_id:takeover?'human':null,deleted_at:null}}),
   then:(resolve:(result:unknown)=>unknown)=>Promise.resolve({data:table==='comments_meta'?[{message_id:'native'}]:filters.sender_type==='agent'&&human?[{id:'native'}]:filters.sender_type==='customer'&&newer?[{id:'newer'}]:[]}).then(resolve),
  };return chain;
 }} as unknown as SupabaseClient;
 return {db,reads};
}
const turn={conversationId:'public',inboundId:'inbound',createdAt:'2026-10-01T01:00:00Z',commentId:'comment'};
describe('recovery send boundary',()=>{
 it('checks the source public thread even when the output is a private DM',async()=>{
  const {db,reads}=database({human:true});
  await expect(withRecoverySendGuard(turn,()=>assertRecoveryStillUnanswered(db,'private'))).rejects.toThrow('billing_recovery_already_answered');
  expect(reads.find(r=>r.table==='messages')?.filters.conversation_id).toBe('public');
 });
 it('stops after a human takes ownership during model execution',async()=>{
  const {db}=database({takeover:true});
  await expect(withRecoverySendGuard(turn,()=>assertRecoveryStillUnanswered(db,'public'))).rejects.toThrow('billing_recovery_human_takeover');
 });
 it('stops a stale DM turn when a newer inbound arrived',async()=>{
  const {db}=database({newer:true});
  await expect(withRecoverySendGuard({...turn,commentId:undefined},()=>assertRecoveryStillUnanswered(db,'public'))).rejects.toThrow('billing_recovery_newer_inbound');
 });
 it('does not apply catch-up rules to ordinary sends outside the scoped recovery turn',async()=>{
  const {db,reads}=database({human:true});
  await assertRecoveryStillUnanswered(db,'public');expect(reads).toHaveLength(0);
 });
});
