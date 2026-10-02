'use client'
import { useEffect, useRef, useState } from 'react'
import { useLocale } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf'
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview'
import { ruleReviewDecision, ruleReviewReceipt, ruleReviewView, type RuleReviewView } from '@/lib/ai/rule-review-contract'

export function RuleReview({ conversationId, turnId, ruleId }: { conversationId: string; turnId: string; ruleId: string }) {
  const { t } = useLocale(), fmt = useFormat(), csrf = useFetchWithCsrf()
  const [view, setView] = useState<RuleReviewView | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [application, setApplication] = useState<'applied' | 'missed' | 'not_applicable' | 'unverified'>('unverified')
  const [transfer, setTransfer] = useState<'related' | 'unrelated' | 'not_assessed'>('not_assessed')
  const [note, setNote] = useState(''), [confirmed, setConfirmed] = useState(false)
  const controller = useRef<AbortController | null>(null), attempt = useRef<{ signature: string; id: string } | null>(null)
  const url = `/api/conversations/${conversationId}/rule-reviews?turn_id=${encodeURIComponent(turnId)}&rule_id=${encodeURIComponent(ruleId)}`
  useEffect(() => { setView(null); setError(''); setBusy(false); setConfirmed(false); attempt.current = null; return () => controller.current?.abort() }, [url])
  async function load() {
    controller.current?.abort(); const c = new AbortController(); controller.current = c; setBusy(true); setError(''); setConfirmed(false)
    try {
      const response = await fetch(url, { cache: 'no-store', signal: c.signal }), raw = await response.json(), parsed = ruleReviewView.safeParse(raw)
      if (!response.ok) throw new Error(raw.error || t('reglas.reviewError_unavailable'))
      if (!parsed.success || parsed.data.turn_id !== turnId || parsed.data.rule_id !== ruleId) throw new Error(t('reglas.reviewError_unavailable'))
      if (!c.signal.aborted) {
        setView(parsed.data); setApplication(parsed.data.review?.application ?? 'unverified'); setTransfer(parsed.data.review?.transfer ?? 'not_assessed'); setNote(parsed.data.review?.note ?? ''); setConfirmed(false)
      }
    } catch (e) { if (!c.signal.aborted) { setView(null); setError(e instanceof Error ? e.message : t('reglas.reviewError_unavailable')) } }
    finally { if (!c.signal.aborted) setBusy(false); if (controller.current === c) controller.current = null }
  }
  async function save() {
    if (busy || !view?.can_edit) return
    const decision = ruleReviewDecision.safeParse({ application, transfer, note, confirmed })
    if (!decision.success) { setError(t('reglas.reviewError_invalid')); return }
    const expected_revision = view.review?.revision ?? 0, signature = JSON.stringify({ expected_revision, decision: decision.data })
    if (attempt.current?.signature !== signature) attempt.current = { signature, id: crypto.randomUUID() }
    const id = attempt.current.id, c = new AbortController(); controller.current = c; setBusy(true); setError('')
    try {
      const response = await csrf(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: c.signal, body: JSON.stringify({ id, expected_revision, decision: decision.data }) })
      const raw = await response.json(), parsed = ruleReviewReceipt.safeParse(raw)
      if (!response.ok) throw new Error(raw.error || t('reglas.reviewError_unavailable'))
      if (!parsed.success || parsed.data.id !== id || parsed.data.turn_id !== turnId || parsed.data.rule_id !== ruleId || parsed.data.review.revision !== expected_revision + 1
        || parsed.data.review.application !== decision.data.application || parsed.data.review.transfer !== decision.data.transfer || parsed.data.review.note !== decision.data.note) throw new Error(t('reglas.reviewError_unavailable'))
      // A recovered receipt may precede a later correction. Reload the current version.
      if (!c.signal.aborted) { attempt.current = null; await load() }
    } catch (e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : t('reglas.reviewError_unavailable')) }
    finally { if (!c.signal.aborted) setBusy(false); if (controller.current === c) controller.current = null }
  }
  if (!SHOW_RIVERZ_IMPROVEMENTS) return null
  return <details className="mt-2 rounded border p-2" onToggle={e => { if(e.target!==e.currentTarget)return;if (e.currentTarget.open) void load(); else { controller.current?.abort(); controller.current = null; setBusy(false); setView(null); setError('') } }}>
    <summary className="cursor-pointer">{t('reglas.reviewTitle')}</summary>
    <div className="mt-2 space-y-2">
      <p className="text-muted-foreground">{t('reglas.reviewHint')}</p>
      {view && <>
        <details><summary className="cursor-pointer">{view.rule.titulo} · {t('reglas.versionNumber', { n: fmt.number(view.rule_revision) })}</summary><p className="mt-1 whitespace-pre-wrap break-words">{view.rule.cuando}</p><p className="whitespace-pre-wrap break-words">{view.rule.hacer}</p><p className="text-muted-foreground">{t('reglas.reviewSnapshotHint')}</p></details>
        {view.review && <p>{t(`reglas.reviewApplication_${view.review.application}`)} · {view.review.actor_name || t('reglas.noActor')} · {fmt.dateTime(view.review.changed_at)}</p>}
        {view.can_edit && <>
          <label className="block">{t('reglas.reviewApplication')}<select className="mt-1 w-full rounded border bg-background p-1" value={application} disabled={busy} onChange={e => { setApplication(e.target.value as typeof application); setConfirmed(false) }}>{(['unverified', 'applied', 'missed', 'not_applicable'] as const).map(value => <option key={value} value={value}>{t(`reglas.reviewApplication_${value}`)}</option>)}</select></label>
          <label className="block">{t('reglas.reviewTransfer')}<select className="mt-1 w-full rounded border bg-background p-1" value={transfer} disabled={busy} onChange={e => { setTransfer(e.target.value as typeof transfer); setConfirmed(false) }}>{(['not_assessed', 'related', 'unrelated'] as const).map(value => <option key={value} value={value}>{t(`reglas.reviewTransfer_${value}`)}</option>)}</select></label>
          <label className="block">{t('reglas.reviewNote')}<textarea className="mt-1 w-full rounded border bg-background p-1" rows={3} maxLength={600} value={note} disabled={busy} onChange={e => { setNote(e.target.value); setConfirmed(false) }} /></label>
          <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />{t('reglas.reviewConsent')}</label>
          <button type="button" className="rounded border px-2 py-1 disabled:opacity-50" disabled={busy || !confirmed} onClick={() => void save()}>{t('reglas.reviewSave')}</button>
        </>}
        {!!view.history.length && <details><summary className="cursor-pointer">{t('reglas.history')}</summary>{view.history.map(item => <div key={item.id} className="mt-2 border-t pt-1"><p>{t('reglas.versionNumber', { n: fmt.number(item.revision) })} · {item.actor_name || t('reglas.noActor')} · {fmt.dateTime(item.changed_at)}</p><p>{t(`reglas.reviewApplication_${item.application}`)} · {t(`reglas.reviewTransfer_${item.transfer}`)}</p><p className="whitespace-pre-wrap break-words">{item.note}</p></div>)}{view.history_truncated && <p>{t('reglas.reviewHistoryLimit')}</p>}</details>}
      </>}
      <button type="button" className="underline disabled:opacity-50" disabled={busy} onClick={() => void load()}>{t('reglas.refresh')}</button>
      {busy && <p role="status">{t('inbox.understandingWorking')}</p>}{error && <p role="alert">{error}</p>}
    </div>
  </details>
}
