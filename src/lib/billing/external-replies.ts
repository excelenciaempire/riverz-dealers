import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection, Contact, Conversation, Message } from '@/types';
import { decrypt } from '@/lib/channels/encryption';
import { resolveThreadId, syncThreadMessages } from '@/lib/channels/meta-dm-history';
import { appWebhookBaseUrl, getAppWebhookSubscriptions, isWabaSubscribed, whatsappSubscriptionSnapshot, withAppsecretProof } from '@/lib/channels/meta-graph';
import { replayablePayload, WHATSAPP_JOURNAL_PROVIDER } from '@/lib/channels/whatsapp/journal';
import { getAdapter } from '@/lib/channels/registry';
import { ingestInboundEvent } from '@/lib/channels/inbox-writer';
import { buildSelfCommentEvent } from '@/lib/channels/comment-echo';

export type RecoveryComment={post_id:string|null;parent_comment_id:string|null;connection_id:string|null};
type Context={connection:ChannelConnection;conversation:Conversation;contact:Contact;inbound:Message;comment:RecoveryComment|null};
function secret(connection:ChannelConnection) {
 const enc=(connection.secrets as Record<string,unknown>)?.access_token;
 if(typeof enc!=='string' || !enc)throw new Error('external_history_token_unavailable');
 return decrypt(enc);
}
async function graph(path:string,token:string) {
 const url=path.startsWith('https://')?new URL(path):new URL('https://graph.facebook.com/v22.0/'+path);
 if(url.hostname!=='graph.facebook.com')throw new Error('external_history_invalid_host');
 url.searchParams.set('access_token',token);
 const response=await fetch(withAppsecretProof(url.toString(),token),{signal:AbortSignal.timeout(15_000)});
 if(!response.ok)throw new Error('external_history_unavailable');
 return response.json();
}

/** Import native replies first. An incomplete/failed sync never means "unanswered". */
export async function syncExternalReplies(db:SupabaseClient,args:Context) {
 const {connection,conversation,contact,inbound,comment}=args;
 const cfg=(connection.config??{}) as Record<string,unknown>;
 const since=new Date(Date.parse(inbound.created_at)-300_000).toISOString();
 if(connection.channel==='instagram' || connection.channel==='messenger') {
  const token=secret(connection),page=String(cfg.page_id??cfg.ig_user_id??connection.external_account_id??'');
  const thread=await resolveThreadId(token,page,connection.channel,contact.external_id??'');
  if(!thread)throw new Error('external_thread_unverified');
  await syncThreadMessages({token,connection,selfId:String(connection.channel==='instagram'?cfg.ig_user_id??connection.external_account_id:cfg.page_id??connection.external_account_id),threadId:thread,externalId:contact.external_id??'',contactName:contact.name??undefined,createIfMissing:false,sinceIso:since,maxPages:10,onCheckpoint:async()=>{},deadlineMs:Date.now()+75_000});
  return;
 }
 if(connection.channel==='whatsapp') {
  if(cfg.coexistence===true) {
   const subscriptions=whatsappSubscriptionSnapshot(await getAppWebhookSubscriptions());
   if(!subscriptions?.active || !subscriptions.fields.includes('smb_message_echoes') || subscriptions.callbackHost!==new URL(appWebhookBaseUrl()).host)throw new Error('native_whatsapp_sync_unverified');
   const waba=String(cfg.waba_id??'');
   if(!waba || await isWabaSubscribed(waba,secret(connection))!==true)throw new Error('native_whatsapp_account_unverified');
  }
  const phone=String(cfg.phone_number_id??connection.external_account_id??'');
  const target=(contact.external_id??contact.phone??'').replace(/\D/g,'');
  for(let offset=0;offset<2000;offset+=100) {
   const rows=await db.from('webhook_events_raw').select('raw_body').eq('provider',WHATSAPP_JOURNAL_PROVIDER).eq('account_id',phone).gte('received_at',since).order('received_at').order('id').range(offset,offset+99);
   if(rows.error)throw new Error('native_whatsapp_journal_unavailable');
   for(const row of rows.data??[]) {
    const payload=replayablePayload(JSON.parse(row.raw_body),phone,(_item,external)=>external.replace(/\D/g,'')===target);
    if(!payload)continue;
    const rawBody=JSON.stringify(payload);
    const events=await getAdapter('whatsapp').parseWebhook({payload,rawBody,request:new Request('https://riverz.co/api/channels/whatsapp/webhook',{method:'POST',body:rawBody})},connection);
    for(const event of events)if(event.outbound)await ingestInboundEvent(db,{...event,historical:true,createIfMissing:false});
   }
   if((rows.data??[]).length<100)return;
  }
  throw new Error('native_whatsapp_journal_incomplete');
 }
 if(connection.channel==='ig_comment' || connection.channel==='fb_comment') {
  if(!inbound.message_id)throw new Error('external_comment_unverified');
  const token=secret(connection),ig=connection.channel==='ig_comment';
  let username=String(cfg.username??cfg.ig_username??'');
  const ownId=String(ig?cfg.ig_user_id??connection.external_account_id:cfg.page_id??connection.external_account_id);
  if(ig && !username)username=String((await graph(encodeURIComponent(ownId)+'?fields=username',token)).username??'');
  if(ig && !username)throw new Error('external_comment_owner_unverified');
  let url:string|null=encodeURIComponent(inbound.message_id)+(ig?'/replies?fields=id,text,username,timestamp&limit=100':'/comments?fields=id,message,from,created_time&limit=100');
  for(let page=0;url && page<10;page++) {
   const result=await graph(url,token);
   for(const reply of result.data??[]) {
    const own=ig?String(reply.username??'').toLowerCase()===username.toLowerCase():reply.from?.id===ownId;
    if(!own)continue;
    const event=await buildSelfCommentEvent(db,{channel:connection.channel,connection,commentId:reply.id,parentCommentId:inbound.message_id,postId:comment?.post_id,text:reply.text??reply.message??'',receivedAt:reply.timestamp??reply.created_time});
    if(event)await ingestInboundEvent(db,{...event,historical:true,createIfMissing:false});
   }
   url=result.paging?.next??null;
  }
  if(url)throw new Error('external_comment_sync_incomplete');
  return;
 }
 if(connection.channel==='tiktok_comment') {
  if(!comment?.post_id)throw new Error('external_comment_video_unverified');
  const {getFreshTikTokToken}=await import('@/lib/channels/tiktok_comment/adapter');
  const {ingestVideoComments}=await import('@/lib/channels/tiktok_comment/poll');
  await ingestVideoComments(db,connection,String(cfg.business_id??''),await getFreshTikTokToken(connection),comment.post_id,undefined,{reconcile:true,suppressAutoReply:true,requireComplete:true});
  return;
 }
 if(connection.channel==='gmail' || connection.channel==='outlook' || connection.channel==='zoho') {
  const poller=connection.channel==='gmail'?await import('@/lib/channels/gmail/poll'):connection.channel==='outlook'?await import('@/lib/channels/outlook/poll'):await import('@/lib/channels/zoho/poll');
  const started=Date.now();
  await poller.pollOne(db,connection);
  const fresh=await db.from('channel_connections').select('last_synced_at,config').eq('id',connection.id).single();
  if(fresh.error || Date.parse(fresh.data.last_synced_at??'')<started || fresh.data.config?.poll_sync_complete!==true)throw new Error('external_email_sync_incomplete');
  return;
 }
 // Webchat has no external native app. Other channels require verified sync support.
 if(conversation.channel!=='webchat')throw new Error('external_history_requires_review');
}
