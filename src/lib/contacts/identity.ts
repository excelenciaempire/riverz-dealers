import type { SupabaseClient } from '@supabase/supabase-js';
import { UUID } from '@/lib/inbox/collaboration';
import { PERSONAL_EMAIL_CHANNELS } from '@/lib/inbox/access';

/** IDs only, from a single database snapshot of the current identity and its complete family. */
export async function verifiedContactIds(db: SupabaseClient,workspaceId: string|undefined,contactId: string,source: 'system'|'human' = 'system'): Promise<string[]> {
  if (!workspaceId || !UUID.test(workspaceId) || !UUID.test(contactId)) return [contactId];
  try {
    const { data,error } = await db.rpc(source==='human'?'contact_identity_family':'verified_contact_family', {p_workspace_id:workspaceId,p_contact_id:contactId});
    if (error || !Array.isArray(data) || !data.length || data.length>50 || !data.includes(contactId) || !data.every(id=>typeof id==='string' && UUID.test(id))) return [contactId];
    return [...new Set(data)];
  } catch { return [contactId]; }
}

export async function verifiedConversationIds(db: SupabaseClient,conversation: {id:string;workspace_id:string;contact_id:string|null;channel?:string},options: {excludePersonalEmail?:boolean} = {}): Promise<string[]> {
  if(options.excludePersonalEmail && (!conversation.channel || (PERSONAL_EMAIL_CHANNELS as readonly string[]).includes(conversation.channel))) return [];
  const fallback=[conversation.id];
  if (!conversation.contact_id || !UUID.test(conversation.contact_id) || !UUID.test(conversation.workspace_id)) return fallback;
  try {
    const ids=await verifiedContactIds(db,conversation.workspace_id,conversation.contact_id);
    let query=db.from('conversations').select('id,workspace_id,contact_id,channel')
      .eq('workspace_id',conversation.workspace_id).in('contact_id',ids).is('deleted_at',null);
    if(options.excludePersonalEmail)query=query.not('channel','in',`(${PERSONAL_EMAIL_CHANNELS.join(',')})`);
    const {data,error}=await query.limit(200);
    if(error || !Array.isArray(data) || data.length>200) return fallback;
    if(data.some(c=>!c || !UUID.test(c.id) || c.workspace_id!==conversation.workspace_id || !ids.includes(c.contact_id))) return fallback;
    const safe=options.excludePersonalEmail ? data.filter(c=>typeof c.channel==='string' && !(PERSONAL_EMAIL_CHANNELS as readonly string[]).includes(c.channel)) : data;
    return [...new Set([conversation.id,...safe.map(c=>c.id)])];
  } catch {return fallback;}
}
