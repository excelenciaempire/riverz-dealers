'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import Link from '@/components/i18n/locale-link'
import type { CaseGapAnswer } from '@/lib/ai/case-gap-answers'

/** Internal answers for this case, without publishing business knowledge. */
export function CaseGapAnswers({ conversationId }: { conversationId: string }) {
  const t = useT(), fmt = useFormat(), csrf = useFetchWithCsrf()
  const [rows, setRows] = useState<CaseGapAnswer[] | null>(null)
  const [failed, setFailed] = useState(false), [partial, setPartial] = useState(false)
  const [editing, setEditing] = useState<string | null>(null), [answer, setAnswer] = useState(''), [saving, setSaving] = useState(false)
  const load = useRef<AbortController | null>(null), operation = useRef<AbortController | null>(null), receipt = useRef<string | null>(null)
  const endpoint = `/api/conversations/${conversationId}/knowledge-answers`
  const reload = useCallback(async () => {
    load.current?.abort()
    const controller = new AbortController(); load.current = controller
    try {
      const res = await fetch(endpoint, { cache: 'no-store', signal: controller.signal })
      if (!res.ok) throw new Error('unavailable')
      const data = await res.json()
      if (!controller.signal.aborted) { setRows(data.questions ?? []); setPartial(data.truncated === true); setFailed(false) }
    } catch { if (!controller.signal.aborted) setFailed(true) }
    finally { if (load.current === controller) load.current = null }
  }, [endpoint])
  useEffect(() => { void reload(); return () => { load.current?.abort(); operation.current?.abort() } }, [reload])
  async function save(row: CaseGapAnswer) {
    if (operation.current || answer.trim().length < 2) return
    const controller = new AbortController(); operation.current = controller; receipt.current ??= crypto.randomUUID(); setSaving(true)
    try {
      const res = await csrf(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ id: receipt.current, gap_id: row.gap_id, expected_revision: row.revision, answer: answer.trim() }) })
      const data = await res.json()
      if (!res.ok || data.ok !== true || data.scope !== 'case_only') {
        if (res.status === 409) { receipt.current = null; await reload() }
        throw new Error(data.error || t('gaps.saveFailed'))
      }
      if (controller.signal.aborted) return
      receipt.current = null; setEditing(null); setAnswer(''); toast.success(t('gaps.caseSaved')); await reload()
    } catch (error) {
      if (!controller.signal.aborted) toast.error(error instanceof Error && error.message !== 'Failed to fetch' ? error.message : t('gaps.confirmationFailed'))
    } finally { if (!controller.signal.aborted) setSaving(false); if (operation.current === controller) operation.current = null }
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); toast.success(t('gaps.caseCopied')) }
    catch { toast.error(t('gaps.caseCopyFailed')) }
  }
  return <details className="rounded border p-2">
    <summary className="cursor-pointer font-medium">{t('gaps.caseTitle')}</summary>
    <div className="mt-2 space-y-2">
      <p className="text-muted-foreground">{t('gaps.caseScope')}</p>
      {failed ? <div role="alert"><p>{t('gaps.loadFailed')}</p><Button variant="ghost" size="sm" onClick={() => void reload()}>{t('common.retry')}</Button></div>
        : rows === null ? <Loader2 className="size-4 animate-spin" /> : rows.length === 0 ? <p>{t('gaps.caseEmpty')}</p> : <>
          {partial && <p role="status">{t('gaps.casePartial')}</p>}
          {rows.map(row => <article key={row.gap_id} className="space-y-1 rounded border p-2">
            <p className="font-medium">{row.question}</p>
            {row.missing && <p className="text-muted-foreground">{row.missing}</p>}
            {row.answer && <><p className="whitespace-pre-wrap break-words">{row.answer}</p><p className="text-muted-foreground">{t('gaps.caseRevision', { n: fmt.number(row.revision) })}{row.answered_at && ` · ${fmt.dateTime(row.answered_at)}`}</p><Button size="sm" variant="ghost" onClick={() => void copy(row.answer!)}>{t('gaps.caseCopy')}</Button></>}
            {row.resolved_at ? <p className="text-muted-foreground">{t('gaps.caseResolved')}</p> : editing === row.gap_id ? <>
              <label className="block">{t('gaps.caseAnswer')}<Textarea maxLength={2000} disabled={saving} value={answer} onChange={e => { setAnswer(e.target.value); receipt.current = null }} /></label>
              <p className="text-muted-foreground">{t('gaps.caseNotSent')}</p>
              <Button size="sm" disabled={saving || answer.trim().length < 2} onClick={() => void save(row)}>{saving && <Loader2 className="size-3 animate-spin" />}{t('gaps.caseSave')}</Button>
              <Button size="sm" variant="ghost" disabled={saving} onClick={() => { setEditing(null); receipt.current = null }}>{t('common.cancel')}</Button>
            </> : <Button size="sm" variant="outline" disabled={saving} onClick={() => { setEditing(row.gap_id); setAnswer(row.answer ?? ''); receipt.current = null }}>{t(row.answer ? 'gaps.caseEdit' : 'gaps.caseAnswer')}</Button>}
          </article>)}
        </>}
      <p className="text-muted-foreground">{t('gaps.casePermanent')} <Link className="underline" href="/asistente">{t('gaps.openTarget')}</Link></p>
    </div>
  </details>
}
