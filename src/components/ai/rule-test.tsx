'use client'
import { useEffect,useRef,useState } from 'react'
import { useLocale } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf'
import type { GuidanceReplayResult } from '@/lib/ai/guidance-replay'
type Case={ id:string;name:string;channel:string;last_message_at:string | null }
type Result={ result:GuidanceReplayResult;live_revision:number;draft_revision:number;source:{ count:number;first_at:string | null;last_at:string | null;truncated:boolean;observed_at:string };peers:{ id:string;title:string }[] }
export function RuleTest({ ruleId,liveRevision,draftRevision,disabled,onTested }: { ruleId:string;liveRevision:number;draftRevision:number;disabled:boolean;onTested:() => Promise<void> }) {
  const { t }=useLocale(),fmt=useFormat(),fetcher=useFetchWithCsrf()
  const [cases,setCases]=useState<Case[]>([]),[q,setQ]=useState(''),[selected,setSelected]=useState(''),[result,setResult]=useState<Result | null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false)
  const controller=useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(),[])
  async function run(test=false) {
    if (controller.current || disabled || test && !selected) return
    const c=new AbortController();controller.current=c;setBusy(true);setError('')
    if (test) setResult(null)
    try {
      const response=test ? await fetcher(`/api/reglas/${ruleId}/test`,{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ conversation_id:selected,live_revision:liveRevision,draft_revision:draftRevision }),signal:c.signal })
        : await fetch(`/api/reglas/${ruleId}/test?q=${encodeURIComponent(q)}`,{ signal:c.signal,cache:'no-store' })
      const data=await response.json();if (!response.ok) throw new Error(data.error || t('reglas.testFailed'))
      if (c.signal.aborted) return
      if (test) { setResult(data);await onTested() }
      else { setCases(data.cases);setLoaded(true);setSelected(previous => data.cases.some((row:Case) => row.id===previous) ? previous : '') }
    } catch(e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : t('reglas.testFailed')) }
    finally { if (!c.signal.aborted) setBusy(false);if (controller.current===c) controller.current=null }
  }
  const button='rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50'
  const current=result && result.live_revision===liveRevision && result.draft_revision===draftRevision
  return <details className="rounded border p-2" onToggle={e => { if (e.currentTarget.open && !loaded) void run() }}>
    <summary className="cursor-pointer">{t('reglas.testRule')}</summary>
    <div className="mt-2 space-y-2">
      <p className="text-muted-foreground">{t('reglas.testScope')}</p>
      <form className="flex gap-2" onSubmit={e => { e.preventDefault();void run() }}>
        <input aria-label={t('reglas.testSearch')} maxLength={100} value={q} onChange={e => setQ(e.target.value)} disabled={busy || disabled} placeholder={t('reglas.testSearch')} className="min-w-0 flex-1 rounded border p-2" />
        <button className={button} disabled={busy || disabled}>{t('reglas.testFind')}</button>
      </form>
      <select aria-label={t('reglas.testChoose')} value={selected} disabled={busy || disabled} onChange={e => setSelected(e.target.value)} className="w-full rounded border p-2">
        <option value="">{t('reglas.testChoose')}</option>
        {cases.map(row => <option key={row.id} value={row.id}>{row.name} · {row.channel}{row.last_message_at ? ` · ${fmt.dateTime(row.last_message_at)}` : ''}</option>)}
      </select>
      {loaded && !cases.length && <p>{t('reglas.testNoCases')}</p>}
      <button type="button" className={button} disabled={busy || disabled || !selected} onClick={() => void run(true)}>{t(draftRevision ? 'reglas.testDraft' : 'reglas.testCurrent')}</button>
      {busy && <p role="status">{t('inbox.understandingWorking')}</p>}{error && <p role="alert">{error}</p>}
      {result && <div className="space-y-2 rounded bg-muted p-2">
        <p className="font-medium">{t('reglas.testProposal')}</p>
        {!current && <p role="status">{t('reglas.testOldResult')}</p>}
        <p>{t(result.result.applies ? 'reglas.testApplies' : 'reglas.testNotApplies')}</p>
        <p className="whitespace-pre-wrap">{result.result.summary}</p><p className="whitespace-pre-wrap">{result.result.reply}</p>
        <p>{t('reglas.testCoverage',{ n:fmt.number(result.source.count) })}{result.source.first_at && result.source.last_at ? ` · ${fmt.dateTime(result.source.first_at)} – ${fmt.dateTime(result.source.last_at)}` : ''}</p>
        {result.source.truncated && <p>{t('reglas.testTruncated')}</p>}
        <details><summary className="cursor-pointer">{t('reglas.testConflicts')}</summary>
          {result.result.conflicts.length ? result.result.conflicts.map(item => <p key={item.rule_id} className="mt-1"><strong>{result.peers.find(peer => peer.id===item.rule_id)?.title}</strong>: {item.reason}</p>) : <p>{t('reglas.testNoConflicts')}</p>}
        </details>
      </div>}
    </div>
  </details>
}
