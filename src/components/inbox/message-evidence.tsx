'use client'
import { useEffect,useRef,useState } from 'react'
import { Info } from 'lucide-react'
import { useLocale } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import { Popover,PopoverContent,PopoverTrigger } from '@/components/ui/popover'
import type { TurnEvidence } from '@/lib/ai/turn-evidence-contract'
import { toolPermissionKey } from '@/lib/ai/toolbox'
import { SUFIJO } from '@/components/ai/tool-switchboard'
type View={ receipts:{ id:string;status:string;reason:string | null;evidence:TurnEvidence;created_at:string }[];legacy:{ id:string;status:string;skip_reason:string | null;tools_used:string[] | null;model:string | null;created_at:string }[];truncated:boolean }
export function MessageEvidence({ conversationId,messageId }: { conversationId:string;messageId:string }) {
  const { t }=useLocale(),fmt=useFormat()
  const [view,setView]=useState<View | null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[open,setOpen]=useState(false)
  const controller=useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(),[])
  async function toggle(next:boolean) {
    setOpen(next);controller.current?.abort();controller.current=null;setView(null);setError('');setBusy(false)
    if (!next) return
    const c=new AbortController();controller.current=c;setBusy(true)
    try {
      const response=await fetch(`/api/conversations/${conversationId}/evidence?message_id=${messageId}`,{ cache:'no-store',signal:c.signal }),data=await response.json()
      if (!response.ok) throw new Error(data.error || t('inbox.evidenceFailed'))
      if (!c.signal.aborted) setView(data)
    } catch(e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : t('inbox.evidenceFailed')) }
    finally { if (!c.signal.aborted) setBusy(false);if (controller.current===c) controller.current=null }
  }
  function reason(code:string | null) {
    if (!code) return null
    const key=`health.skip_${code}`,text=t(key)
    return text===key ? t('inbox.evidenceReasonUnknown') : text
  }
  function toolName(name:string) {
    const suffix=SUFIJO[toolPermissionKey(name)],key=`operation.tool${suffix}`,label=suffix ? t(key) : ''
    return label && label!==key ? label : name
  }
  return <Popover open={open} onOpenChange={next => void toggle(next)}>
    <PopoverTrigger className="flex h-8 w-8 items-center justify-center rounded-full text-foreground hover:bg-accent md:h-5 md:w-5" aria-label={t('inbox.evidenceTitle')}><Info className="h-3.5 w-3.5" /></PopoverTrigger>
    <PopoverContent sideOffset={6} className="max-h-[70vh] w-[min(24rem,90vw)] overflow-y-auto text-xs">
      <p className="font-medium">{t('inbox.evidenceTitle')}</p>
      {busy && <p role="status" className="mt-2">{t('inbox.understandingWorking')}</p>}{error && <p role="alert" className="mt-2">{error}</p>}
      {view && <div className="mt-2 space-y-3">
        {!view.receipts.length && <p>{t('inbox.evidenceNotRecorded')}</p>}
        {view.receipts.map(row => <details key={row.id} className="rounded border p-2" open={view.receipts.length===1}>
          <summary className="cursor-pointer">{fmt.dateTime(row.created_at)} · {t(`inbox.evidenceTurn_${row.status}`)}</summary>
          <div className="mt-2 space-y-2">
            {row.reason && <p>{reason(row.reason)}</p>}
            <details><summary className="cursor-pointer">{t('inbox.evidenceRules')}</summary><p className="mt-1 text-muted-foreground">{t('inbox.evidenceRulesHint')}</p>
              {row.evidence.rules.length ? row.evidence.rules.map(rule => <p key={rule.id} className="mt-1">{rule.title} · {rule.revision ? t('reglas.versionNumber',{ n:fmt.number(rule.revision) }) : t('inbox.evidenceVersionUnknown')}</p>) : <p>{t('inbox.evidenceNoRules')}</p>}
            </details>
            <details><summary className="cursor-pointer">{t('inbox.evidenceSources')}</summary><p className="mt-1 text-muted-foreground">{t('inbox.evidenceSourcesHint')}</p>
              {row.evidence.sources.map((source,index) => <p key={`${source.kind}:${source.id}`} className="mt-1"><a className="underline" href={source.kind==='catalogue' ? `/productos/${source.id}` : `#msg-${source.id}`}>{source.kind==='catalogue' ? source.title || t('inbox.evidenceProduct') : t('inbox.evidenceMessage',{ n:fmt.number(index+1) })}</a></p>)}
            </details>
            <details open><summary className="cursor-pointer">{t('inbox.evidenceTools')}</summary><p className="mt-1 text-muted-foreground">{t('inbox.evidenceToolsHint')}</p>
              {row.evidence.tools.length ? row.evidence.tools.map(tool => <p key={tool.sequence} className="mt-1">{fmt.number(tool.sequence)}. {toolName(tool.name)} · {t(`inbox.evidenceTool_${tool.status}`)}</p>) : <p>{t('inbox.evidenceNoTools')}</p>}
            </details>
            {row.evidence.truncated && <p>{t('inbox.evidenceTruncated')}</p>}
          </div>
        </details>)}
        {!!view.legacy.length && <details><summary className="cursor-pointer">{t('inbox.evidenceLegacy')}</summary><p className="mt-1 text-muted-foreground">{t('inbox.evidenceLegacyHint')}</p>
          {view.legacy.map(row => <div key={row.id} className="mt-2 border-t pt-2"><p>{fmt.dateTime(row.created_at)} · {t(`inbox.evidenceTurn_${row.status}`)}</p>{row.skip_reason && <p>{reason(row.skip_reason)}</p>}
            {row.model && <p>{row.model}</p>}{row.tools_used?.length ? <p>{row.tools_used.map(toolName).join(', ')}</p> : <p>{t('inbox.evidenceLegacyNoTools')}</p>}
          </div>)}
        </details>}
        {view.truncated && <p>{t('inbox.evidenceTruncated')}</p>}
      </div>}
    </PopoverContent>
  </Popover>
}
