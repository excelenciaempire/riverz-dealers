'use client'
import { useEffect,useRef,useState } from 'react'
import { useLocale } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf'
import type { GuidanceDraft,GuidanceSnapshot,GuidanceVersion,GuidanceVersionInput } from '@/lib/ai/guidance-versions'
import { RuleTest } from './rule-test'
type View={ rule:GuidanceSnapshot & { id:string;live_revision:number;activa:boolean };draft:GuidanceDraft | null;versions:GuidanceVersion[];next_before:number | null;is_admin:boolean }
export function RuleVersions({ ruleId,onChanged }: { ruleId:string;onChanged:() => Promise<void> }) {
  const { t }=useLocale(),fmt=useFormat(),fetcher=useFetchWithCsrf()
  const [view,setView]=useState<View | null>(null),[form,setForm]=useState<GuidanceSnapshot | null>(null),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[dirty,setDirty]=useState(false)
  const controller=useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(),[])
  async function load(input?:GuidanceVersionInput,before?:number) {
    if (controller.current) return
    const c=new AbortController();controller.current=c;setBusy(true);setError('')
    try {
      if (input) {
        const r=await fetcher(`/api/reglas/${ruleId}/versions`,{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify(input),signal:c.signal })
        const data=await r.json();if (!r.ok) throw new Error(data.error || t('reglas.saveFailed'))
      }
      const r=await fetch(`/api/reglas/${ruleId}/versions${before ? `?before=${before}` : ''}`,{ signal:c.signal,cache:'no-store' })
      const data=await r.json() as View & { error?:string };if (!r.ok) throw new Error(data.error || t('reglas.saveFailed'))
      if (c.signal.aborted) return
      if (before) setView(previous => ({ ...data,versions:[...(previous?.versions ?? []),...data.versions] }))
      else {
        setView(data)
        if (input || !dirty) { const content=data.draft?.snapshot ?? data.rule;setForm({ titulo:content.titulo,cuando:content.cuando,hacer:content.hacer });setDirty(false) }
        if (input?.action==='publish' || input?.action==='discard' || input?.action==='rollback') setEditing(false)
      }
      if (input) await onChanged()
    } catch(e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : t('reglas.saveFailed')) }
    finally { if (!c.signal.aborted) setBusy(false);if (controller.current===c) controller.current=null }
  }
  function field(key:keyof GuidanceSnapshot,value:string) { setDirty(true);setForm(previous => previous ? { ...previous,[key]:value } : previous) }
  const button='rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50'
  const stale=view?.draft && view.draft.base_revision!==view.rule.live_revision
  return <details className="mt-2 text-xs" onToggle={e => { if (e.currentTarget.open && !view) void load() }}>
    <summary className="cursor-pointer text-muted-foreground">{t('reglas.versions')}</summary>
    <div className="mt-2 space-y-3">
      <button type="button" className={button} disabled={busy} onClick={() => void load()}>{t('reglas.refresh')}</button>
      {view && <>
        <p>{t('reglas.currentVersion',{ n:fmt.number(view.rule.live_revision) })} · {t(view.rule.activa ? 'reglas.activeState' : 'reglas.inactiveState')}</p>
        {view.draft && <p>{t(view.draft.state==='test' ? 'reglas.testState' : 'reglas.draftState')} · {t('reglas.draftBase',{ draft:fmt.number(view.draft.draft_revision),live:fmt.number(view.draft.base_revision) })}</p>}
        {stale && <p role="status">{t('reglas.staleDraft')}</p>}
        {!editing && <button type="button" className={button} disabled={busy} onClick={() => setEditing(true)}>{t('reglas.editDraft')}</button>}
        {editing && form && <form className="space-y-2 rounded border p-2" onSubmit={e => { e.preventDefault();void load({ action:'save',live_revision:view.rule.live_revision,draft_revision:view.draft?.draft_revision ?? 0,snapshot:form }) }}>
          <input disabled={busy} aria-label={t('reglas.titlePlaceholder')} value={form.titulo} maxLength={120} onChange={e => field('titulo',e.target.value)} className="w-full rounded border p-2" />
          <textarea disabled={busy} aria-label={t('reglas.whenPlaceholder')} value={form.cuando ?? ''} maxLength={4000} onChange={e => field('cuando',e.target.value)} rows={2} className="w-full rounded border p-2" />
          <textarea disabled={busy} aria-label={t('reglas.doPlaceholder')} value={form.hacer} maxLength={4000} onChange={e => field('hacer',e.target.value)} rows={3} className="w-full rounded border p-2" />
          <button type="submit" className={button} disabled={busy || !form.titulo.trim() || !form.hacer.trim()}>{t('reglas.saveDraft')}</button>
        </form>}
        {view.draft && <div className="space-y-2 rounded border p-2">
          <p className="font-medium">{view.draft.snapshot.titulo}</p><p className="whitespace-pre-wrap">{view.draft.snapshot.cuando}</p><p className="whitespace-pre-wrap">{view.draft.snapshot.hacer}</p>
          <div className="flex flex-wrap gap-2">
            {view.is_admin && <button type="button" className={button} disabled={busy || !!stale || dirty} onClick={() => void load({ action:'publish',live_revision:view.rule.live_revision,draft_revision:view.draft!.draft_revision })}>{t('reglas.publishDraft')}</button>}
            <button type="button" className={button} disabled={busy} onClick={() => void load({ action:'discard',draft_revision:view.draft!.draft_revision })}>{t('reglas.discardDraft')}</button>
          </div>
        </div>}
        <RuleTest ruleId={ruleId} liveRevision={view.rule.live_revision} draftRevision={view.draft?.draft_revision ?? 0} disabled={busy || dirty || !!stale} onTested={() => load()} />
        <details><summary className="cursor-pointer">{t('reglas.history')}</summary>
          <div className="mt-2 space-y-2">{view.versions.map(version => <details key={version.revision} className="rounded border p-2">
            <summary className="cursor-pointer">{t('reglas.versionNumber',{ n:fmt.number(version.revision) })} · {fmt.dateTime(version.created_at)}</summary>
            <div className="mt-2 space-y-2"><p className="font-medium">{version.snapshot.titulo}</p><p className="whitespace-pre-wrap">{version.snapshot.cuando}</p><p className="whitespace-pre-wrap">{version.snapshot.hacer}</p>
              <p>{t(version.snapshot.activa ? 'reglas.activeState' : 'reglas.inactiveState')}</p><p>{t('reglas.source',{ source:t(`reglas.source_${version.source}`) })}</p>
              <p>{version.actor_id ?? t('reglas.noActor')}</p>
              {view.is_admin && version.revision!==view.rule.live_revision && !version.snapshot.deleted && <button type="button" className={button} disabled={busy} onClick={() => void load({ action:'rollback',live_revision:view.rule.live_revision,target_revision:version.revision })}>{t('reglas.rollback')}</button>}
            </div>
          </details>)}</div>
          {view.next_before && <button type="button" className={`${button} mt-2`} disabled={busy} onClick={() => void load(undefined,view.next_before!)}>{t('reglas.moreVersions')}</button>}
        </details>
      </>}
      {busy && <p role="status">{t('inbox.understandingWorking')}</p>}{error && <p role="alert">{error}</p>}
    </div>
  </details>
}
