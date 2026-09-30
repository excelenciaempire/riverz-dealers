import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection, Contact, Conversation, Message } from '@/types';
import { workspaceReadOnly } from './read-only';
import { syncExternalReplies, type RecoveryComment } from './external-replies';
import { withRecoverySendGuard } from './recovery-send-guard';
import { motorApagado } from '@/lib/workspaces/motor';
import { runAiAgent } from '@/lib/ai/runner';
import { routeComment } from '@/lib/comments/router';
import { localeDeCuenta } from '@/lib/i18n/cuenta';
import { translate } from '@/lib/i18n/translate';
type Job={inbound_message_id:string;workspace_id:string;conversation_id:string;connection_id:string|null;lease_id:string;attempts:number;queued_at:string};
export function recoveryDisposition(conversation:Pick<Conversation,'ai_enabled'|'assigned_agent_id'|'status'|'deleted_at'>) {
 if(conversation.deleted_at)return 'conversation_deleted';
 if(conversation.status==='closed')return 'conversation_closed';
 if(conversation.ai_enabled===false)return 'ai_disabled';
 if(conversation.assigned_agent_id)return 'assigned_to_human';
 return null;
}
export function isReplyAfterInbound(message:Pick<Message,'sender_type'|'status'|'created_at'>,inbound:Pick<Message,'created_at'>) {
 return message.sender_type!=='customer' && ['sent','delivered','read'].includes(message.status) && Date.parse(message.created_at)>=Date.parse(inbound.created_at);
}
async function answered(db:SupabaseClient,conversation:Conversation,inbound:Message,isComment:boolean) {
 const rows=await db.from('messages').select('id,sender_type,status,created_at').eq('conversation_id',conversation.id).neq('sender_type','customer').gte('created_at',inbound.created_at).is('deleted_at',null);
 if(rows.error)throw new Error('billing_recovery_history_unavailable');
 let replies=rows.data??[];
 if(isComment && replies.length) {
  const metadata=await db.from('comments_meta').select('message_id').in('message_id',replies.map(m=>m.id)).eq('parent_comment_id',inbound.message_id);
  if(metadata.error)throw new Error('billing_recovery_history_unavailable');
  const ids=new Set(metadata.data?.map(m=>m.message_id));
  replies=replies.filter(m=>ids.has(m.id));
 }
 if(replies.some(m=>isReplyAfterInbound(m,inbound)))return 'already_answered';
 if(replies.some(m=>['pending','sending','queued'].includes(m.status) || m.sender_type==='bot' && m.status==='failed'))return 'outbound_delivery_uncertain';
 return null;
}
async function finish(db:SupabaseClient,job:Job,status:'pending'|'done'|'review',outcome:string) {
 const result=await db.from('billing_reply_backlog').update({status,outcome,lease_id:null,lease_until:null,
  ...(status==='pending'?{next_attempt_at:new Date(Date.now()+Math.min(3_600_000,60_000*2**Math.min(job.attempts,6))).toISOString()}:{finished_at:new Date().toISOString()})
 }).eq('inbound_message_id',job.inbound_message_id).eq('lease_id',job.lease_id);
 if(result.error)throw new Error('billing_recovery_result_unavailable');
 if(status==='review' && !['conversation_deleted','conversation_closed','ai_disabled','assigned_to_human'].includes(outcome)) {
  const locale=await localeDeCuenta(db,job.workspace_id);
  await db.from('conversations').update({needs_human_reason:'answer_gap',needs_human_at:new Date().toISOString(),needs_human_summary:translate(locale,'settings.billingRecoveryReview')}).eq('id',job.conversation_id).is('needs_human_reason',null);
 }
}
async function consolidateAnsweredConversation(db:SupabaseClient,job:Job,through:string) {
 const result=await db.from('billing_reply_backlog').update({status:'done',outcome:'conversation_answered',finished_at:new Date().toISOString()})
  .eq('conversation_id',job.conversation_id).eq('status','pending').lte('queued_at',through);
 if(result.error)throw new Error('billing_recovery_consolidation_unavailable');
}
/** Paid accounts only; holds a durable per-conversation lease and never replays sales actions. */
export async function recoverBillingReplies(db:SupabaseClient) {
 const claimed=await db.rpc('claim_billing_reply_backlog',{p_limit:2});
 if(claimed.error)throw new Error('billing_recovery_claim_failed');
 let completed=0,review=0;
 const failures:string[]=[];
 const deadline=Date.now()+120_000;
 for(const job of (claimed.data??[]) as Job[]) {
  if(Date.now()>deadline) {await finish(db,job,'pending','recovery_budget');continue;}
  try {
   if(await workspaceReadOnly(db,job.workspace_id)) {await finish(db,job,'pending','monthly_payment_pending');continue;}
   const result=await db.from('conversations').select('*').eq('id',job.conversation_id).eq('workspace_id',job.workspace_id).maybeSingle();
   if(result.error)throw new Error('billing_recovery_conversation_unavailable');
   const conversation=result.data as Conversation|null;
   if(!conversation) {await finish(db,job,'done','conversation_deleted');continue;}
   const disposition=recoveryDisposition(conversation);
   if(disposition) {await finish(db,job,'review',disposition);review++;continue;}
   if(await motorApagado(db,job.workspace_id)) {await finish(db,job,'pending','motor_paused');continue;}
   const commentChannel=['ig_comment','fb_comment','tiktok_comment'].includes(conversation.channel);
   const original=await db.from('messages').select('*').eq('id',job.inbound_message_id).is('deleted_at',null).maybeSingle();
   if(original.error)throw new Error('billing_recovery_message_unavailable');
   if(!original.data) {await finish(db,job,'done','message_deleted');continue;}
   let inbound=original.data as Message;
   let coverThrough=job.queued_at;
   if(!commentChannel) {
    const latest=await db.from('messages').select('*').eq('conversation_id',conversation.id).eq('sender_type','customer').is('deleted_at',null).order('created_at',{ascending:false}).limit(1).maybeSingle();
    if(latest.error || !latest.data)throw new Error('billing_recovery_latest_unavailable');
    if(latest.data.id!==inbound.id) {
     // A later live event already owns its reply; only consolidate queued pause events.
     const queued=await db.from('billing_reply_backlog').select('status,queued_at').eq('inbound_message_id',latest.data.id).maybeSingle();
     if(queued.error)throw new Error('billing_recovery_latest_unavailable');
     if(!queued.data || !['pending','processing'].includes(queued.data.status)) {await finish(db,job,'done','superseded_by_live_inbound');continue;}
     inbound=latest.data as Message;
     coverThrough=queued.data.queued_at;
    }
   }
   const metadata=commentChannel?await db.from('comments_meta').select('post_id,parent_comment_id,connection_id').eq('message_id',inbound.id).maybeSingle():null;
   if(metadata?.error)throw new Error('billing_recovery_comment_unavailable');
   const comment=metadata?.data as RecoveryComment|null;
   const [contactResult,connectionResult]=await Promise.all([
    db.from('contacts').select('*').eq('id',conversation.contact_id).eq('workspace_id',job.workspace_id).single(),
    db.from('channel_connections').select('*').eq('id',comment?.connection_id??conversation.connection_id??job.connection_id).eq('workspace_id',job.workspace_id).single(),
   ]);
   if(contactResult.error || connectionResult.error)throw new Error('billing_recovery_channel_unavailable');
   const contact=contactResult.data as Contact,connection=connectionResult.data as ChannelConnection;
   await syncExternalReplies(db,{connection,conversation,contact,inbound,comment});
   let outcome=await answered(db,conversation,inbound,commentChannel);
   if(outcome) {
    await finish(db,job,outcome==='already_answered'?'done':'review',outcome);
    if(!commentChannel && outcome==='already_answered')await consolidateAnsweredConversation(db,job,coverThrough);
    completed++;continue;
   }
   const fresh=await db.from('conversations').select('*').eq('id',conversation.id).single();
   if(fresh.error)throw new Error('billing_recovery_conversation_unavailable');
   const freshDisposition=recoveryDisposition(fresh.data);
   if(freshDisposition) {await finish(db,job,'review',freshDisposition);review++;continue;}
   await withRecoverySendGuard({conversationId:conversation.id,inboundId:inbound.id,createdAt:inbound.created_at,...(commentChannel?{commentId:inbound.message_id}: {})},async()=>{
    if(commentChannel)await routeComment(db,{workspaceId:job.workspace_id,channel:conversation.channel as 'ig_comment'|'fb_comment'|'tiktok_comment',connection,contact:{id:contact.id,external_id:contact.external_id??null,name:contact.name??null},commentId:inbound.message_id??null,postId:comment?.post_id??null,parentCommentId:comment?.parent_comment_id??null,text:inbound.content_text??''});
    else await runAiAgent(db,{workspaceId:job.workspace_id,channel:conversation.channel,conversation:fresh.data,contact,connection,inboundMessage:inbound});
   });
   outcome=await answered(db,conversation,inbound,commentChannel);
   if(!outcome) {
    // Runner reports failed/disabled/window/approval paths in ai_replies; never blindly resend.
    await finish(db,job,'review','reply_requires_review');review++;
   } else {await finish(db,job,outcome==='already_answered'?'done':'review',outcome);completed++;}
   if(!commentChannel && outcome==='already_answered') {
    await consolidateAnsweredConversation(db,job,coverThrough);
   }
  } catch {
   failures.push(job.workspace_id+':billing_recovery_retry');
   await finish(db,job,job.attempts>=5?'review':'pending',job.attempts>=5?'external_history_unverified':'recovery_retry');
  }
 }
 return {completed,review,failures};
}
