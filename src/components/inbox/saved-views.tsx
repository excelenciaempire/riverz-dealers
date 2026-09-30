'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bookmark, Plus, Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf'
import { Button } from '@/components/ui/button'
import { CHANNELS, type Channel } from '@/types'
import { channelLabel } from '@/lib/channels/display'
import { CASE_PRIORITIES, CASE_REASONS, type TeamMember } from '@/lib/inbox/collaboration'
import type { SavedView, SavedViewConfig } from '@/lib/inbox/saved-views'

export function SavedViews({ onChange }: { onChange: (config: SavedViewConfig | null, userId: string) => void }) {
  const t = useT()
  const fmt = useFormat()
  const csrf = useFetchWithCsrf()
  const [views, setViews] = useState<SavedView[]>([])
  const [members, setMembers] = useState<TeamMember[]>([])
  const [userId, setUserId] = useState('')
  const [selected, setSelected] = useState('')
  const selectedId = useRef('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [config, setConfig] = useState<SavedViewConfig>({})
  const [shared, setShared] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetch('/api/inbox/filters', { cache: 'no-store', signal })
      if (!r.ok) throw new Error('load_failed')
      const data = await r.json()
      if (signal?.aborted) return
      setViews(data.filters); setMembers(data.members ?? []); setUserId(data.user_id); setError(false)
      if (selectedId.current && !data.filters.some((v: SavedView) => v.id === selectedId.current && v.supported)) {
        selectedId.current = ''; setSelected(''); onChange(null, data.user_id)
      }
    } catch { if (!signal?.aborted) setError(true) }
  }, [onChange])
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(controller.signal) }, 60000)
    return () => { clearInterval(timer); controller.abort() }
  }, [load])
  function choose(id: string) {
    selectedId.current = id
    setSelected(id)
    onChange(views.find(v => v.id === id)?.config ?? null, userId)
  }
  function field(key: keyof SavedViewConfig, value: string) {
    setConfig(current => {
      const next = { ...current }
      if (value) Object.assign(next, { [key]: value })
      else delete next[key]
      if (key === 'assigned_agent_id' && value && ['mine', 'unassigned'].includes(next.status ?? '')) delete next.status
      if (key === 'status' && ['mine', 'unassigned'].includes(value)) delete next.assigned_agent_id
      return next
    })
  }
  async function save() {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      const r = await csrf('/api/inbox/filters', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, config, is_shared: shared }) })
      if (!r.ok) throw new Error('save_failed')
      const data = await r.json()
      selectedId.current = data.filter.id
      setSelected(data.filter.id); onChange(config, userId)
      setCreating(false); setName(''); await load()
    } catch { toast.error(t('inbox.teamFailed')) }
    finally { setSaving(false) }
  }
  async function remove() {
    if (!selected || saving) return
    setSaving(true)
    try {
      const r = await csrf(`/api/inbox/filters?id=${encodeURIComponent(selected)}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('save_failed')
      choose(''); await load()
    } catch { toast.error(t('inbox.teamFailed')) }
    finally { setSaving(false) }
  }
  return <div className="border-b border-border px-3 py-2 text-xs">
    <div className="flex items-center gap-1.5">
      <Bookmark className="size-3.5 text-muted-foreground" />
      <select className="min-w-0 flex-1 rounded border bg-background p-1.5" aria-label={t('inbox.savedViews')} value={selected} onChange={e => choose(e.target.value)}>
        <option value="">{t('inbox.allCases')}</option>
        {views.map(v => <option key={v.id} value={v.id} disabled={!v.supported}>{v.name}{v.is_shared ? ` · ${t('inbox.sharedView')}` : ''} ({v.count === null ? '—' : fmt.number(v.count)})</option>)}
      </select>
      <Button variant="ghost" size="icon-sm" aria-label={t('inbox.newView')} onClick={() => setCreating(v => !v)}><Plus className="size-3.5" /></Button>
      {views.some(v => v.id === selected && v.user_id === userId) && <Button variant="ghost" size="icon-sm" disabled={saving} aria-label={t('inbox.deleteView')} onClick={() => void remove()}><Trash2 className="size-3.5" /></Button>}
    </div>
    {error && <div role="alert" className="mt-2"><p>{t('inbox.teamFailed')}</p><Button size="sm" variant="ghost" onClick={() => void load()}>{t('common.retry')}</Button></div>}
    {creating && <div className="mt-3 space-y-2 rounded-md border p-2">
      <label className="block">{t('inbox.viewName')}<input maxLength={80} value={name} disabled={saving} onChange={e => setName(e.target.value)} className="mt-1 block w-full rounded border bg-background p-1.5" /></label>
      <label className="block">{t('inbox.viewChannel')}<select value={config.channel ?? ''} disabled={saving} onChange={e => field('channel', e.target.value)} className="mt-1 w-full rounded border bg-background p-1.5">
        <option value="">{t('inbox.viewAny')}</option>{CHANNELS.map(c => <option key={c} value={c}>{channelLabel(c as Channel, t)}</option>)}
      </select></label>
      <label className="block">{t('inbox.viewStatus')}<select value={config.status ?? ''} disabled={saving} onChange={e => field('status', e.target.value)} className="mt-1 w-full rounded border bg-background p-1.5">
        <option value="">{t('inbox.viewAny')}</option>{['unread', 'unassigned', 'mine', 'open', 'pending', 'closed', 'snoozed'].map(s => <option key={s} value={s}>{t(`inbox.viewStatus_${s}`)}</option>)}
      </select></label>
      <label className="block">{t('inbox.viewAssignee')}<select value={config.assigned_agent_id ?? ''} disabled={saving} onChange={e => field('assigned_agent_id', e.target.value)} className="mt-1 w-full rounded border bg-background p-1.5">
        <option value="">{t('inbox.viewAny')}</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select></label>
      <div className="flex gap-2">
        <label className="flex-1">{t('inbox.casePriority')}<select value={config.case_priority ?? ''} disabled={saving} onChange={e => field('case_priority', e.target.value)} className="mt-1 w-full rounded border bg-background p-1.5">
          <option value="">{t('inbox.viewAny')}</option>{CASE_PRIORITIES.map(p => <option key={p} value={p}>{t(`inbox.casePriority_${p}`)}</option>)}
        </select></label>
        <label className="flex-1">{t('inbox.caseReason')}<select value={config.case_reason ?? ''} disabled={saving} onChange={e => field('case_reason', e.target.value)} className="mt-1 w-full rounded border bg-background p-1.5">
          <option value="">{t('inbox.viewAny')}</option>{CASE_REASONS.map(p => <option key={p} value={p}>{t(`inbox.caseReason_${p}`)}</option>)}
        </select></label>
      </div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={shared} disabled={saving} onChange={e => setShared(e.target.checked)} />{t('inbox.shareView')}</label>
      <Button size="sm" disabled={saving || !name.trim()} onClick={() => void save()}>{saving && <Loader2 className="size-3 animate-spin" />}{t('inbox.saveView')}</Button>
    </div>}
  </div>
}
