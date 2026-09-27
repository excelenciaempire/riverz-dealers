import type {SupabaseClient} from '@supabase/supabase-js';
import {resolverWabaYToken} from '@/lib/templates/create';
import {withAppsecretProof} from '@/lib/channels/meta-graph';
import {normalizeTemplateStatusEvent} from '@/lib/whatsapp/template-webhooks';
import {reconcileWorkspaceAutomationReadiness} from './activation';

/** Read Meta, update exact local identities, never enroll or replay a customer. */
export async function syncAutomationTemplates(db:SupabaseClient,workspaceId:string):Promise<number>{
  const owner=await db.from('workspaces').select('owner_id').eq('id',workspaceId).single();
  if(owner.error)throw owner.error;
  const {wabaId,accessToken}=await resolverWabaYToken(db,workspaceId,owner.data.owner_id);
  let after:string|undefined,changed=0;
  const seen=new Set<string>();
  do{
    const url=new URL(`https://graph.facebook.com/v21.0/${wabaId}/message_templates`);
    url.searchParams.set('fields','id,name,language,status');url.searchParams.set('limit','100');
    if(after)url.searchParams.set('after',after);
    const response=await fetch(withAppsecretProof(url.toString(),accessToken),{headers:{Authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(15000),cache:'no-store'});
    const page=await response.json();
    if(!response.ok)throw new Error(`Meta template sync HTTP ${response.status}, code ${page.error?.code??'unknown'}`);
    if(!Array.isArray(page.data))throw new Error('invalid Meta template response');
    for(const t of page.data){
      const status=normalizeTemplateStatusEvent(t.status);if(!status)continue;
      const result=await db.from('message_templates').update({status,meta_status:t.status})
        .eq('workspace_id',workspaceId).eq('waba_id',wabaId).eq('name',t.name).eq('language',t.language)
        .or(`status.neq.${status},meta_status.is.null,meta_status.neq.${t.status}`).select('id');
      if(result.error)throw result.error;changed+=result.data?.length??0;
    }
    after=page.paging?.next?page.paging?.cursors?.after:undefined;
    if(after&&seen.has(after))throw new Error('repeated Meta pagination cursor');
    if(after)seen.add(after);
  }while(after);
  await reconcileWorkspaceAutomationReadiness(db,workspaceId);
  return changed;
}
