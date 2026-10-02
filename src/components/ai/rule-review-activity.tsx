'use client'
import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { useLocale } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview'
import { ruleReviewMetrics } from '@/lib/ai/rule-review-contract'
export function RuleReviewActivity({ ruleId }: { ruleId: string }) {
  const { t } = useLocale(), fmt = useFormat(), controller = useRef<AbortController | null>(null)
  const [view, setView] = useState<z.infer<typeof ruleReviewMetrics> | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { setView(null); setError(''); setBusy(false); return () => controller.current?.abort() }, [ruleId])
  async function load() {
    controller.current?.abort(); const c = new AbortController(); controller.current = c; setBusy(true); setError('')
    try {
      const response = await fetch(`/api/reglas/${ruleId}/reviews`, { cache: 'no-store', signal: c.signal }), raw = await response.json(), parsed = ruleReviewMetrics.safeParse(raw)
      if (!response.ok || !parsed.success) throw new Error(t('reglas.reviewError_unavailable'))
      if (!c.signal.aborted) setView(parsed.data)
    } catch { if (!c.signal.aborted) { setView(null); setError(t('reglas.reviewError_unavailable')) } }
    finally { if (!c.signal.aborted) setBusy(false); if (controller.current === c) controller.current = null }
  }
  if (!SHOW_RIVERZ_IMPROVEMENTS) return null
  return <details className="rounded border p-2" onToggle={e => { if (e.currentTarget.open) void load(); else { controller.current?.abort(); controller.current = null; setBusy(false); setView(null) } }}>
    <summary className="cursor-pointer">{t('reglas.reviewActivityTitle')}</summary><div className="mt-2 space-y-2">
      <p className="text-muted-foreground">{t('reglas.reviewActivityHint')}</p>
      {view && <><dl className="grid grid-cols-2 gap-2">{(['reviewed_turns', 'applied_turns', 'missed_turns', 'not_applicable_turns', 'unverified_turns', 'distinct_reviewed_cases', 'related_transfer_turns', 'assessed_transfer_turns'] as const).map(key => <div key={key}><dt>{t(`reglas.reviewMetric_${key}`)}</dt><dd className="font-medium">{fmt.number(view[key])}</dd></div>)}</dl><p>{view.application_rate === null ? t('reglas.reviewNoRate') : t('reglas.reviewRate', { rate: fmt.number(view.application_rate), n: fmt.number(view.eligible_turns) })}</p></>}
      <button type="button" className="underline" disabled={busy} onClick={() => void load()}>{t('reglas.refresh')}</button>
      {busy && <p role="status">{t('inbox.understandingWorking')}</p>}{error && <p role="alert">{error}</p>}
    </div>
  </details>
}
