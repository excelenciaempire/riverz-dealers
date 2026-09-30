import type { SupabaseClient } from '@supabase/supabase-js'
import type { Locale } from '@/lib/i18n/config'
import type { CapabilityContext } from '@/lib/capabilities/types'
import { prepareGapFaq,type GapKnowledgeInput } from './gap-knowledge'
export type GapKnowledgeContext={ db:SupabaseClient;workspaceId:string;userId:string;locale:Locale }
export function gapCapabilityActor(ctx:CapabilityContext):string {
 const actor=ctx.actor.type==='mcp' ? ctx.actor.userId : ctx.actor.type==='operator' || ctx.actor.type==='ui' ? ctx.actor.id : null
 if (!actor) throw new Error('invalid_gap_context')
 return actor
}
/** Same preparation for the current editor and the Operator/MCP adapters. */
export async function prepareGapKnowledgeReview(ctx:GapKnowledgeContext,input:Extract<GapKnowledgeInput,{action:'preview'}>):Promise<{ data:unknown;error:{message:string}|null }> {
 const sources=await ctx.db.rpc('list_visible_answer_gaps',{ p_workspace_id:ctx.workspaceId,p_actor_id:ctx.userId,p_resolved:false })
 if (sources.error) return sources
 const rows=((sources.data ?? []) as Array<{ id:string;question_key:string;question:string }>).slice(0,500).filter(g => g.question_key===input.key)
 if (!rows.length || !rows.some(g => g.question===input.question)) return { data:null,error:{ message:'invalid_gap_context' } }
 let expected:Record<string,unknown>|null=null,prepared:Record<string,unknown>={},previous:Array<{ q:string;a:string }>=[],targetId:string|null=null,title=input.question
 if (input.destino==='producto') {
  const product=await ctx.db.from('shopify_products').select('*').eq('workspace_id',ctx.workspaceId).eq('id',input.product_id!).maybeSingle()
  if (product.error) return product
  if (!product.data) return { data:null,error:{ message:'invalid_gap_context' } }
  expected=product.data;targetId=product.data.id;title=product.data.title
  const faq=prepareGapFaq(product.data,input.question,input.answer,ctx.locale)
  previous=faq.previous;prepared={ custom_faqs:faq.custom_faqs,training_material:faq.training_material }
 } else {
  const key=input.key.length<=194 ? `hueco_${input.key}` : null
  const rule=key ? await ctx.db.from('agent_guidance').select('*').eq('workspace_id',ctx.workspaceId).eq('clave',key).maybeSingle() : await ctx.db.rpc('gap_existing_guidance',{ p_workspace_id:ctx.workspaceId,p_actor_id:ctx.userId,p_key:input.key })
  if (rule.error) return rule
  expected=rule.data ?? null;targetId=expected?.id as string ?? null
  if (expected) previous=[{ q:String(expected.cuando ?? expected.titulo),a:String(expected.hacer) }]
 }
 const result=await ctx.db.rpc('prepare_gap_knowledge_review',{ p_id:crypto.randomUUID(),p_workspace_id:ctx.workspaceId,p_actor_id:ctx.userId,p_key:input.key,p_question:input.question,p_answer:input.answer,p_destination:input.destino,p_target_id:targetId,p_target_title:title,p_source_ids:rows.map(g => g.id),p_expected:expected,p_prepared:prepared,p_previous:previous })
 return result
}
