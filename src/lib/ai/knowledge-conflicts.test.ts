import { describe,expect,it } from 'vitest'
import { conflictSources,knowledgeSnapshotHash,parseKnowledgeConflicts } from './knowledge-conflicts'
const product='66666666-6666-4666-8666-666666666666',rule='77777777-7777-4777-8777-777777777777'
const review={ question:'Delivery?',destination:'producto',target_id:product,expected_snapshot:{ custom_faqs:[{ q:'DELIVERY!!',a:'Old answer being explicitly replaced' },{ q:'Weekend delivery?',a:'No deliveries on Sundays, except reserved collections.' }] } }
const policy={ id:rule,titulo:'Shipping policy',cuando:'Shipping questions',hacer:'Delivery Monday through Saturday.',live_revision:3 }
describe('bounded advisory knowledge conflict review',() => {
 it('compares other FAQs and global rules while keeping the explicitly replaced FAQ separate',() => {
  const result=conflictSources(review,[policy]);expect(result.truncated).toBe(false);expect(result.sources.map(s => s.kind)).toEqual(['faq','rule']);expect(result.sources[0].answer).toContain('except reserved collections');expect(JSON.stringify(result)).not.toContain('Old answer being explicitly replaced');expect(result.sources[1].revision).toBe(3)
 })
 it('does not call the existing version being replaced a separate conflicting rule',() => {
  expect(conflictSources({ ...review,destination:'regla',target_id:rule },[policy]).sources).toEqual([])
 })
 it('omits whole oversized conditions and declares partial coverage instead of cutting exceptions',() => {
  const result=conflictSources(review,[{ ...policy,hacer:'x'.repeat(16000)+' except on Sundays' }]);expect(result.truncated).toBe(true);expect(result.sources).toHaveLength(1);expect(JSON.stringify(result)).not.toContain('xxxxxxxx')
  const many=conflictSources({ ...review,expected_snapshot:null },Array.from({ length:51 },(_,i) => ({ ...policy,id:`rule-${i}` })));expect(many.sources).toHaveLength(50);expect(many.truncated).toBe(true)
 })
 it('treats an empty result as an observation rather than certification or permission',() => {
  const sources=conflictSources(review,[policy]).sources;expect(parseKnowledgeConflicts(JSON.stringify({ summary:'No overlap found in this sample',conflicts:[] }),sources)).toEqual({ summary:'No overlap found in this sample',conflicts:[] })
 })
 it('accepts only supplied source identifiers and bounded public findings',() => {
  const sources=conflictSources(review,[policy]).sources,data={ summary:'Possible shipping inconsistency',conflicts:[{ source_id:sources[0].id,reason:'The answer may promise Sunday delivery without its condition.' }] }
  expect(parseKnowledgeConflicts(JSON.stringify(data),sources)).toEqual(data)
  for (const bad of [{ ...data,approved:true },{ ...data,conflicts:[{ source_id:'foreign-business-rule',reason:'Private rule' }] },{ ...data,conflicts:[...data.conflicts,...data.conflicts] },{ ...data,conflicts:[{ ...data.conflicts[0],reason:'r'.repeat(501) }] },{ ...data,summary:'' },{ ...data,conflicts:[{ ...data.conflicts[0],reasoning:'private reasoning' }] }]) expect(parseKnowledgeConflicts(JSON.stringify(bad),sources)).toBeNull()
  expect(parseKnowledgeConflicts('not JSON',sources)).toBeNull();expect(parseKnowledgeConflicts('x'.repeat(16001),sources)).toBeNull()
 })
 it('detects changes in conditions or versions independent of JSON key order',() => {
  expect(knowledgeSnapshotHash({ a:1,nested:{ b:2,a:3 } })).toBe(knowledgeSnapshotHash({ nested:{ a:3,b:2 },a:1 }));expect(knowledgeSnapshotHash(policy)).not.toBe(knowledgeSnapshotHash({ ...policy,live_revision:4 }));expect(knowledgeSnapshotHash(review)).not.toBe(knowledgeSnapshotHash({ ...review,answer:'Only Tuesdays' }))
 })
})
