'use client'
import { useRef,useState,useEffect } from 'react'
import { useLocale } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf'
import { TRANSLATION_LANGUAGES,audioTranscripts,type UnderstandingAction,type UnderstandingResult,type TranslationLanguage } from '@/lib/inbox/understanding'
import type { Message } from '@/types'

function useUnderstanding(conversationId:string) {
  const fetcher=useFetchWithCsrf(),{ t }=useLocale()
  const [result,setResult]=useState<UnderstandingResult | null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const controller=useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(),[])
  async function run(action:UnderstandingAction) {
    if (controller.current) return
    const c=new AbortController();controller.current=c;setBusy(true);setError('');setResult(null)
    try {
      const response=await fetcher(`/api/conversations/${conversationId}/understanding`,{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify(action),signal:c.signal })
      const data=await response.json()
      if (!response.ok) throw new Error(data.error || t('inbox.understandingFailed'))
      if (!c.signal.aborted) setResult(data)
    } catch(e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : t('inbox.understandingFailed')) }
    finally { if (!c.signal.aborted) setBusy(false);if (controller.current===c) controller.current=null }
  }
  return { result,busy,error,run }
}
function Language({ value,onChange,disabled }: { value:TranslationLanguage; onChange:(v:TranslationLanguage) => void; disabled?:boolean }) {
  const { t,locale }=useLocale(),names=new Intl.DisplayNames([locale],{ type:'language' })
  return <select aria-label={t('inbox.translationTarget')} className="rounded border bg-background p-1 text-xs" value={value} disabled={disabled}
    onChange={e => onChange(e.target.value as TranslationLanguage)}>{TRANSLATION_LANGUAGES.map(v => <option key={v} value={v}>{names.of(v)}</option>)}</select>
}
const button='rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50'
export function ConversationUnderstanding({ conversationId }: { conversationId:string }) {
  const { t }=useLocale(),fmt=useFormat(),state=useUnderstanding(conversationId)
  return <details className="border-t px-4 py-2 text-xs">
    <summary className="cursor-pointer font-medium">{t('inbox.conversationSummary')}</summary>
    <div className="mt-2 space-y-2"><button type="button" className={button} disabled={state.busy} onClick={() => void state.run({ action:'summary' })}>{t(state.busy ? 'inbox.understandingWorking' : 'inbox.summarizeNow')}</button>
      {state.error && <p role="alert">{state.error}</p>}
      {state.result && <><p className="whitespace-pre-wrap break-words">{state.result.text}</p><p className="text-muted-foreground">{t('inbox.summaryCoverage',{ count:fmt.number(state.result.source.count),from:state.result.source.first_at ? fmt.dateTime(state.result.source.first_at) : '',to:state.result.source.last_at ? fmt.dateTime(state.result.source.last_at) : '' })}</p>
        {state.result.source.truncated && <p className="text-muted-foreground">{t('inbox.summaryLimited')}</p>}</>}
    </div>
  </details>
}
export function MessageUnderstanding({ message }: { message:Message }) {
  const { t,locale }=useLocale(),[target,setTarget]=useState<TranslationLanguage>(locale),state=useUnderstanding(message.conversation_id)
  const transcripts=audioTranscripts(message)
  if (!message.content_text?.trim() && !transcripts.length) return null
  return <details className="mt-2 border-t border-current/15 pt-1 text-xs">
    <summary className="cursor-pointer opacity-80">{t(transcripts.length ? 'inbox.audioTranscript' : 'inbox.translateMessage')}</summary>
    <div className="mt-2 space-y-2">
      {transcripts.map((text,i) => <p key={i} className="whitespace-pre-wrap break-words">{text}</p>)}
      {transcripts.length>0 && <button type="button" className={button} disabled={state.busy} onClick={() => void state.run({ action:'audio_summary',message_id:message.id })}>{t('inbox.summarizeAudio')}</button>}
      <div className="flex flex-wrap items-center gap-2"><Language value={target} onChange={setTarget} disabled={state.busy} /><button type="button" className={button} disabled={state.busy} onClick={() => void state.run({ action:'translate_incoming',message_id:message.id,target })}>{t(state.busy ? 'inbox.understandingWorking' : 'inbox.translateMessage')}</button></div>
      {state.error && <p role="alert">{state.error}</p>}
      {state.result && <div className="space-y-1"><p className="font-medium">{state.result.target ? t('inbox.translationLanguage',{ language:new Intl.DisplayNames([locale],{ type:'language' }).of(state.result.target) ?? state.result.target }) : t('inbox.audioSummary')}</p><p className="whitespace-pre-wrap break-words">{state.result.text}</p>
        <details><summary className="cursor-pointer">{t('inbox.translationOriginal')}</summary><p className="whitespace-pre-wrap break-words">{state.result.original}</p></details></div>}
    </div>
  </details>
}
export function OutgoingTranslation({ conversationId,draft,onApply,disabled }: { conversationId:string; draft:string; onApply:(text:string) => void; disabled:boolean }) {
  const { t,locale }=useLocale(),[target,setTarget]=useState<TranslationLanguage>(locale==='es' ? 'en' : 'es'),state=useUnderstanding(conversationId)
  const result=state.result,visible=result && (draft===result.original || draft===result.text)
  return <details className="mb-2 text-xs">
    <summary className="cursor-pointer text-muted-foreground">{t('inbox.translateDraft')}</summary>
    <div className="mt-2 space-y-2"><div className="flex items-center gap-2"><Language value={target} onChange={setTarget} disabled={disabled || state.busy} /><button type="button" className={button} disabled={disabled || state.busy || !draft.trim() || draft.length>4000} onClick={() => void state.run({ action:'translate_outgoing',text:draft,target })}>{t(state.busy ? 'inbox.understandingWorking' : 'inbox.translationPreview')}</button></div>
      {state.error && <p role="alert">{state.error}</p>}
      {visible && <div className="space-y-2 rounded border p-2"><p className="font-medium">{t('inbox.translationOriginal')}</p><p className="whitespace-pre-wrap break-words">{result.original}</p><p className="font-medium">{t('inbox.translationLanguage',{ language:new Intl.DisplayNames([locale],{ type:'language' }).of(result.target!) ?? result.target! })}</p><p className="whitespace-pre-wrap break-words">{result.text}</p>
        <button type="button" disabled={disabled} className={button} onClick={() => onApply(draft===result.original ? result.text : result.original!)}>{t(draft===result.original ? 'inbox.translationUse' : 'inbox.translationRestore')}</button><p className="text-muted-foreground">{t('inbox.translationReview')}</p></div>}
    </div>
  </details>
}
