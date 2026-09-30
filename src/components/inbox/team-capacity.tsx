'use client'
import { useCallback, useEffect, useState } from 'react'
import { Users, Loader2 } from 'lucide-react'
import { useT } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf'
import { Button } from '@/components/ui/button'
import type { TeamInfo } from './macro-manager'

export function TeamCapacity() {
  const t = useT()
  const fmt = useFormat()
  const csrf = useFetchWithCsrf()
  const [info, setInfo] = useState<TeamInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [members, setMembers] = useState<string[]>([])
  const [enabled, setEnabled] = useState(true)
  const [capacities, setCapacities] = useState<Record<string, number>>({})
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetch('/api/inbox/team', { cache: 'no-store', signal })
      if (!r.ok) throw new Error('load_failed')
      const value = await r.json()
      if (!signal?.aborted) { setInfo(value); setError('') }
    } catch { if (!signal?.aborted) setError(t('inbox.teamFailed')) }
  }, [t])
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(controller.signal) }, 60000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [load])
  async function change(body: Record<string, unknown>) {
    if (busy) return
    setBusy(true); setError('')
    try {
      const r = await csrf('/api/inbox/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const value = await r.json()
      if (!r.ok) throw new Error(value.error || t('inbox.teamFailed'))
      setEditing(null); await load()
    } catch (e) { setError(e instanceof Error ? e.message : t('inbox.teamFailed')) }
    finally { setBusy(false) }
  }
  const me = info?.members.find(m => m.id === info.user_id)
  return <details className="border-b border-border px-3 py-2 text-xs">
    <summary className="flex cursor-pointer items-center gap-2 font-medium"><Users className="size-3.5" />{t('inbox.teamWorkTitle')}</summary>
    <div className="mt-3 max-h-96 space-y-3 overflow-y-auto">
      {error && <div role="alert"><p>{error}</p><Button variant="ghost" size="sm" onClick={() => void load()}>{t('common.retry')}</Button></div>}
      {!info ? <Loader2 className="size-4 animate-spin" /> : <>
        {me && <label className="flex items-center gap-2"><input type="checkbox" checked={me.available} disabled={busy || !me.enabled}
          onChange={e => void change({ action: 'state', user_id: me.id, available: e.target.checked })} />{t('inbox.teamAvailable')}<span className="text-muted-foreground">{fmt.number(me.active)} / {fmt.number(me.capacity)}</span></label>}
        <p className="text-muted-foreground">{t('inbox.teamAvailabilityExplanation')}</p>
        {info.members.map(member => <div key={member.id} className="rounded border p-2">
          <p className="font-medium">{member.name}</p><p className="text-muted-foreground">{t('inbox.teamLoad', { active: fmt.number(member.active), capacity: fmt.number(member.capacity) })} · {t(!member.enabled ? 'inbox.teamDisabled' : member.available ? 'inbox.teamAvailable' : 'inbox.teamUnavailableLabel')}</p>
          {info.is_admin && <div className="mt-2 flex items-center gap-2"><label className="min-w-0 flex-1">{t('inbox.teamCapacity')}<input type="number" min={1} max={500} disabled={busy} value={capacities[member.id] ?? member.capacity}
            className="mt-1 block w-full rounded border bg-background p-1.5" onChange={e => setCapacities(values => ({ ...values, [member.id]: Number(e.target.value) }))} /></label>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void change({ action: 'state', user_id: member.id, capacity: capacities[member.id] ?? member.capacity })}>{t('common.save')}</Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void change({ action: 'state', user_id: member.id, enabled: !member.enabled })}>{t(member.enabled ? 'inbox.teamDisable' : 'inbox.teamEnable')}</Button>
          </div>}
        </div>)}
        {info.teams.map(group => <div key={group.id} className="rounded border p-2"><p className="font-medium">{group.name} · {fmt.number(group.member_ids.length)}</p>
          <p className="text-muted-foreground">{group.member_ids.map(id => info.members.find(m => m.id === id)?.name).filter(Boolean).join(', ')}</p>
          {!group.enabled && <p>{t('inbox.teamDisabled')}</p>}
          {info.is_admin && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setEditing(group.id); setName(group.name); setMembers(group.member_ids); setEnabled(group.enabled) }}>{t('inbox.editTeam')}</Button>}
        </div>)}
        {info.is_admin && <Button variant="outline" size="sm" disabled={busy} onClick={() => { setEditing('new'); setName(''); setMembers([]); setEnabled(true) }}>{t('inbox.newTeam')}</Button>}
        {editing && <div className="space-y-2 rounded border p-2"><label className="block">{t('inbox.teamGroupName')}<input maxLength={80} disabled={busy} className="mt-1 block w-full rounded border bg-background p-1.5" value={name} onChange={e => setName(e.target.value)} /></label>
          {info.members.map(member => <label key={member.id} className="flex items-center gap-2"><input type="checkbox" disabled={busy} checked={members.includes(member.id)} onChange={e => setMembers(ids => e.target.checked ? [...ids, member.id] : ids.filter(id => id !== member.id))} />{member.name}</label>)}
          <label className="flex items-center gap-2"><input type="checkbox" checked={enabled} disabled={busy} onChange={e => setEnabled(e.target.checked)} />{t('inbox.teamGroupEnabled')}</label>
          <div className="flex gap-2"><Button size="sm" disabled={busy || !name.trim()} onClick={() => void change({ action: 'team', ...(editing !== 'new' ? { id: editing } : {}), name, enabled, member_ids: members })}>{t('common.save')}</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(null)}>{t('common.cancel')}</Button></div>
        </div>}
        <p className="border-t pt-2 text-muted-foreground">{t('inbox.inboxShortcutsHelp')}</p>
      </>}
    </div>
  </details>
}
