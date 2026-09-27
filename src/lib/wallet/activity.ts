import type {SupabaseClient} from '@supabase/supabase-js';
import type {Rango} from './movimientos';

interface ActivityMessage {
  id:string;conversation_id:string;sender_type:string;origin:string|null;status:string;content_text:string|null;
  conversations:{channel:string;contact_id:string|null};
}
export function summarizeActivity(rows:ActivityMessage[]){
  const all=new Set<string>(),automatic=new Set<string>();
  const channels=new Map<string,{contacts:Set<string>;automaticContacts:Set<string>;sent:number;automated:number;failed:number}>();
  for(const m of rows){
    if(!['agent','bot'].includes(m.sender_type)||/replied to (an|your) ad|respondió a (un|tu) anuncio/i.test(m.content_text??''))continue;
    const ch=m.conversations.channel;
    const group=channels.get(ch)??{contacts:new Set<string>(),automaticContacts:new Set<string>(),sent:0,automated:0,failed:0};
    channels.set(ch,group);
    if(m.status==='failed'){group.failed++;continue;}
    if(!['sent','delivered','read'].includes(m.status))continue;
    const contact=m.conversations.contact_id;
    group.sent++;if(contact){group.contacts.add(contact);all.add(contact);}
    if(m.sender_type==='bot'||['ai_agent','comment_ai','automation','order_update','voice_agent'].includes(m.origin??'')){
      group.automated++;if(contact){group.automaticContacts.add(contact);automatic.add(contact);}
    }
  }
  const byChannel=[...channels].map(([channel,c])=>({channel,contacts:c.contacts.size,automaticContacts:c.automaticContacts.size,sent:c.sent,automated:c.automated,failed:c.failed})).sort((a,b)=>b.sent-a.sent);
  return {contacts:all.size,automaticContacts:automatic.size,sent:byChannel.reduce((n,c)=>n+c.sent,0),automated:byChannel.reduce((n,c)=>n+c.automated,0),byChannel};
}
export async function walletActivity(db:SupabaseClient,workspaceId:string,range:Rango){
  const rows:ActivityMessage[]=[];
  for(let offset=0;;offset+=1000){
    const r=await db.from('messages').select('id,conversation_id,sender_type,origin,status,content_text,conversations!inner(channel,contact_id,workspace_id)')
      .eq('conversations.workspace_id',workspaceId).in('sender_type',['agent','bot']).gte('created_at',range.desde).lte('created_at',range.hasta)
      .order('created_at').order('id').range(offset,offset+999);
    if(r.error)throw r.error;rows.push(...(r.data??[]) as unknown as ActivityMessage[]);
    if((r.data?.length??0)<1000)break;
    if(offset>=99000)throw new Error('wallet_activity_range_too_large');
  }
  return summarizeActivity(rows);
}
