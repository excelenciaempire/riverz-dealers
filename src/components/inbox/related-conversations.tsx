'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from '@/components/i18n/locale-link'
import { Link2, Link2Off, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf'
import { Button } from '@/components/ui/button'
import { channelLabel } from '@/lib/channels/display'
import type { Channel } from '@/types'

interface Related { id: string; channel: Channel; last_message_text: string | null; last_message_at: string | null; status: string }
interface Reference { id: string; target: Related; linked_at: string }
export function RelatedConversations({ conversationId }: { conversationId: string }) {
  const t = useT()
  const fmt = useFormat()
  const csrf = useFetchWithCsrf()
  const [data, setData] = useState<{ candidates: Related[]; links: Reference[] } | null>(null)
  const [error, setError] = useState(false)
  const [selected, setSelected] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const endpoint = `/api/conversations/${conversationId}/related`
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetch(endpoint, { signal, cache: 'no-store' })
      if (!r.ok) throw new Error('load_failed')
      const value = await r.json()
      if (!signal?.aborted) { setData(value); setError(false) }
    } catch { if (!signal?.aborted) setError(true) }
  }, [endpoint])
  useEffect(() => { const c = new AbortController(); void load(c.signal); return () => c.abort() }, [load])
  async function change(id?: string) {
    if (saving || (!id && (!selected || !confirmed))) return
    setSaving(true)
    try {
      const r = await csrf(id ? `${endpoint}?id=${encodeURIComponent(id)}` : endpoint, {
        method: id ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json' },
        ...(id ? {} : { body: JSON.stringify({ target_id: selected, confirmed }) }),
      })
      if (!r.ok) throw new Error('save_failed')
      setSelected(''); setConfirmed(false); await load()
    } catch { toast.error(t('inbox.teamFailed')) }
    finally { setSaving(false) }
  }
  if (error) return <p role="alert" className="text-xs">{t('inbox.teamFailed')}</p>
  if (!data || (!data.candidates.length && !data.links.length)) return null
  const target = data.candidates.find(c => c.id === selected)
  return <details className="text-xs">
    <summary className="flex cursor-pointer items-center gap-1.5 font-medium"><Link2 className="size-3.5" />{t('inbox.relatedTitle')}</summary>
    <div className="mt-2 space-y-2">
      {data.links.map(link => <div key={link.id} className="flex items-center gap-2 rounded border p-2">
        <Link className="min-w-0 flex-1 truncate underline" href={`/bandeja?c=${encodeURIComponent(link.target.id)}`}>{channelLabel(link.target.channel, t)} · {link.target.last_message_text ?? t('inbox.relatedCase')}</Link>
        <Button size="icon-sm" variant="ghost" disabled={saving} aria-label={t('inbox.relatedUnlink')} onClick={() => void change(link.id)}><Link2Off className="size-3.5" /></Button>
      </div>)}
      <select className="w-full rounded border bg-background p-1.5" value={selected} disabled={saving} aria-label={t('inbox.relatedChoose')}
        onChange={e => { setSelected(e.target.value); setConfirmed(false) }}>
        <option value="">{t('inbox.relatedChoose')}</option>
        {data.candidates.filter(c => !data.links.some(l => l.target.id === c.id)).map(c => <option key={c.id} value={c.id}>{channelLabel(c.channel, t)} · {c.last_message_text?.slice(0, 70)}</option>)}
      </select>
      {target && <div className="space-y-2 rounded border p-2">
        <p>{channelLabel(target.channel, t)}{target.last_message_at ? ` · ${fmt.dateTime(target.last_message_at)}` : ''}</p>
        <p className="whitespace-pre-wrap">{target.last_message_text}</p>
        <Link className="inline-block underline" href={`/bandeja?c=${encodeURIComponent(target.id)}`}>{t('inbox.relatedPreview')}</Link>
        <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={saving} onChange={e => setConfirmed(e.target.checked)} />{t('inbox.relatedConfirm')}</label>
        <Button size="sm" disabled={saving || !confirmed} onClick={() => void change()}>{saving ? <Loader2 className="size-3 animate-spin" /> : <Link2 className="size-3" />}{t('inbox.relatedLink')}</Button>
      </div>}
    </div>
  </details>
}
