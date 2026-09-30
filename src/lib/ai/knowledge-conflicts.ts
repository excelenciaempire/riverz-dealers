import { createHash } from 'node:crypto'
import { z } from 'zod'
import { claveDePregunta } from './answer-gaps'
import { redactModelSecrets } from '@/lib/security/model-secrets'
export type ConflictSource={ id:string;kind:'faq'|'rule';title:string;condition:string;answer:string;revision:number | null }
export type KnowledgeConflictResult={ summary:string;conflicts:{ source_id:string;reason:string }[] }
export type KnowledgeConflictView={ review_id:string;observed_at:string;sources:ConflictSource[];truncated:boolean;result:KnowledgeConflictResult }
const resultSchema=z.object({ summary:z.string().trim().min(1).max(1000),conflicts:z.array(z.object({ source_id:z.string().min(1).max(100),reason:z.string().trim().min(1).max(500) }).strict()).max(10) }).strict()
export function parseKnowledgeConflicts(text:string,sources:readonly ConflictSource[]):KnowledgeConflictResult | null {
 if (text.length>16000) return null
 let value:unknown;try { value=JSON.parse(text) } catch { return null }
 const parsed=resultSchema.safeParse(value);if (!parsed.success) return null
 const known=new Set(sources.map(s => s.id)),seen=new Set<string>()
 for (const conflict of parsed.data.conflicts) { if (!known.has(conflict.source_id) || seen.has(conflict.source_id)) return null;seen.add(conflict.source_id) }
 return { summary:redactModelSecrets(parsed.data.summary),conflicts:parsed.data.conflicts.map(c => ({ ...c,reason:redactModelSecrets(c.reason) })) }
}
/** Compare snapshots independent of JSON key ordering; never print private snapshots. */
export function knowledgeSnapshotHash(value:unknown):string {
 const stable=(v:unknown):unknown => Array.isArray(v) ? v.map(stable) : v && typeof v==='object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k,stable((v as Record<string,unknown>)[k])])) : v
 return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
}
export function conflictSources(review:{ question:string;destination:string;target_id:string | null;expected_snapshot:Record<string,unknown> | null },rules:Array<{ id:string;titulo:string;cuando:string | null;hacer:string;live_revision:number }>) {
 const candidates:ConflictSource[]=[],key=claveDePregunta(review.question)
 if (review.destination==='producto') {
  const faqs=review.expected_snapshot?.custom_faqs
  if (Array.isArray(faqs)) faqs.forEach((faq,index) => {
   if (typeof faq?.q==='string' && typeof faq?.a==='string' && faq.q.trim() && faq.a.trim() && claveDePregunta(faq.q)!==key) candidates.push({ id:`faq:${review.target_id}:${index}`,kind:'faq',title:faq.q,condition:faq.q,answer:faq.a,revision:null })
  })
 }
 for (const rule of rules) if (review.destination!=='regla' || rule.id!==review.target_id) candidates.push({ id:`rule:${rule.id}`,kind:'rule',title:rule.titulo,condition:rule.cuando ?? '',answer:rule.hacer,revision:rule.live_revision })
 const sources:ConflictSource[]=[],seen=new Set<string>();let truncated=rules.length>50
 for (const source of candidates) {
  // Complete source text only. A cut-off exception could reverse a policy.
  if (sources.length>=50 || source.title.length>500 || source.condition.length>4000 || source.answer.length>16000 || JSON.stringify([...sources,source]).length>100000) { truncated=true;continue }
  if (seen.has(source.id)) { truncated=true;continue };seen.add(source.id)
  sources.push({ ...source,title:redactModelSecrets(source.title),condition:redactModelSecrets(source.condition),answer:redactModelSecrets(source.answer) })
 }
 return { sources,truncated }
}
