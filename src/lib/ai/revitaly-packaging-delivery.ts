import type {SupabaseClient} from '@supabase/supabase-js';
import type {ChannelConnection,Contact,Conversation} from '@/types';
import {REVITALY_EMAIL_WORKSPACE} from '@/lib/channels/email/whatsapp-referral';
import {REVITALY_PACKAGING_NOTICE,REVITALY_PACKAGING_TEMPLATE,REVITALY_PACKAGING_WAITING,loadRevitalyPackagingNotice} from './revitaly-packaging';

/** Sends only merchant-authorized, already-reserved notices after Meta approves the exact body. */
export async function deliverQueuedRevitalyPackaging(db:SupabaseClient,workspaceId:string):Promise<number>{
  if(workspaceId!==REVITALY_EMAIL_WORKSPACE)return 0;
  const template=await db.from('message_templates').select('waba_id,body_text,status,meta_status')
    .eq('workspace_id',workspaceId).eq('name',REVITALY_PACKAGING_TEMPLATE).eq('language','es').maybeSingle();
  if(template.error)throw template.error;
  if(!template.data||template.data.status!=='Approved'||template.data.meta_status!=='APPROVED'||template.data.body_text!==REVITALY_PACKAGING_NOTICE)return 0;
  if(!await loadRevitalyPackagingNotice(db,workspaceId,'Consulta por envase diferente'))return 0;
  const pending=await db.from('messages').select('id,conversation_id,conversations!inner(workspace_id)')
    .eq('conversations.workspace_id',workspaceId).eq('channel','whatsapp').eq('template_name',REVITALY_PACKAGING_TEMPLATE)
    .eq('status','sending').eq('error_reason',REVITALY_PACKAGING_WAITING).eq('content_text',REVITALY_PACKAGING_NOTICE).limit(25);
  if(pending.error)throw pending.error;let sent=0;
  for(const message of pending.data??[]){
    const cr=await db.from('conversations').select('*').eq('workspace_id',workspaceId).eq('id',message.conversation_id).single();
    if(cr.error)throw cr.error;const conversation=cr.data as Conversation;
    const [co,cn]=await Promise.all([db.from('contacts').select('*').eq('workspace_id',workspaceId).eq('id',conversation.contact_id).single(),
      db.from('channel_connections').select('*').eq('workspace_id',workspaceId).eq('id',conversation.connection_id!).eq('channel','whatsapp').single()]);
    if(co.error||cn.error)throw co.error||cn.error;
    const contact=co.data as Contact;const connection=cn.data as ChannelConnection;
    if(String(connection.config?.waba_id)!==String(template.data.waba_id))throw new Error('packaging_template_waba_mismatch');
    const claim=await db.from('messages').update({error_reason:null}).eq('id',message.id).eq('status','sending')
      .eq('error_reason',REVITALY_PACKAGING_WAITING).select('id').maybeSingle();
    if(claim.error)throw claim.error;if(!claim.data)continue;
    try{
      const {getAdapter}=await import('@/lib/channels/registry');
      const result=await getAdapter('whatsapp').sendTemplate!({channel:'whatsapp',connection,conversation,contact,
        templateName:REVITALY_PACKAGING_TEMPLATE,language:'es',params:[]});
      if(!result.externalMessageId)throw new Error('packaging_template_missing_receipt');
      const saved=await db.from('messages').update({message_id:result.externalMessageId,status:result.status??'sent',held_for_quality:result.heldForQuality??false})
        .eq('id',message.id).eq('status','sending');
      if(saved.error)throw saved.error;
      const updated=await db.from('conversations').update({last_message_text:REVITALY_PACKAGING_NOTICE.slice(0,200),last_message_at:new Date().toISOString(),last_sender_type:'bot',updated_at:new Date().toISOString()})
        .eq('workspace_id',workspaceId).eq('id',conversation.id);
      if(updated.error)throw updated.error;sent++;
    }catch(error){
      // An uncertain remote send must never be retried automatically.
      await db.from('messages').update({status:'failed',error_reason:'revitaly_packaging_template_send_failed'}).eq('id',message.id).eq('status','sending');
      throw error;
    }
  }
  return sent;
}
