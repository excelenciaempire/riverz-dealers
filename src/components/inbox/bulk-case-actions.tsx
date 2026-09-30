'use client'
import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useT } from '@/hooks/use-locale'
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf'
import { Button } from '@/components/ui/button'
import { channelLabel } from '@/lib/channels/display'
import type { Channel } from '@/types'
import type { InboxMacro } from '@/lib/inbox/case-actions'
import { ActionPreview, type ActionLabels } from './action-preview'
import type { TeamInfo } from './macro-manager'

interface Preview { cases: { id: string; channel: Channel; contact: { name: string | null } | null }[]; macro: InboxMacro }
interface Result { id: string; ok: boolean; error?: string }
export function BulkCaseActions({ ids, onApplied }: { ids: string[]; onApplied: () => void }) {
  const t = useT()
  const csrf = useFetchWithCsrf()
  const [macros, setMacros] = useState<InboxMacro[]>([])
  const [selected, setSelected] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [labels, setLabels] = useState<ActionLabels>({ tags: {}, teams: {}, members: {} })
  const operation = useRef<string | null>(null)
  const pendingIds = useRef<string[]>([])
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    async function load() {
      try {
        const [r, tr] = await Promise.all([fetch('/api/inbox/macros', { cache: 'no-store', signal: controller.signal }), fetch('/api/inbox/team', { cache: 'no-store', signal: controller.signal })])
        if (!r.ok || !tr.ok) throw new Error('load_failed')
        const value = await r.json()
        const team = await tr.json() as TeamInfo
        if (!controller.signal.aborted) { setMacros(value.macros); setLabels({ tags: Object.fromEntries((value.tags as { id: string; name: string }[]).map(tag => [tag.id, tag.name])), teams: Object.fromEntries(team.teams.map(g => [g.id, g.name])), members: Object.fromEntries(team.members.map(m => [m.id, m.name])) }) }
      } catch { if (!controller.signal.aborted) setError(t('inbox.teamFailed')) }
    }
    void load()
    return () => controller.abort()
  }, [open, t])
  async function review() {
    const chosen = macros.find(m => m.id === selected)
    if (!chosen || busy || ids.length < 1 || ids.length > 100) return
    setBusy(true); setError(''); setPreview(null); setResults([])
    operation.current = crypto.randomUUID(); pendingIds.current = [...ids]
    try {
      const r = await csrf('/api/inbox/bulk-actions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: operation.current, ids: pendingIds.current, macro_id: chosen.id, version: chosen.version, dry_run: true }) })
      const value = await r.json()
      if (!r.ok) throw new Error(value.error || t('inbox.teamFailed'))
      setPreview(value); setConfirmed(false)
    } catch (e) { setError(e instanceof Error ? e.message : t('inbox.teamFailed')) }
    finally { setBusy(false) }
  }
  async function apply() {
    if (!preview || !confirmed || busy || !operation.current) return
    setBusy(true); setError('')
    try {
      const r = await csrf('/api/inbox/bulk-actions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: operation.current, ids: pendingIds.current, macro_id: preview.macro.id, version: preview.macro.version, dry_run: false }) })
      const value = await r.json()
      if (!r.ok) throw new Error(value.error || t('inbox.teamFailed'))
      setResults(current => [...current.filter(row => !value.results.some((next: Result) => next.id === row.id)), ...value.results])
      pendingIds.current = value.results.filter((row: Result) => !row.ok).map((row: Result) => row.id)
      onApplied()
    } catch (e) { setError(e instanceof Error ? e.message : t('inbox.teamFailed')) }
    finally { setBusy(false) }
  }
  const finished = results.length > 0 && results.every(row => row.ok)
  const selectionCurrent = !preview || JSON.stringify(preview.cases.map(c => c.id).sort()) === JSON.stringify([...ids].sort())
  return <div className="text-xs">
    <Button size="sm" variant="outline" disabled={busy || ids.length < 1 || ids.length > 100} onClick={() => { setOpen(v => !v); setPreview(null); setConfirmed(false); setResults([]); setError('') }}>{t('inbox.bulkMacro')}</Button>
    {open && <div className="mt-2 max-h-80 space-y-3 overflow-y-auto rounded border p-2">
      <p>{t('inbox.bulkMacroExplanation')}</p>{error && <p role="alert">{error}</p>}
      {!preview ? <><label className="block">{t('inbox.selectMacro')}<select className="mt-1 w-full rounded border bg-background p-1.5" disabled={busy} value={selected} onChange={e => setSelected(e.target.value)}><option value="">{t('inbox.selectMacro')}</option>{macros.map(m => <option value={m.id} key={m.id}>{m.name}</option>)}</select></label>
        <Button size="sm" disabled={busy || !selected} onClick={() => void review()}>{t('inbox.bulkReview')}</Button></> : <>
        <p className="font-medium">{preview.macro.name}</p><ActionPreview actions={preview.macro.actions} labels={labels} />
        <ol className="space-y-1">{preview.cases.map(c => <li key={c.id}>{c.contact?.name ?? t('inbox.teamMember')} · {channelLabel(c.channel, t)}</li>)}</ol>
        <label className="flex items-start gap-2"><input type="checkbox" disabled={busy || finished} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{t('inbox.bulkMacroConfirm')}</label>
        <Button size="sm" disabled={busy || !confirmed || finished || !selectionCurrent} onClick={() => void apply()}>{busy && <Loader2 className="size-3 animate-spin" />}{t(results.length ? 'inbox.bulkMacroRetry' : 'inbox.bulkMacroApply', { n: preview.cases.length })}</Button>
        {!selectionCurrent && <Button size="sm" variant="outline" disabled={busy} onClick={() => void review()}>{t('inbox.bulkReview')}</Button>}
        {results.length > 0 && <div role="status"><p>{t('inbox.bulkMacroResult', { ok: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length })}</p>
          {results.filter(r => !r.ok).map(row => <p key={row.id}>{preview.cases.find(c => c.id === row.id)?.contact?.name ?? t('inbox.teamMember')}: {row.error}</p>)}</div>}
      </>}
    </div>}
  </div>
}
