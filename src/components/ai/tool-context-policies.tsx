'use client'
import { useEffect,useRef,useState } from 'react'
import { CHANNELS,type Channel } from '@/types'
import { AGENT_TOOLBOX } from '@/lib/ai/toolbox'
import type { ToolContextPolicy,ToolContextMode } from '@/lib/ai/tool-context'
import { channelLabel } from '@/lib/channels/display'
import { useLocale } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf'
import { Button } from '@/components/ui/button'
import { SUFIJO } from './tool-switchboard'
type View={ revision:number;policy:ToolContextPolicy;can_edit:boolean;history:{ id:string;revision:number;policy:ToolContextPolicy;created_at:string }[];truncated:boolean }
export function ToolContextPolicies({ agentId }: { agentId:string }) {
 const { t }=useLocale(),fmt=useFormat(),fetchWithCsrf=useFetchWithCsrf()
 const [view,setView]=useState<View|null>(null),[policy,setPolicy]=useState<ToolContextPolicy>({}),[channel,setChannel]=useState<Channel>('whatsapp'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false)
 const controller=useRef<AbortController|null>(null),receipt=useRef<string|null>(null)
 useEffect(() => () => { controller.current?.abort() },[])
 async function load() {
  if (controller.current) return
  const c=new AbortController();controller.current=c;setBusy(true);setError('')
  try { const response=await fetch(`/api/ai/agents/${agentId}/tool-contexts`,{ cache:'no-store',signal:c.signal }),data=await response.json();if (!response.ok) throw new Error(data.error || t('operation.contextFailed'));if (!c.signal.aborted) { setView(data);setPolicy(data.policy);receipt.current=null } }
  catch(e) { if (!c.signal.aborted) setError(e instanceof Error && e.message!=='Failed to fetch' ? e.message : t('operation.contextFailed')) }
  finally { if (!c.signal.aborted) setBusy(false);if (controller.current===c) controller.current=null }
 }
 async function save() {
  if (controller.current || !view?.can_edit) return
  const c=new AbortController();controller.current=c;receipt.current ??=crypto.randomUUID();setBusy(true);setError('');setSaved(false)
  try {
   const response=await fetchWithCsrf(`/api/ai/agents/${agentId}/tool-contexts`,{ method:'POST',signal:c.signal,headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ id:receipt.current,expected_revision:view.revision,policy }) }),data=await response.json()
   if (!response.ok || !data.ok || typeof data.id!=='string' || typeof data.created_at!=='string') { if (response.status===409) receipt.current=null;throw new Error(data.error || t('operation.contextFailed')) }
   if (!c.signal.aborted) { const history=[{ id:data.id,revision:data.revision,policy:data.policy,created_at:data.created_at },...view.history.filter(row => row.id!==data.id)];setSaved(true);setView({ ...view,revision:data.revision,policy:data.policy,history:history.slice(0,20),truncated:view.truncated || history.length>20 });setPolicy(data.policy);receipt.current=null }
  } catch(e) { if (!c.signal.aborted) setError(e instanceof Error && e.message!=='Failed to fetch' ? e.message : t('operation.contextFailed')) }
  finally { if (!c.signal.aborted) setBusy(false);if (controller.current===c) controller.current=null }
 }
 function setMode(key:string,value:string) {
  if (!view?.can_edit || busy) return
  const next={ ...policy,[channel]:{ ...policy[channel] } };if (value==='inherit') delete next[channel]?.[key];else next[channel]![key]=value as ToolContextMode
  if (!Object.keys(next[channel] ?? {}).length) delete next[channel]
  receipt.current=null;setPolicy(next);setSaved(false)
 }
 return <details className="mt-3 rounded border p-3 text-xs" onToggle={e => { if (e.currentTarget.open && !view && !busy) void load() }}>
  <summary className="cursor-pointer font-medium">{t('operation.contextTitle')}</summary>
  <div className="mt-3 space-y-3"><p className="text-muted-foreground">{t('operation.contextHint')}</p>{error && <p role="alert">{error}</p>}
   {view && <><label className="flex items-center gap-2">{t('operation.contextChannel')}<select className="rounded border bg-background p-1" value={channel} onChange={e => setChannel(e.target.value as Channel)} disabled={busy}>{CHANNELS.map(value => <option key={value} value={value}>{channelLabel(value,t)}</option>)}</select></label>
    <div className="space-y-2">{AGENT_TOOLBOX.map(spec => <label key={spec.key} className="flex flex-wrap items-center justify-between gap-2"><span>{t(`operation.tool${SUFIJO[spec.key]}`)}</span><select className="max-w-full rounded border bg-background p-1" value={policy[channel]?.[spec.key] ?? 'inherit'} disabled={busy || !view.can_edit} onChange={e => setMode(spec.key,e.target.value)}><option value="inherit">{t('operation.contextInherit')}</option><option value="off">{t('operation.toolModeOff')}</option>{spec.modes.includes('aprobacion') && <option value="aprobacion">{t('operation.toolModeAprobacion')}</option>}</select></label>)}</div>
    <p>{t('reglas.versionNumber',{ n:fmt.number(view.revision) })}</p><p className="text-muted-foreground">{t('operation.contextApply')}</p>
    <div className="flex gap-2"><Button type="button" size="sm" disabled={busy || !view.can_edit} onClick={() => void save()}>{t('operation.contextSave')}</Button><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void load()}>{t('operation.contextReload')}</Button></div>{saved && <p role="status">{t('operation.contextSaved')}</p>}
    <details><summary className="cursor-pointer">{t('operation.contextHistory')}</summary>{view.history.map(row => <details key={row.id} className="mt-2"><summary className="cursor-pointer">{t('reglas.versionNumber',{ n:fmt.number(row.revision) })} · {fmt.dateTime(row.created_at)}</summary>{Object.entries(row.policy).flatMap(([origin,modes]) => Object.entries(modes ?? {}).map(([key,mode]) => <p key={`${origin}:${key}`}>{channelLabel(origin as Channel,t)} · {t(`operation.tool${SUFIJO[key]}`)} · {t(mode==='off' ? 'operation.toolModeOff' : 'operation.toolModeAprobacion')}</p>))}</details>)}{view.truncated && <p>{t('operation.contextHistoryPartial')}</p>}</details>
   </>}{busy && <p role="status">{t('operation.contextWorking')}</p>}
  </div>
 </details>
}
