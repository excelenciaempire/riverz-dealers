import { UUID } from './collaboration'
export const TRANSLATION_LANGUAGES = ['es','en','pt','fr','it','de'] as const
export type TranslationLanguage = typeof TRANSLATION_LANGUAGES[number]
export type UnderstandingAction = { action:'summary' } | { action:'audio_summary'; message_id:string } |
  { action:'translate_incoming'; message_id:string; target:TranslationLanguage } | { action:'translate_outgoing'; text:string; target:TranslationLanguage }
export interface UnderstandingResult { text:string; original?:string; target?:TranslationLanguage; message_id?:string;
  source:{ count:number; first_at:string | null; last_at:string | null; truncated:boolean } }
export function understandingAction(raw:unknown):UnderstandingAction | null {
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) return null
  const v=raw as Record<string,unknown>,keys=Object.keys(v)
  if (v.action==='summary' && keys.length===1) return { action:'summary' }
  if (v.action==='audio_summary' && keys.length===2 && typeof v.message_id==='string' && UUID.test(v.message_id)) return { action:v.action,message_id:v.message_id }
  if (!(TRANSLATION_LANGUAGES as readonly unknown[]).includes(v.target)) return null
  if (v.action==='translate_incoming' && keys.length===3 && typeof v.message_id==='string' && UUID.test(v.message_id)) return { action:v.action,message_id:v.message_id,target:v.target as TranslationLanguage }
  if (v.action==='translate_outgoing' && keys.length===3 && typeof v.text==='string' && v.text.trim().length>0 && v.text.length<=4000) return { action:v.action,text:v.text,target:v.target as TranslationLanguage }
  return null
}
export interface UnderstandingMessage { id:string; sender_type:string; created_at:string; content_text?:string | null; media_transcription?:string | null;
  attachments?:{ name?:string; evidence?:{ version:number; kind:string; text:string } }[] | null }
export function audioTranscripts(row:Pick<UnderstandingMessage,'media_transcription' | 'attachments'>):string[] {
  return [...new Set([row.media_transcription?.trim(),...(row.attachments ?? []).filter(a => a.evidence?.version===1 && a.evidence.kind==='audio')
    .map(a => a.evidence!.text.trim())].filter((s):s is string => !!s))]
}
export function understandingText(row:UnderstandingMessage):string {
  const caption=row.content_text?.trim() ?? ''
  return [!/^\[[^\]]+\]$/.test(caption) ? caption : '',...audioTranscripts(row)].filter(Boolean).join('\n')
}
/** Latest bounded snapshot, with visible omission. Never fetch other threads or internal notes. */
export function summarySnapshot(newestFirst:UnderstandingMessage[]) {
  const rows=newestFirst.slice(0,200).reverse(),parts:string[]=[],selected:UnderstandingMessage[]=[]
  let remaining=60000,truncated=newestFirst.length>200
  for (const row of [...rows].reverse()) {
    const content=understandingText(row)
    if (!content) continue
    const raw=JSON.stringify({ sender:row.sender_type,at:row.created_at,text:content })
    if (raw.length>remaining) { truncated=true; break }
    parts.unshift(raw);selected.unshift(row);remaining-=raw.length+1
  }
  return { input:parts.join('\n'),source:{ count:selected.length,first_at:selected[0]?.created_at ?? null,last_at:selected.at(-1)?.created_at ?? null,truncated } }
}
