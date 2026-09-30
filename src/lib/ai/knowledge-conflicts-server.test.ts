import { describe,expect,it,vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
vi.mock('server-only',() => ({}))
import { loadKnowledgeConflictSnapshot } from './knowledge-conflicts-server'
const ws='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',gap='55555555-5555-4555-8555-555555555555',product='66666666-6666-4666-8666-666666666666',id='77777777-7777-4777-8777-777777777777'
const target={ id:product,title:'Product',custom_faqs:[{ q:'Sunday delivery?',a:'No Sunday delivery.' }] }
const row={ id,actor_id:actor,state:'review',expires_at:'2099-09-30T12:00:00Z',question_key:'delivery',question:'Delivery?',answer:'Monday to Saturday.',destination:'producto',target_id:product,source_ids:[gap],expected_snapshot:target }
function fixture(options:{ review?:(Partial<Omit<typeof row,'target_id'|'expected_snapshot'>> & { target_id?:string|null;expected_snapshot?:Record<string,unknown>|null })|null;visible?:string[];target?:unknown;rules?:unknown[];error?:unknown;ruleTarget?:unknown }={}) {
 const calls:{ table:string;method:string;args:unknown[] }[]=[],rpc=vi.fn(async(name:string) => name==='list_visible_answer_gaps' ? { data:(options.visible ?? [gap]).map(id => ({ id })),error:null } : { data:options.ruleTarget ?? null,error:null })
 const from=vi.fn((table:string) => {
  const q:Record<string,unknown>={}
  for (const method of ['select','eq','is','order']) q[method]=(...args:unknown[]) => { calls.push({ table,method,args });return q }
  q.maybeSingle=async() => ({ data:table==='gap_knowledge_reviews' ? options.review===null ? null : { ...row,...options.review } : Object.hasOwn(options,'target') ? options.target : target,error:options.error ?? null })
  q.limit=async() => ({ data:options.rules ?? [],error:null });return q
 })
 return { ctx:{ db:{ from,rpc } as unknown as SupabaseClient,workspaceId:ws,userId:actor,locale:'en' as const },calls,rpc,from }
}
describe('current-access snapshot for a pending knowledge review',() => {
 it('uses the authenticated author and exact review receipt, without writes or deriving its grouping key',async() => {
  const f=fixture(),result=await loadKnowledgeConflictSnapshot(f.ctx,id);expect(result.sources).toHaveLength(1);expect(f.calls).toContainEqual({ table:'gap_knowledge_reviews',method:'eq',args:['actor_id',actor] });expect(f.calls).toContainEqual({ table:'gap_knowledge_reviews',method:'eq',args:['workspace_id',ws] });expect(f.calls).toContainEqual({ table:'agent_guidance',method:'is',args:['agent_id',null] });expect(f.rpc).toHaveBeenCalledWith('list_visible_answer_gaps',{ p_workspace_id:ws,p_actor_id:actor,p_resolved:false })
 })
 it('rejects nonexistent, published and expired reviews before consulting policies',async() => {
  for (const review of [null,{ state:'published' },{ expires_at:'2020-01-01T00:00:00Z' },{ expires_at:'not a date' }]) { const f=fixture({ review });await expect(loadKnowledgeConflictSnapshot(f.ctx,id)).rejects.toThrow();expect(f.from).toHaveBeenCalledTimes(1) }
 })
 it('does not use a source case whose current access or pending state was lost',async() => {
  const f=fixture({ visible:[] });await expect(loadKnowledgeConflictSnapshot(f.ctx,id)).rejects.toThrow('invalid_gap_context');expect(f.from).toHaveBeenCalledTimes(1)
 })
 it('rejects changed and deleted product snapshots before spending tokens',async() => {
  await expect(loadKnowledgeConflictSnapshot(fixture({ target:{ ...target,title:'Changed' } }).ctx,id)).rejects.toThrow('gap_changed');await expect(loadKnowledgeConflictSnapshot(fixture({ target:null }).ctx,id)).rejects.toThrow('invalid_gap_context')
 })
 it('looks up a global rule using the exact stored key and allows an absent new target',async() => {
  const f=fixture({ review:{ destination:'regla',target_id:null,expected_snapshot:null,question_key:'long stored key' } });await loadKnowledgeConflictSnapshot(f.ctx,id);expect(f.rpc).toHaveBeenCalledWith('gap_existing_guidance',{ p_workspace_id:ws,p_actor_id:actor,p_key:'long stored key' })
 })
 it('changes the snapshot hash when another active rule changes during inference',async() => {
  const rule={ id,title:'unused',titulo:'Delivery',cuando:null,hacer:'Weekdays',live_revision:1 },a=fixture({ rules:[rule] }),b=fixture({ rules:[{ ...rule,live_revision:2 }] });expect((await loadKnowledgeConflictSnapshot(a.ctx,id)).hash).not.toBe((await loadKnowledgeConflictSnapshot(b.ctx,id)).hash)
 })
 it('propagates database errors without inventing a review result',async() => {
  await expect(loadKnowledgeConflictSnapshot(fixture({ error:new Error('unavailable') }).ctx,id)).rejects.toThrow('unavailable')
 })
})
