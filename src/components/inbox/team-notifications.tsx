'use client'

import { useCallback, useEffect, useState } from 'react'
import { AtSign } from 'lucide-react'
import Link from '@/components/i18n/locale-link'
import { useT } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface Notification { id: string; conversation_id: string; created_at: string; read_at: string | null; conversation_notes: { body: string } | null }
export function TeamNotifications() {
  const t = useT()
  const fmt = useFormat()
  const csrf = useFetchWithCsrf()
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [error, setError] = useState(false)
  const [open, setOpen] = useState(false)
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetch('/api/inbox/notifications', { cache: 'no-store', signal })
      if (!r.ok) throw new Error('load_failed')
      const data = await r.json()
      if (signal?.aborted) return
      setItems(data.notifications); setUnread(data.unread); setError(false)
    } catch { if (!signal?.aborted) setError(true) }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    const refresh = () => { if (document.visibilityState === 'visible') void load(controller.signal) }
    refresh()
    const timer = setInterval(refresh, 30000)
    return () => { clearInterval(timer); controller.abort() }
  }, [load])
  async function markRead(id: string) {
    const r = await csrf('/api/inbox/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [id] }) })
    if (r.ok) await load()
  }
  return <Popover open={open} onOpenChange={next => { setOpen(next); if (next) void load() }}>
    <PopoverTrigger render={<Button variant="ghost" size="sm" aria-label={t('inbox.teamMentions')} />}>
      <AtSign className="size-4" />{unread > 0 && <span className="text-xs tabular-nums">{fmt.number(unread)}</span>}
    </PopoverTrigger>
    <PopoverContent align="end" className="w-80 p-3">
      <p className="mb-2 text-sm font-medium">{t('inbox.teamMentions')}</p>
      {error ? <div role="alert" className="text-xs"><p>{t('inbox.teamFailed')}</p><Button size="sm" variant="ghost" onClick={() => void load()}>{t('common.retry')}</Button></div>
        : !items.length ? <p className="text-xs text-muted-foreground">{t('inbox.teamNoMentions')}</p>
        : <div className="max-h-80 space-y-2 overflow-y-auto">{items.map(item => <Link key={item.id} href={`/bandeja?c=${encodeURIComponent(item.conversation_id)}`}
          className={`block rounded-md border p-2 text-xs ${item.read_at ? 'text-muted-foreground' : 'border-primary/30 bg-primary/5'}`}
          onClick={() => { setOpen(false); void markRead(item.id).catch(() => {}) }}>
          <p className="line-clamp-3 whitespace-pre-wrap">{item.conversation_notes?.body}</p>
          <p className="mt-1 text-muted-foreground">{fmt.dateTime(item.created_at)}</p>
        </Link>)}</div>}
    </PopoverContent>
  </Popover>
}
