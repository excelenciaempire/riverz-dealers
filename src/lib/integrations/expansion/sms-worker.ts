import 'server-only';
import {randomUUID} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {ChannelConnection} from '@/types';
import {z} from 'zod';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {ingestInboundEvent} from '@/lib/channels/inbox-writer';
import {ExpansionProviderError} from './provider-http';
import {smsPhone} from './sms-contract';
const uuid=z.string().uuid(),queue=z.array(z.object({event_id:uuid,connection_id:uuid,payload:z.object({eventId:uuid,messageId:uuid,eventType:z.literal('message.received'),direction:z.literal('inbound'),businessPhone:smsPhone,peer:smsPhone,text:z.string().max(6700),occurredAt:z.string()}).passthrough()}).strict()).max(50);
/** Durable inbound queue only. Retries may ingest the same provider message
 * with an idempotent ID; this worker never sends a provider SMS or runs AI. */
export async function ingestNativeSmsQueue(db:SupabaseClient){
 if(!SHOW_RIVERZ_IMPROVEMENTS)return {claimed:0,ingested:0,failed:0};
 const nonce=randomUUID(),result=await db.rpc('claim_native_sms_events',{p_nonce:nonce,p_limit:20}),parsed=queue.safeParse(result.data);
 if(result.error||!parsed.success)throw new ExpansionProviderError('unavailable');
 const totals={claimed:parsed.data.length,ingested:0,failed:0};
 for(const item of parsed.data){let succeeded=false;try{
  if(item.event_id!==item.payload.eventId)throw new ExpansionProviderError('unavailable');
  const connection=await db.from('channel_connections').select('id,workspace_id,channel,label,status,external_account_id,config,created_at,updated_at').eq('id',item.connection_id).eq('channel','sms').maybeSingle();
  if(connection.error||!connection.data||connection.data.external_account_id!==item.payload.businessPhone)throw new ExpansionProviderError('notAllowed');
  if(connection.data.status==='disconnected')throw new ExpansionProviderError('notAllowed');
  {
   const externalId=`sms:${item.connection_id}:${item.payload.messageId}`;
   const ingested=await ingestInboundEvent(db,{channel:'sms',connection:connection.data as ChannelConnection,externalContactId:item.payload.peer,externalMessageId:externalId,externalThreadId:`sms:${item.connection_id}:${item.payload.peer}`,text:item.payload.text,receivedAt:item.payload.occurredAt,suppressAutoReply:true});
   if(!ingested){
    // Null can mean a duplicate OR a failed/missing insertion. A queue ACK
    // requires the actual scoped message, not a guessed successful ingest.
    const persisted=await db.from('messages').select('id,conversations!inner(workspace_id)').eq('message_id',externalId).eq('conversations.workspace_id',connection.data.workspace_id).limit(2);
    if(persisted.error||persisted.data?.length!==1)throw new ExpansionProviderError('unavailable');
   }
   succeeded=true;totals.ingested++;
  }
 }catch{totals.failed++;}
 const finish=await db.rpc('finish_native_sms_event',{p_event_id:item.event_id,p_nonce:nonce,p_success:succeeded});
 if(finish.error||finish.data!==true)throw new ExpansionProviderError('unavailable');
 }
 return totals;
}
