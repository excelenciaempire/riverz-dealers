'use client'
import { useEffect,useRef,useState } from 'react'
import { useLocale } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import { RuleReviewActivity } from './rule-review-activity'
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview'
type Activity={ from_at:string;through_at:string;recorded_turns:number;distinct_cases:number;failed_turns:number;approval_turns:number }
export function RuleActivity({ ruleId }: { ruleId:string }) {
  const { t }=useLocale(),fmt=useFormat(),controller=useRef<AbortController | null>(null)
  const [view,setView]=useState<Activity | null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  useEffect(() => () => controller.current?.abort(),[])
  async function load() {
    if (controller.current) return
    const c=new AbortController();controller.current=c;setBusy(true);setError('')
    try {
      const r=await fetch(`/api/reglas/${ruleId}/activity`,{ cache:'no-store',signal:c.signal }),data=await r.json()
      if (!r.ok) throw new Error(data.error || t('reglas.activityFailed'))
      if (!c.signal.aborted) setView(data)
    } catch(e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : t('reglas.activityFailed')) }
    finally { if (!c.signal.aborted) setBusy(false);if (controller.current===c) controller.current=null }
  }
  return <details className="rounded border p-2" onToggle={e => { if (e.target===e.currentTarget && e.currentTarget.open) void load() }}>
    <summary className="cursor-pointer">{t('reglas.activityTitle')}</summary><div className="mt-2 space-y-2">
      <p className="text-muted-foreground">{t('reglas.activityHint')}</p>
      {view && <><p>{fmt.dateTime(view.from_at)} – {fmt.dateTime(view.through_at)}</p><dl className="grid grid-cols-2 gap-1">
        {(['recorded_turns','distinct_cases','failed_turns','approval_turns'] as const).map(key => <div key={key}><dt>{t(`reglas.activity_${key}`)}</dt><dd className="font-medium">{fmt.number(view[key])}</dd></div>)}
      </dl></>}
      {busy && <p role="status">{t('inbox.understandingWorking')}</p>}{error && <p role="alert">{error}</p>}
      {SHOW_RIVERZ_IMPROVEMENTS && <RuleReviewActivity ruleId={ruleId} />}
    </div>
  </details>
}
