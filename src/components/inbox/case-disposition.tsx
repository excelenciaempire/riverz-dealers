'use client'
import { useEffect,useRef,useState } from 'react'
import { useLocale } from '@/hooks/use-locale'
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf'
import type { Conversation } from '@/types'
import type { DispositionAction } from '@/lib/inbox/disposition'
type State={ manual_unread:boolean;is_spam:boolean;version:number }
export function CaseDisposition({ conversation }: { conversation:Conversation }) {
  const { t }=useLocale(),fetcher=useFetchWithCsrf()
  const [local,setLocal]=useState<State | null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const controller=useRef<AbortController | null>(null)
  const retry=useRef<{ id:string;action:DispositionAction;expected_version:number } | null>(null)
  useEffect(() => () => controller.current?.abort(),[])
  const remote:State={ manual_unread:conversation.manual_unread===true,is_spam:conversation.is_spam===true,version:conversation.inbox_control_version ?? 0 }
  const state=local && local.version>=remote.version ? local : remote
  async function change(action:DispositionAction) {
    if (controller.current) return
    const c=new AbortController();controller.current=c;setBusy(true);setError('')
    const input=retry.current?.action===action && retry.current.expected_version===state.version ? retry.current : { id:crypto.randomUUID(),action,expected_version:state.version }
    retry.current=input
    try {
      const r=await fetcher(`/api/conversations/${conversation.id}/${action==='read' ? 'read' : 'disposition'}`,{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify(input),signal:c.signal })
      const data=await r.json()
      if (!r.ok) {
        if (r.status===409) {
          retry.current=null
          const current=await fetch(`/api/conversations/${conversation.id}/disposition`,{ signal:c.signal })
          if (current.ok && !c.signal.aborted) setLocal(await current.json())
        }
        throw new Error(data.error || t('inbox.teamFailed'))
      }
      if (!c.signal.aborted) { setLocal(data);retry.current=null }
    } catch(e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : t('inbox.teamFailed')) }
    finally { if (!c.signal.aborted) setBusy(false);if (controller.current===c) controller.current=null }
  }
  const button='rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50'
  return <div className="space-y-2 border-t pt-2">
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} className={button} onClick={() => void change(state.manual_unread ? 'read' : 'unread')}>{t(state.manual_unread ? 'inbox.markRead' : 'inbox.markUnread')}</button>
      <button type="button" disabled={busy} className={button} onClick={() => void change(state.is_spam ? 'restore' : 'spam')}>{t(state.is_spam ? 'inbox.restoreSpam' : 'inbox.markSpam')}</button>
    </div>
    {state.is_spam && <p role="status">{t('inbox.spamPaused')}</p>}
    {state.manual_unread && <p role="status">{t('inbox.manualUnreadSet')}</p>}
    {error && <p role="alert">{error}</p>}
  </div>
}
