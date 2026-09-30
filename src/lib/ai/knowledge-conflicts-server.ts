import 'server-only'
import type { GapKnowledgeContext } from './gap-knowledge-actions'
import { conflictSources,knowledgeSnapshotHash } from './knowledge-conflicts'
type Review={ id:string;actor_id:string;state:string;expires_at:string;question_key:string;question:string;answer:string;destination:string;target_id:string|null;source_ids:string[];expected_snapshot:Record<string,unknown>|null }
type Rule={ id:string;titulo:string;cuando:string|null;hacer:string;live_revision:number }
export async function loadKnowledgeConflictSnapshot(ctx:GapKnowledgeContext,id:string) {
 const receipt=await ctx.db.from('gap_knowledge_reviews').select('id,actor_id,state,expires_at,question_key,question,answer,destination,target_id,source_ids,expected_snapshot').eq('workspace_id',ctx.workspaceId).eq('actor_id',ctx.userId).eq('id',id).maybeSingle()
 if (receipt.error) throw receipt.error
 const review=receipt.data as Review | null
 if (!review) throw new Error('invalid_gap_context')
 if (review.state!=='review' || !(Date.parse(review.expires_at)>Date.now())) throw new Error('gap_changed')
 const current=await ctx.db.rpc('list_visible_answer_gaps',{ p_workspace_id:ctx.workspaceId,p_actor_id:ctx.userId,p_resolved:false })
 if (current.error) throw current.error
 const visible=new Set(((current.data ?? []) as { id:string }[]).map(g => g.id))
 if (!review.source_ids.length || review.source_ids.some(source => !visible.has(source))) throw new Error('invalid_gap_context')
 let target:unknown=null
 if (review.destination==='producto') {
  const found=await ctx.db.from('shopify_products').select('*').eq('workspace_id',ctx.workspaceId).eq('id',review.target_id!).maybeSingle();if (found.error) throw found.error;if (!found.data) throw new Error('invalid_gap_context');target=found.data
 } else {
  const found=await ctx.db.rpc('gap_existing_guidance',{ p_workspace_id:ctx.workspaceId,p_actor_id:ctx.userId,p_key:review.question_key })
  if (found.error) throw found.error;target=found.data
 }
 if (knowledgeSnapshotHash(target)!==knowledgeSnapshotHash(review.expected_snapshot)) throw new Error('gap_changed')
 const peers=await ctx.db.from('agent_guidance').select('id,titulo,cuando,hacer,live_revision').eq('workspace_id',ctx.workspaceId).eq('activa',true).is('agent_id',null).order('id',{ ascending:true }).limit(51)
 if (peers.error) throw peers.error
 const rules=(peers.data ?? []) as Rule[],prepared=conflictSources(review,rules)
 return { review,...prepared,hash:knowledgeSnapshotHash({ review,target,rules }) }
}
