'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Users, Loader2, StickyNote } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { CASE_PRIORITIES, CASE_REASONS, type CasePriority, type CaseReason, type InternalNote, type PresenceMember, type TeamMember } from '@/lib/inbox/collaboration'
import { RelatedConversations } from './related-conversations'
import { CaseFollowups } from './case-followups'

interface TeamState {
  user_id: string; notes: InternalNote[]; members: TeamMember[]; presence: PresenceMember[];
  case: { case_priority: CasePriority; case_reason: CaseReason | null }; next_cursor: string | null
}

export function ConversationCollaboration({ conversationId, composing }: { conversationId: string; composing: boolean }) {
  const t = useT()
  const fmt = useFormat()
  const csrf = useFetchWithCsrf()
  const [state, setState] = useState<TeamState | null>(null)
  const [error, setError] = useState(false)
  const [body, setBody] = useState('')
  const [mentions, setMentions] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [older, setOlder] = useState<InternalNote[]>([])
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const session = useRef<string | null>(null)
  const presenceVersion = useRef(0)
  const noteId = useRef<string | null>(null)
  const writing = useRef(composing)
  const alive = useRef(true)
  const pending = useRef(false)
  const endpoint = `/api/conversations/${conversationId}/collaboration`

  const reload = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetch(endpoint, { cache: 'no-store', signal })
      if (!r.ok) throw new Error('load_failed')
      const data = await r.json() as TeamState
      if (alive.current) { setState(data); setError(false) }
    } catch { if (alive.current && !signal?.aborted) setError(true) }
  }, [endpoint])

  useEffect(() => {
    alive.current = true
    session.current = crypto.randomUUID()
    const controller = new AbortController()
    async function heartbeat() {
      if (pending.current || document.visibilityState !== 'visible') return
      pending.current = true
      try {
        await csrf(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'presence', session_id: session.current, composing: writing.current, version: ++presenceVersion.current }), signal: controller.signal })
        await reload(controller.signal)
      } catch { /* The lease expires if the browser loses its connection. */ }
      finally { pending.current = false }
    }
    void heartbeat()
    const timer = setInterval(() => void heartbeat(), 10000)
    document.addEventListener('visibilitychange', heartbeat)
    return () => {
      alive.current = false
      controller.abort()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', heartbeat)
      void csrf(`${endpoint}?session_id=${session.current}`, { method: 'DELETE', keepalive: true }).catch(() => {})
    }
  }, [csrf, endpoint, reload])

  useEffect(() => {
    writing.current = composing
    if (!session.current) return
    void csrf(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'presence', session_id: session.current, composing, version: ++presenceVersion.current }) }).catch(() => {})
  }, [composing, csrf, endpoint])

  async function addNote() {
    if (!body.trim() || saving) return
    noteId.current ??= crypto.randomUUID()
    setSaving(true)
    try {
      const r = await csrf(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'note', id: noteId.current, body, mentions }) })
      if (!r.ok) throw new Error('save_failed')
      if (!alive.current) return
      setBody(''); setMentions([]); noteId.current = null
      await reload()
    } catch { if (alive.current) toast.error(t('inbox.teamFailed')) }
    finally { if (alive.current) setSaving(false) }
  }

  async function updateCase(priority: CasePriority, reason: CaseReason | null) {
    if (saving) return
    setSaving(true)
    try {
      const r = await csrf(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'case', priority, reason }) })
      if (!r.ok) throw new Error('save_failed')
      await reload()
    } catch { if (alive.current) toast.error(t('inbox.teamFailed')) }
    finally { if (alive.current) setSaving(false) }
  }

  async function loadOlder() {
    const cursor = olderCursor === undefined ? state?.next_cursor : olderCursor
    if (!cursor || loadingOlder) return
    setLoadingOlder(true)
    try {
      const r = await fetch(`${endpoint}?before=${encodeURIComponent(cursor)}`, { cache: 'no-store' })
      if (!r.ok) throw new Error('load_failed')
      const data = await r.json() as TeamState
      if (alive.current) { setOlder(rows => [...data.notes, ...rows]); setOlderCursor(data.next_cursor) }
    } catch { if (alive.current) toast.error(t('inbox.teamFailed')) }
    finally { if (alive.current) setLoadingOlder(false) }
  }

  const notes = [...new Map([...older, ...(state?.notes ?? [])].map(n => [n.id, n])).values()]
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
  const writers = state?.presence.filter(p => p.composing) ?? []
  const viewers = state?.presence.filter(p => !p.composing) ?? []
  return <div className="shrink-0 border-t border-border px-4 py-2 text-xs">
    {writers.length > 0 && <p role="status" className="mb-2 font-medium text-amber-700 dark:text-amber-300">{t('inbox.teamComposing', { names: writers.map(p => p.name).join(', ') })}</p>}
    {!writers.length && viewers.length > 0 && <p className="mb-2 text-muted-foreground">{t('inbox.teamViewing', { names: viewers.map(p => p.name).join(', ') })}</p>}
    <details>
      <summary className="flex cursor-pointer items-center gap-2 font-medium"><Users className="size-3.5" />{t('inbox.teamTitle')}
        {state && state.case.case_priority !== 'normal' && <span className="rounded bg-amber-500/10 px-1.5 py-0.5">{t(`inbox.casePriority_${state.case.case_priority}`)}</span>}
      </summary>
      <div className="mt-3 max-h-80 space-y-3 overflow-y-auto">
        {error ? <div role="alert"><p>{t('inbox.teamFailed')}</p><Button size="sm" variant="ghost" onClick={() => void reload()}>{t('common.retry')}</Button></div>
          : !state ? <Loader2 className="size-4 animate-spin" /> : <>
            <div className="flex gap-2">
              <label className="flex-1">{t('inbox.casePriority')}<select className="mt-1 block w-full rounded border bg-background p-1.5" value={state.case.case_priority} disabled={saving}
                onChange={e => void updateCase(e.target.value as CasePriority, state.case.case_reason)}>
                {CASE_PRIORITIES.map(p => <option key={p} value={p}>{t(`inbox.casePriority_${p}`)}</option>)}
              </select></label>
              <label className="flex-1">{t('inbox.caseReason')}<select className="mt-1 block w-full rounded border bg-background p-1.5" value={state.case.case_reason ?? ''} disabled={saving}
                onChange={e => void updateCase(state.case.case_priority, e.target.value as CaseReason || null)}>
                <option value="">{t('inbox.caseUnclassified')}</option>
                {CASE_REASONS.map(p => <option key={p} value={p}>{t(`inbox.caseReason_${p}`)}</option>)}
              </select></label>
            </div>
            {(olderCursor === undefined ? state.next_cursor : olderCursor) && <Button size="sm" variant="ghost" disabled={loadingOlder} onClick={() => void loadOlder()}>{t('inbox.teamOlderNotes')}</Button>}
            {notes.map(note => <article key={note.id} className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2.5">
              <p className="flex items-center gap-1.5 text-muted-foreground"><StickyNote className="size-3" />{note.author_name} · {fmt.dateTime(note.created_at)}</p>
              <p className="mt-1 whitespace-pre-wrap break-words">{note.body}</p>
              {note.mentioned_user_ids.length > 0 && <p className="mt-1 text-muted-foreground">{note.mentioned_user_ids.map(id => `@${state.members.find(m => m.id === id)?.name ?? t('inbox.teamMember')}`).join(' ')}</p>}
            </article>)}
            <label className="block">{t('inbox.teamNote')}<Textarea className="mt-1" maxLength={5000} value={body} disabled={saving}
              onChange={e => { setBody(e.target.value); noteId.current = null }} placeholder={t('inbox.teamNotePlaceholder')} /></label>
            <div className="flex flex-wrap gap-2">
              {state.members.filter(m => m.id !== state.user_id).map(m => <label key={m.id} className="flex items-center gap-1.5">
                <input type="checkbox" disabled={saving || (mentions.length >= 20 && !mentions.includes(m.id))} checked={mentions.includes(m.id)}
                  onChange={e => { setMentions(ids => e.target.checked ? [...ids, m.id] : ids.filter(id => id !== m.id)); noteId.current = null }} />@{m.name}
              </label>)}
            </div>
            <Button size="sm" disabled={saving || !body.trim()} onClick={() => void addNote()}>{saving && <Loader2 className="size-3 animate-spin" />}{t('inbox.teamAddNote')}</Button>
            <RelatedConversations conversationId={conversationId} />
            <CaseFollowups key={conversationId} conversationId={conversationId} />
          </>}
      </div>
    </details>
  </div>
}
