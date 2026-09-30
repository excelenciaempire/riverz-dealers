'use client'
import { useEffect,useRef,useState } from 'react'
import { useT } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf'
import { Button } from '@/components/ui/button'
import type { KnowledgeConflictView } from '@/lib/ai/knowledge-conflicts'
export function GapKnowledgeConflicts({ reviewId }: { reviewId:string }) {
 const t=useT(),fmt=useFormat(),fetchWithCsrf=useFetchWithCsrf()
 const [view,setView]=useState<KnowledgeConflictView|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const controller=useRef<AbortController|null>(null)
 useEffect(() => () => { controller.current?.abort() },[])
 async function check() {
  if (controller.current) return
  const c=new AbortController();controller.current=c;setBusy(true);setView(null);setError('')
  try {
   const response=await fetchWithCsrf('/api/huecos/conflicts',{ method:'POST',signal:c.signal,headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ review_id:reviewId }) }),data=await response.json()
   if (!response.ok || data.review_id!==reviewId) throw new Error(data.error || t('gaps.conflictFailed'))
   if (!c.signal.aborted) setView(data)
  } catch(e) { if (!c.signal.aborted) setError(e instanceof Error && e.message!=='Failed to fetch' ? e.message : t('gaps.conflictFailed')) }
  finally { if (!c.signal.aborted) setBusy(false);if (controller.current===c) controller.current=null }
 }
 return <div className="space-y-2 border-t pt-2">
  <Button type="button" variant="outline" size="sm" onClick={() => void check()} disabled={busy}>{t(busy ? 'gaps.conflictWorking' : 'gaps.conflictCheck')}</Button>
  <p className="text-muted-foreground">{t('gaps.conflictScope')}</p>
  {error && <p role="alert">{error}</p>}
  {view && <div className="space-y-2" aria-live="polite"><p>{view.result.summary}</p><p className="text-muted-foreground">{t('gaps.conflictObserved',{ date:fmt.dateTime(view.observed_at),n:fmt.number(view.sources.length) })}</p>{view.truncated && <p>{t('gaps.conflictPartial')}</p>}
   {view.result.conflicts.length===0 && <p>{t('gaps.conflictNoFindings')}</p>}
   {view.result.conflicts.map(finding => { const source=view.sources.find(s => s.id===finding.source_id);return <article key={finding.source_id} className="space-y-1 rounded border p-2"><p className="font-medium">{source?.title}</p><p>{finding.reason}</p>{source && <details><summary className="cursor-pointer">{t('gaps.conflictOpenSource')}</summary>{source.condition && <p className="whitespace-pre-wrap break-words">{source.condition}</p>}<p className="whitespace-pre-wrap break-words">{source.answer}</p>{source.revision && <p>{t('reglas.versionNumber',{ n:fmt.number(source.revision) })}</p>}</details>}</article> })}
   <p className="text-muted-foreground">{t('gaps.conflictDecision')}</p>
  </div>}
 </div>
}
