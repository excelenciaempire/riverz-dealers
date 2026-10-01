import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { CASE_REASONS,UUID } from '@/lib/inbox/collaboration';

export const CASE_REASON_TOOL: Anthropic.Tool = {
  name:'clasificar_motivo',
  description:'Clasifica el motivo principal de esta consulta únicamente cuando sea claro: purchase (comprar o consultar productos), delivery (envío o entrega), payment (pago), return (devolución o cambio), other (otro motivo claro). Cita literalmente un fragmento del último mensaje del cliente. No inventes evidencia, no clasifiques dudas ambiguas y no cambies una decisión humana. Esto solo registra una categoría interna; no resuelve, cierra ni prioriza el caso.',
  input_schema:{type:'object',properties:{reason:{type:'string',enum:[...CASE_REASONS]},quote:{type:'string',minLength:10,maxLength:500}},required:['reason','quote'],additionalProperties:false},
};
const inputSchema=z.object({reason:z.enum(CASE_REASONS),quote:z.string().trim().min(10).max(500)}).strict();
export interface CaseReasonRuntime {db:SupabaseClient;workspaceId:string;agentId:string;conversationId:string;contactId:string;messageId:string}
export async function classifyCaseReason(runtime:CaseReasonRuntime|null|undefined,input:unknown,simulation=false):Promise<string> {
  if(!SHOW_RIVERZ_IMPROVEMENTS)return JSON.stringify({ok:false,error:'case_classification_unavailable'});
  const parsed=inputSchema.safeParse(input);
  if(!parsed.success)return JSON.stringify({ok:false,error:'case_classification_invalid'});
  if(simulation)return JSON.stringify({ok:true,simulado:true,reason:parsed.data.reason});
  if(!runtime || [runtime.workspaceId,runtime.agentId,runtime.conversationId,runtime.contactId,runtime.messageId].some(id=>!UUID.test(id)))return JSON.stringify({ok:false,error:'case_classification_unavailable'});
  try {
    const {data,error}=await runtime.db.rpc('classify_conversation_reason',{p_workspace_id:runtime.workspaceId,p_agent_id:runtime.agentId,
      p_conversation_id:runtime.conversationId,p_contact_id:runtime.contactId,p_message_id:runtime.messageId,p_reason:parsed.data.reason,p_quote:parsed.data.quote});
    if(error || !data || !['recorded','preserved'].includes(data.status) || (data.reason!==null && !CASE_REASONS.includes(data.reason)))return JSON.stringify({ok:false,error:'case_classification_unavailable'});
    return JSON.stringify({ok:true,status:data.status,reason:data.reason});
  } catch {return JSON.stringify({ok:false,error:'case_classification_unavailable'});}
}
