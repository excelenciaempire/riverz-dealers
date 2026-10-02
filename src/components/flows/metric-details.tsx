'use client'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { useLocale } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview'
import { flowMetricResponse } from '@/lib/flows/metric-contract'
type View = z.infer<typeof flowMetricResponse>
export function FlowMetricDetails({ flowId }: { flowId: string }) {
  const { t } = useLocale(), fmt = useFormat()
  const [view,setView] = useState<View | null>(null),[rows,setRows] = useState<View['records']>([]),[cursor,setCursor] = useState<string | null>(null)
  const [busy,setBusy] = useState(false),[error,setError] = useState(''),[days,setDays] = useState(7)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => { setView(null);setRows([]);setCursor(null);setError('');setBusy(false);return () => controller.current?.abort() },[flowId])
  async function load(input: { node?:string | null;status?:string | null;next?:boolean;refresh?:boolean;days?:number } = {}) {
    controller.current?.abort();const c = new AbortController();controller.current = c;setBusy(true);setError('')
    const node = input.node !== undefined ? input.node : input.refresh ? null : view?.evidence_filter.node_key ?? null
    const status = input.status !== undefined ? input.status : input.refresh ? null : view?.evidence_filter.status ?? null
    const query = new URLSearchParams()
    if (view && !input.refresh) { query.set('from',view.from_at);query.set('through',view.through_at) } else query.set('days',String(input.days ?? days))
    if (node !== null) query.set('node_key',node);if (status !== null) query.set('status',status)
    if (input.next && cursor) query.set('cursor',cursor)
    try {
      const response = await fetch(`/api/flows/${flowId}/node-analytics?${query}`,{cache:'no-store',signal:c.signal}),raw = await response.json(),parsed = flowMetricResponse.safeParse(raw)
      if (!response.ok || !parsed.success || parsed.data.flow_id !== flowId || parsed.data.evidence_filter.node_key !== node || parsed.data.evidence_filter.status !== status) throw new Error(t('flows.metricUnavailable'))
      if (parsed.data.days !== (query.has('days') ? Number(query.get('days')) : null)) throw new Error(t('flows.metricUnavailable'))
      if (view && !input.refresh && (parsed.data.from_at !== view.from_at || parsed.data.through_at !== view.through_at)) throw new Error(t('flows.metricUnavailable'))
      if (input.next && parsed.data.records.some(row => rows.some(prior => prior.id === row.id))) throw new Error(t('flows.metricUnavailable'))
      if (!c.signal.aborted) { setView(parsed.data);setRows(input.next ? [...rows,...parsed.data.records].slice(0,100) : parsed.data.records);setCursor(parsed.data.next_cursor) }
    } catch { if (!c.signal.aborted) { if (!input.next) { setView(null);setRows([]);setCursor(null) }setError(t('flows.metricUnavailable')) } }
    finally { if (!c.signal.aborted) setBusy(false);if (controller.current === c) controller.current = null }
  }
  function download() {
    if (!view) return
    const quote = (value:string | number) => { const text=String(value);return '"'+(/^[\s]*[=+\-@]/.test(text) ? "'"+text : text).replace(/"/g,'""')+'"' }
    const table:(string | number)[][] = [[t('flows.metricColumn'),t('flows.metricKey'),t('flows.metricCount'),t('flows.metricFrom'),t('flows.metricThrough')],
      [t('flows.metricRuns'),view.flow_id,view.total_runs,view.from_at,view.through_at],[t('flows.metricEntries'),view.flow_id,view.node_entries,view.from_at,view.through_at],
      ...Object.entries(view.by_status).map(([key,n])=>[t('flows.metricStatuses'),key,n,view.from_at,view.through_at]),...Object.entries(view.by_node).map(([key,n])=>[t('flows.metricNodes'),key,n,view.from_at,view.through_at])]
    const url=URL.createObjectURL(new Blob(['\uFEFF'+table.map(row=>row.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'})),a=document.createElement('a')
    a.href=url;a.download='riverz-flow-metrics.csv';a.click();URL.revokeObjectURL(url)
  }
  function statusName(status:string) {
    const keys:Record<string,string>={active:'runStatusActive',completed:'runStatusCompleted',handed_off:'runStatusHandedOff',timed_out:'runStatusTimedOut',paused_by_agent:'runStatusPaused',paused_for_retry:'runStatusPaused',failed:'runStatusFailed'}
    return t(`flows.${keys[status] ?? 'metricStatusUnknown'}`)
  }
  if (!SHOW_RIVERZ_IMPROVEMENTS) return null
  return <details className="mt-2 rounded border px-2 py-1 text-xs" onToggle={e => { if(e.target!==e.currentTarget)return;if(e.currentTarget.open)void load({refresh:true});else{controller.current?.abort();controller.current=null;setBusy(false);setView(null);setRows([]);setCursor(null);setError('')} }}>
    <summary className="cursor-pointer">{t('flows.metricTitle')}</summary><div className="mt-2 max-h-[40vh] space-y-2 overflow-y-auto">
      <p className="text-muted-foreground">{t('flows.metricHint')}</p>
      <select className="rounded border bg-background p-1" aria-label={t('flows.metricTitle')} value={days} disabled={busy} onChange={e => { const value=Number(e.target.value);setDays(value);void load({refresh:true,days:value}) }}>{[7,30,90].map(n=><option key={n} value={n}>{t('flows.metricDays',{n:fmt.number(n)})}</option>)}</select>
      {view && <>
        <p>{fmt.dateTime(view.from_at)} – {fmt.dateTime(view.through_at)}</p><p>{t('flows.metricRuns')}: {fmt.number(view.total_runs)} · {t('flows.metricEntries')}: {fmt.number(view.node_entries)}</p>
        <div className="flex flex-wrap gap-2">{Object.entries(view.by_status).map(([status,n])=><button key={status} type="button" className="rounded border p-1 disabled:opacity-50" disabled={busy} onClick={()=>void load({status,node:null})}>{statusName(status)}: {fmt.number(n)}</button>)}</div>
        <details><summary className="cursor-pointer">{t('flows.metricNodes')}</summary>{Object.entries(view.by_node).map(([node,n])=><button key={node} type="button" className="mr-2 mt-1 rounded border p-1 disabled:opacity-50" disabled={busy} onClick={()=>void load({node,status:null})}>{node}: {fmt.number(n)}</button>)}</details>
        <button type="button" className="underline" disabled={busy} onClick={()=>void load({node:null,status:null})}>{t('flows.metricAll')}</button>
        <p>{t('flows.metricMatched',{n:fmt.number(view.matched_runs)})}</p>
        {rows.map(row=><div key={row.id} className="flex flex-wrap gap-2 border-t pt-1"><span>{fmt.dateTime(row.started_at)} · {statusName(row.status)}</span><Link href={`/bandeja?c=${encodeURIComponent(row.conversation_id)}`} className="underline">{t('flows.metricOpenCase')}</Link></div>)}
        {cursor && rows.length<100 && <button type="button" className="underline" disabled={busy} onClick={()=>void load({next:true})}>{t('flows.metricMore')}</button>}{cursor && rows.length>=100 && <p>{t('flows.metricLimit')}</p>}
        <button type="button" className="mr-2 underline" onClick={download}>{t('flows.metricDownload')}</button>
      </>}
      <button type="button" className="underline" disabled={busy} onClick={()=>void load({refresh:true})}>{t('flows.metricRefresh')}</button>
      {busy && <p role="status">{t('inbox.understandingWorking')}</p>}{error && <p role="alert">{error}</p>}
    </div>
  </details>
}
