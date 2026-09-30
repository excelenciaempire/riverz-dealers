'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { useT } from '@/hooks/use-locale'
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf'
import { Button } from '@/components/ui/button'
import { inboxActions, type InboxAction, type InboxMacro } from '@/lib/inbox/case-actions'
import { CASE_PRIORITIES, CASE_REASONS, type CasePriority, type CaseReason } from '@/lib/inbox/collaboration'
import { ActionPreview } from './action-preview'

interface Team { id: string; name: string; enabled: boolean; member_ids: string[] }
interface Member { id: string; name: string; available: boolean; enabled: boolean; capacity: number; active: number }
export interface TeamInfo { teams: Team[]; members: Member[]; user_id: string; is_admin: boolean }
const TYPES = ['case', 'note', 'tag', 'snooze', 'reminder', 'assign', 'resume'] as const
function newAction(type: typeof TYPES[number]): InboxAction {
  switch (type) {
    case 'case': return { type, priority: 'normal', reason: null }
    case 'note': return { type, body: '', mentions: [] }
    case 'tag': return { type, tag_id: '' }
    case 'snooze': return { type, minutes: 60 }
    case 'reminder': return { type, minutes: 60, body: '' }
    case 'assign': return { type, team_id: '' }
    case 'resume': return { type }
  }
}
export function MacroManager({ conversationId, onApplied }: { conversationId: string; onApplied: () => Promise<void> }) {
  const t = useT()
  const csrf = useFetchWithCsrf()
  const [macros, setMacros] = useState<InboxMacro[]>([])
  const [team, setTeam] = useState<TeamInfo | null>(null)
  const [tags, setTags] = useState<{ id: string; name: string }[]>([])
  const [selected, setSelected] = useState('')
  const [reviewed, setReviewed] = useState(false)
  const [editing, setEditing] = useState<InboxMacro | 'new' | null>(null)
  const [name, setName] = useState('')
  const [actions, setActions] = useState<InboxAction[]>([newAction('case')])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const operation = useRef<{ macroId: string; version: number; id: string } | null>(null)
  const alive = useRef(true)
  const load = useCallback(async (signal?: AbortSignal) => {
    const r = await fetch('/api/inbox/macros', { cache: 'no-store', signal })
    if (!r.ok) throw new Error(t('inbox.teamFailed'))
    const value = await r.json()
    if (alive.current && !signal?.aborted) { setMacros(value.macros); setTags(value.tags ?? []); setReviewed(false) }
  }, [t])
  useEffect(() => {
    alive.current = true
    const controller = new AbortController()
    async function initial() {
      try {
        await load(controller.signal)
        const tr = await fetch('/api/inbox/team', { signal: controller.signal })
        if (!tr.ok) throw new Error(t('inbox.teamFailed'))
        const teams = await tr.json()
        if (alive.current) setTeam(teams)
      } catch { if (alive.current && !controller.signal.aborted) setError(t('inbox.teamFailed')) }
    }
    void initial()
    return () => { alive.current = false; controller.abort() }
  }, [load, t])
  const chosen = macros.find(m => m.id === selected)
  function edit(macro: InboxMacro | 'new') {
    setEditing(macro); setName(macro === 'new' ? '' : macro.name)
    setActions(macro === 'new' ? [newAction('case')] : structuredClone(macro.actions)); setError('')
  }
  function update(index: number, patch: Partial<InboxAction>) {
    setActions(rows => rows.map((row, i) => i === index ? { ...row, ...patch } as InboxAction : row))
  }
  async function save() {
    if (busy) return
    const valid = inboxActions(actions, { macro: true })
    if (!name.trim() || !valid) { setError(t('inbox.teamInvalid')); return }
    setBusy(true); setError('')
    try {
      const r = await csrf('/api/inbox/macros', { method: editing === 'new' ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, actions: valid, ...(editing && editing !== 'new' ? { id: editing.id, version: editing.version } : {}) }) })
      const value = await r.json()
      if (!r.ok) throw new Error(value.error || t('inbox.teamFailed'))
      if (!alive.current) return
      setEditing(null); setSelected(value.macro.id); setReviewed(false); await load()
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : t('inbox.teamFailed')) }
    finally { if (alive.current) setBusy(false) }
  }
  async function archive() {
    if (!chosen || busy) return
    setBusy(true); setError('')
    try {
      const r = await csrf(`/api/inbox/macros?id=${chosen.id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(t('inbox.teamFailed'))
      if (!alive.current) return
      setSelected(''); setReviewed(false); await load()
    } catch { if (alive.current) setError(t('inbox.teamFailed')) }
    finally { if (alive.current) setBusy(false) }
  }
  async function apply() {
    if (!chosen || !reviewed || busy) return
    if (operation.current?.macroId !== chosen.id || operation.current.version !== chosen.version) operation.current = { macroId: chosen.id, version: chosen.version, id: crypto.randomUUID() }
    setBusy(true); setError('')
    try {
      const r = await csrf(`/api/conversations/${conversationId}/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: operation.current.id, macro_id: chosen.id, version: chosen.version }) })
      const value = await r.json()
      if (!r.ok) throw new Error(value.error || t('inbox.teamFailed'))
      if (!alive.current) return
      operation.current = null; setReviewed(false); await onApplied()
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : t('inbox.teamFailed')) }
    finally { if (alive.current) setBusy(false) }
  }
  return <details className="border-t pt-2">
    <summary className="cursor-pointer font-medium">{t('inbox.macrosTitle')}</summary>
    <div className="mt-3 space-y-3">
      {error && <div role="alert"><p>{error}</p><Button size="sm" variant="ghost" disabled={busy} onClick={() => {
        setError(''); void load().then(async () => {
          const r = await fetch('/api/inbox/team', { cache: 'no-store' })
          if (!r.ok) throw new Error(t('inbox.teamFailed'))
          const value = await r.json(); if (alive.current) setTeam(value)
        }).catch(() => { if (alive.current) setError(t('inbox.teamFailed')) })
      }}>{t('inbox.bulkRetry')}</Button></div>}
      <p className="text-muted-foreground">{t('inbox.macrosExplanation')}</p>
      <label className="block">{t('inbox.selectMacro')}<select className="mt-1 block w-full rounded border bg-background p-1.5" disabled={busy} value={selected} onChange={e => { setSelected(e.target.value); setReviewed(false) }}>
        <option value="">{t('inbox.selectMacro')}</option>{macros.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select></label>
      {chosen && <><ActionPreview actions={chosen.actions} labels={{ tags: Object.fromEntries(tags.map(tag => [tag.id, tag.name])), teams: Object.fromEntries((team?.teams ?? []).map(g => [g.id, g.name])), members: Object.fromEntries((team?.members ?? []).map(m => [m.id, m.name])) }} /><label className="flex items-start gap-2"><input type="checkbox" checked={reviewed} disabled={busy} onChange={e => setReviewed(e.target.checked)} />{t('inbox.reviewMacro')}</label>
        <Button size="sm" disabled={busy || !reviewed} onClick={() => void apply()}>{busy && <Loader2 className="size-3 animate-spin" />}{t('inbox.applyMacro')}</Button>
        {team && (team.is_admin || chosen.created_by === team.user_id) && <div className="flex gap-2"><Button variant="ghost" size="sm" disabled={busy} onClick={() => edit(chosen)}>{t('inbox.editMacro')}</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => void archive()}>{t('inbox.archiveMacro')}</Button></div>}
      </>}
      {!editing && <Button size="sm" variant="outline" disabled={busy} onClick={() => edit('new')}><Plus className="size-3" />{t('inbox.newMacro')}</Button>}
      {editing && <div className="space-y-3 rounded border p-2">
        <label className="block">{t('inbox.macroName')}<input className="mt-1 block w-full rounded border bg-background p-1.5" disabled={busy} value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label>
        {actions.map((action, index) => <div className="space-y-2 rounded border p-2" key={index}>
          <div className="flex gap-2"><select className="min-w-0 flex-1 rounded border bg-background p-1.5" aria-label={t('inbox.macroAction')} disabled={busy} value={action.type}
            onChange={e => setActions(rows => rows.map((row, i) => i === index ? newAction(e.target.value as typeof TYPES[number]) : row))}>
            {TYPES.map(type => <option key={type} value={type}>{t(`inbox.action_${type}`)}</option>)}
          </select><Button size="icon-sm" variant="ghost" disabled={busy || actions.length < 2} aria-label={t('inbox.removeMacroAction')} onClick={() => setActions(rows => rows.filter((_, i) => i !== index))}><Trash2 className="size-3" /></Button></div>
          {action.type === 'case' && <div className="flex gap-2"><label className="flex-1">{t('inbox.casePriority')}<select className="block w-full rounded border bg-background p-1.5" disabled={busy} value={action.priority} onChange={e => update(index, { priority: e.target.value as CasePriority })}>{CASE_PRIORITIES.map(p => <option key={p} value={p}>{t(`inbox.casePriority_${p}`)}</option>)}</select></label>
            <label className="flex-1">{t('inbox.caseReason')}<select className="block w-full rounded border bg-background p-1.5" disabled={busy} value={action.reason ?? ''} onChange={e => update(index, { reason: e.target.value as CaseReason || null })}><option value="">{t('inbox.caseUnclassified')}</option>{CASE_REASONS.map(p => <option key={p} value={p}>{t(`inbox.caseReason_${p}`)}</option>)}</select></label></div>}
          {(action.type === 'note' || action.type === 'reminder') && <label className="block">{t(action.type === 'note' ? 'inbox.teamNote' : 'inbox.reminderBody')}<textarea className="mt-1 block w-full rounded border bg-background p-1.5" disabled={busy} maxLength={action.type === 'note' ? 5000 : 1000} value={action.body} onChange={e => update(index, { body: e.target.value })} /></label>}
          {'minutes' in action && <label className="block">{t('inbox.actionMinutes')}<input className="mt-1 block w-full rounded border bg-background p-1.5" disabled={busy} type="number" min={1} max={43200} value={action.minutes} onChange={e => update(index, { minutes: Number(e.target.value) })} /></label>}
          {action.type === 'tag' && <label className="block">{t('inbox.macroTag')}<select className="mt-1 block w-full rounded border bg-background p-1.5" disabled={busy} value={action.tag_id} onChange={e => update(index, { tag_id: e.target.value })}><option value="">{t('inbox.selectTag')}</option>{tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label>}
          {action.type === 'assign' && <label className="block">{t('inbox.teamGroup')}<select className="mt-1 block w-full rounded border bg-background p-1.5" disabled={busy} value={action.team_id ?? ''} onChange={e => setActions(rows => rows.map((row, i) => i === index ? { type: 'assign', team_id: e.target.value } : row))}><option value="">{t('inbox.selectTeam')}</option>{team?.teams.filter(g => g.enabled).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>}
        </div>)}
        <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={busy || actions.length >= 10} onClick={() => setActions(rows => [...rows, newAction('note')])}>{t('inbox.addMacroAction')}</Button>
          <Button size="sm" disabled={busy || !name.trim()} onClick={() => void save()}>{t('inbox.saveMacro')}</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(null)}>{t('common.cancel')}</Button></div>
      </div>}
    </div>
  </details>
}
