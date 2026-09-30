'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Clock3, Loader2 } from 'lucide-react'
import { useT } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf'
import { Button } from '@/components/ui/button'
import type { InboxAction, InboxReminder, InboxActionResult } from '@/lib/inbox/case-actions'
import { ActionPreview } from './action-preview'
import { MacroManager } from './macro-manager'

interface Followups { snoozed_until: string | null; reminders: InboxReminder[]; history: { id: string; created_at: string; result: InboxActionResult[] }[] }
export function CaseFollowups({ conversationId }: { conversationId: string }) {
  const t = useT()
  const fmt = useFormat()
  const csrf = useFetchWithCsrf()
  const [state, setState] = useState<Followups | null>(null)
  const [date, setDate] = useState('')
  const [body, setBody] = useState('')
  const [mode, setMode] = useState<'snooze' | 'reminder'>('snooze')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [zone, setZone] = useState('')
  const operation = useRef<{ id: string; payload: string } | null>(null)
  const alive = useRef(true)
  const endpoint = `/api/conversations/${conversationId}/actions`
  const reload = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetch(endpoint, { cache: 'no-store', signal })
      if (!r.ok) throw new Error('load_failed')
      const value = await r.json()
      if (alive.current && !signal?.aborted) { setState(value); setError('') }
    } catch { if (alive.current && !signal?.aborted) setError(t('inbox.teamFailed')) }
  }, [endpoint, t])
  useEffect(() => {
    alive.current = true
    setZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
    const controller = new AbortController()
    void reload(controller.signal)
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void reload(controller.signal) }, 60000)
    return () => { alive.current = false; controller.abort(); clearInterval(timer) }
  }, [reload])
  async function execute(actions: InboxAction[]) {
    if (saving) return
    const payload = JSON.stringify(actions)
    if (operation.current?.payload !== payload) operation.current = { id: crypto.randomUUID(), payload }
    setSaving(true); setError('')
    try {
      const r = await csrf(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: operation.current!.id, actions }) })
      const value = await r.json()
      if (!r.ok) throw new Error(value.error || t('inbox.teamFailed'))
      if (!alive.current) return
      operation.current = null; setDate(''); setBody(''); await reload()
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : t('inbox.teamFailed')) }
    finally { if (alive.current) setSaving(false) }
  }
  function schedule() {
    const ms = Date.parse(date)
    if (!Number.isFinite(ms) || ms <= Date.now()) { setError(t('inbox.followupInvalidDate')); return }
    const instant = new Date(ms).toISOString()
    void execute(mode === 'snooze' ? [{ type: 'snooze', until: instant }] : [{ type: 'reminder', due_at: instant, body }])
  }
  return <details className="rounded border p-2">
    <summary className="flex cursor-pointer items-center gap-2 font-medium"><Clock3 className="size-3.5" />{t('inbox.followupsTitle')}</summary>
    <div className="mt-3 space-y-3">
      {error && <div role="alert"><p>{error}</p><Button size="sm" variant="ghost" onClick={() => void reload()}>{t('common.retry')}</Button></div>}
      {!state ? <Loader2 className="size-4 animate-spin" /> : <>
        {state.snoozed_until && <div className="rounded border p-2"><p>{t('inbox.snoozedUntil', { date: fmt.dateTime(state.snoozed_until) })}</p>
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => void execute([{ type: 'resume' }])}>{t('inbox.resumeNow')}</Button></div>}
        <label className="block">{t('inbox.followupKind')}<select className="mt-1 block w-full rounded border bg-background p-1.5" value={mode} disabled={saving} onChange={e => setMode(e.target.value as typeof mode)}>
          <option value="snooze">{t('inbox.action_snooze')}</option><option value="reminder">{t('inbox.action_reminder')}</option>
        </select></label>
        <label className="block">{t('inbox.followupDate')}<input type="datetime-local" className="mt-1 block w-full rounded border bg-background p-1.5" value={date} disabled={saving} onChange={e => setDate(e.target.value)} /></label>
        <p className="text-muted-foreground">{t('inbox.followupTimezone', { zone })}</p>
        {mode === 'reminder' && <label className="block">{t('inbox.reminderBody')}<textarea className="mt-1 block w-full rounded border bg-background p-2" maxLength={1000} value={body} disabled={saving} onChange={e => setBody(e.target.value)} /></label>}
        <p className="text-muted-foreground">{t(mode === 'snooze' ? 'inbox.snoozeExplanation' : 'inbox.reminderExplanation')}</p>
        <Button size="sm" disabled={saving || !date || (mode === 'reminder' && !body.trim())} onClick={schedule}>{saving && <Loader2 className="size-3 animate-spin" />}{t('inbox.scheduleFollowup')}</Button>
        {state.reminders.map(reminder => <div className="rounded border p-2" key={reminder.id}><p className="whitespace-pre-wrap break-words">{reminder.body}</p><p className="mt-1 text-muted-foreground">{fmt.dateTime(reminder.due_at)}</p>
          <Button variant="ghost" size="sm" disabled={saving} onClick={() => void execute([{ type: 'cancel_reminder', id: reminder.id }])}>{t('inbox.cancelReminder')}</Button></div>)}
        <MacroManager conversationId={conversationId} onApplied={reload} />
        {state.history.length > 0 && <details><summary className="cursor-pointer">{t('inbox.actionHistory')}</summary><div className="mt-2 space-y-2">{state.history.map(run => <div key={run.id}>
          <p className="mb-1 text-muted-foreground">{fmt.dateTime(run.created_at)}</p><ActionPreview actions={run.result} />
        </div>)}</div></details>}
      </>}
    </div>
  </details>
}
