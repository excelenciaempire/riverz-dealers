import { claveDePregunta } from './answer-gaps'
import { UUID } from '@/lib/inbox/collaboration'
import { buildTrainingMaterial } from '@/lib/products/training-material'

export type GapKnowledgeInput = { action:'preview';key:string;question:string;answer:string;destino:'producto'|'regla';product_id?:string } | { action:'confirm';review_id:string }
export function gapKnowledgeInput(value:unknown):GapKnowledgeInput | null {
  if (!value || typeof value!=='object' || Array.isArray(value)) return null
  const b=value as Record<string,unknown>
  if (b.action==='confirm') return Object.keys(b).every(k => ['action','review_id'].includes(k)) && typeof b.review_id==='string' && UUID.test(b.review_id) ? { action:'confirm',review_id:b.review_id } : null
  if (b.action!=='preview' || Object.keys(b).some(k => !['action','key','question','answer','destino','product_id'].includes(k))) return null
  if (typeof b.key!=='string' || !b.key.trim() || b.key.length>200 || typeof b.question!=='string' || !b.question.trim() || b.question.trim().length>500 || typeof b.answer!=='string' || !b.answer.trim() || b.answer.trim().length>2000) return null
  const destino=b.destino===undefined ? 'producto' : b.destino
  if (destino!=='producto' && destino!=='regla' || destino==='producto' && (typeof b.product_id!=='string' || !UUID.test(b.product_id))) return null
  return { action:'preview',key:b.key,question:b.question.trim(),answer:b.answer.trim(),destino,...(destino==='producto' ? { product_id:b.product_id as string } : {}) }
}
/** The existing compiler remains the sole source of product prompt material. */
export function prepareGapFaq(product:Record<string,unknown>,question:string,answer:string,locale:'es'|'en') {
  const existing=Array.isArray(product.custom_faqs) ? product.custom_faqs : []
  const faqs=existing.map(f => ({ q:typeof f?.q==='string' ? f.q.trim() : '',a:typeof f?.a==='string' ? f.a.trim() : '' })).filter(f => f.q && f.a)
  const key=claveDePregunta(question)
  const previous=faqs.filter(f => claveDePregunta(f.q)===key)
  const next=[...faqs.filter(f => claveDePregunta(f.q)!==key),{ q:question,a:answer }]
  return { previous,custom_faqs:next,training_material:buildTrainingMaterial({ ...product,custom_faqs:next },locale) }
}
