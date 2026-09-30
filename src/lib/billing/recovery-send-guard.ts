import { AsyncLocalStorage } from 'node:async_hooks';
import type { SupabaseClient } from '@supabase/supabase-js';
type Turn={conversationId:string;inboundId:string;createdAt:string;commentId?:string};
const recoveryTurn=new AsyncLocalStorage<Turn>();
export function withRecoverySendGuard<T>(turn:Turn,action:()=>Promise<T>) {return recoveryTurn.run(turn,action);}
/** A native/manual reply arriving while the model is thinking cancels recovery. */
export async function assertRecoveryStillUnanswered(db:SupabaseClient,conversationId:string) {
 const turn=recoveryTurn.getStore();
 if(!turn || turn.conversationId!==conversationId)return;
 const human=await db.from('messages').select('id').eq('conversation_id',conversationId).eq('sender_type','agent').in('status',['sent','delivered','read']).gte('created_at',turn.createdAt).is('deleted_at',null);
 if(human.error)throw new Error('billing_recovery_history_unavailable');
 if(turn.commentId && human.data?.length) {
  const metadata=await db.from('comments_meta').select('message_id').in('message_id',human.data.map(m=>m.id)).eq('parent_comment_id',turn.commentId).limit(1);
  if(metadata.error)throw new Error('billing_recovery_history_unavailable');
  if(metadata.data?.length)throw new Error('billing_recovery_already_answered');
 } else if(human.data?.length)throw new Error('billing_recovery_already_answered');
 if(!turn.commentId) {
  const newer=await db.from('messages').select('id').eq('conversation_id',conversationId).eq('sender_type','customer').gt('created_at',turn.createdAt).is('deleted_at',null).limit(1);
  if(newer.error)throw new Error('billing_recovery_history_unavailable');
  if(newer.data?.length)throw new Error('billing_recovery_newer_inbound');
 }
}
