'use client'
import { useRef,useState,useEffect } from 'react'
import { useLocale } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf'
import { TRANSLATION_LANGUAGES,audioTranscripts,type UnderstandingAction,type UnderstandingResult,type TranslationLanguage } from '@/lib/inbox/understanding'
import type { Message } from '@/types'
import { audioParts } from '@/lib/inbox/audio-parts'

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
  const [exporting,setExporting]=useState(false),[exportInfo,setExportInfo]=useState(''),[exportError,setExportError]=useState(''),download=useRef<AbortController | null>(null)
  useEffect(() => () => download.current?.abort(),[])
  async function exportCase() {
    if (download.current) return
    const c=new AbortController();download.current=c;setExporting(true);setExportError('');setExportInfo('')
    try {
      const r=await fetch(`/api/conversations/${conversationId}/export`,{ signal:c.signal })
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || t('inbox.exportFailed'))
      const blob=await r.blob();if (c.signal.aborted) return
      const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`riverz-conversation-${conversationId}.zip`;a.click();setTimeout(() => URL.revokeObjectURL(url),1000)
      const missing=Number(r.headers.get('X-Export-Missing'))
      setExportInfo(t('inbox.exportReady',{ messages:fmt.number(Number(r.headers.get('X-Export-Messages'))),files:fmt.number(Number(r.headers.get('X-Export-Files'))) })+(missing>0 ? ` ${t('inbox.exportIncomplete',{ count:fmt.number(missing) })}` : ''))
    } catch(e) { if (!c.signal.aborted) setExportError(e instanceof Error ? e.message : t('inbox.exportFailed')) }
    finally { if (!c.signal.aborted) setExporting(false);if (download.current===c) download.current=null }
  }
  return <details className="border-t px-4 py-2 text-xs">
    <summary className="cursor-pointer font-medium">{t('inbox.conversationTools')}</summary>
    <div className="mt-2 space-y-2"><button type="button" className={button} disabled={state.busy} onClick={() => void state.run({ action:'summary' })}>{t(state.busy ? 'inbox.understandingWorking' : 'inbox.summarizeNow')}</button>
      <button type="button" className={button} disabled={exporting} onClick={() => void exportCase()}>{t(exporting ? 'inbox.understandingWorking' : 'inbox.exportConversation')}</button>
      <p className="text-muted-foreground">{t('inbox.exportNotesExcluded')}</p>
      {exportInfo && <p role="status">{exportInfo}</p>}{exportError && <p role="alert">{exportError}</p>}
      {state.error && <p role="alert">{state.error}</p>}
      {state.result && <><p className="font-medium">{t('inbox.conversationSummary')}</p><p className="whitespace-pre-wrap break-words">{state.result.text}</p><p className="text-muted-foreground">{t('inbox.summaryCoverage',{ count:fmt.number(state.result.source.count),from:state.result.source.first_at ? fmt.dateTime(state.result.source.first_at) : '',to:state.result.source.last_at ? fmt.dateTime(state.result.source.last_at) : '' })}</p>
        {state.result.source.truncated && <p className="text-muted-foreground">{t('inbox.summaryLimited')}</p>}</>}
    </div>
  </details>
}
export function MessageUnderstanding({ message }: { message:Message }) {
  const { t,locale }=useLocale(),[target,setTarget]=useState<TranslationLanguage>(locale),state=useUnderstanding(message.conversation_id)
  const fetcher=useFetchWithCsrf(),[pending,setPending]=useState<number | null>(null),[local,setLocal]=useState<Record<number,string>>({}),[audioError,setAudioError]=useState('')
  const busyRef=useRef(false),life=useRef<AbortController | null>(null)
  useEffect(() => () => life.current?.abort(),[])
  const transcripts=audioTranscripts(message)
  const parts=audioParts(message),missing=parts.filter(p => !p.text?.trim() && !local[p.index])
  async function transcribe(index:number) {
    if (busyRef.current) return
    busyRef.current=true;setPending(index);setAudioError('');const c=new AbortController();life.current=c
    try {
      const r=await fetcher(`/api/conversations/${message.conversation_id}/transcription`,{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ message_id:message.id,index }),signal:c.signal })
      const data=await r.json();if (!r.ok) throw new Error(data.error || t('inbox.understandingFailed'))
      if (!c.signal.aborted) { setLocal(v => ({ ...v,[index]:data.text }));if (!data.saved) setAudioError(t('inbox.audioNotCached')) }
    } catch(e) { if (!c.signal.aborted) setAudioError(e instanceof Error ? e.message : t('inbox.understandingFailed')) }
    finally { busyRef.current=false;if (!c.signal.aborted) setPending(null) }
  }
  if (!message.content_text?.trim() && !transcripts.length && !parts.length) return null
  return <details className="mt-2 border-t border-current/15 pt-1 text-xs">
    <summary className="cursor-pointer opacity-80">{t(parts.length || transcripts.length ? 'inbox.audioTranscript' : 'inbox.translateMessage')}</summary>
    <div className="mt-2 space-y-2">
      {transcripts.map((text,i) => <p key={i} className="whitespace-pre-wrap break-words">{text}</p>)}
      {Object.entries(local).filter(([index]) => !parts.find(p => p.index===Number(index))?.text).map(([index,text]) => <p key={index} className="whitespace-pre-wrap break-words">{text}</p>)}
      {missing.map(part => <button key={part.index} type="button" className={button} disabled={pending!==null} onClick={() => void transcribe(part.index)}>{t(pending===part.index ? 'inbox.understandingWorking' : 'inbox.transcribeAudio')}{part.name ? ` · ${part.name}` : missing.length>1 ? ` · ${part.index+1}` : ''}</button>)}
      {audioError && <p role="alert">{audioError}</p>}
      {(parts.length>0 || transcripts.length>0) && <p className="opacity-70">{t('inbox.audioReview')}</p>}
      {(transcripts.length>0 || Object.keys(local).length>0 && !audioError) && <button type="button" className={button} disabled={state.busy || pending!==null} onClick={() => void state.run({ action:'audio_summary',message_id:message.id })}>{t('inbox.summarizeAudio')}</button>}
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
