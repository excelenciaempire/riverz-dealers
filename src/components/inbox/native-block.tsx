'use client'
import { useEffect,useRef,useState } from 'react'
import { useLocale } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf'
import type { NativeBlockInput,NativeBlockOperation,NativeBlockView } from '@/lib/inbox/native-block-contract'
export function NativeBlockControl({ conversationId }: { conversationId:string }) {
  const { t }=useLocale(),fmt=useFormat(),fetcher=useFetchWithCsrf()
  const [state,setState]=useState<NativeBlockView | null>(null),[preview,setPreview]=useState<NativeBlockOperation | null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reason,setReason]=useState('')
  const controller=useRef<AbortController | null>(null),retry=useRef<NativeBlockInput | null>(null)
  useEffect(() => () => controller.current?.abort(),[])
  async function run(input?:NativeBlockInput) {
    if (controller.current) return
    const c=new AbortController();controller.current=c;setBusy(true);setError('')
    try {
      const r=await fetcher(`/api/conversations/${conversationId}/native-block`,{ method:input ? 'POST' : 'GET',...(input ? { headers:{ 'Content-Type':'application/json' },body:JSON.stringify(input) } : {}),signal:c.signal })
      const data=await r.json();if (!r.ok) throw new Error(data.error || t('inbox.nativeBlockUnavailable'))
      if (c.signal.aborted) return
      if (!input) setState(data)
      else {
        retry.current=null
        if (data.operation.status==='preview') setPreview(data.operation)
        else {
          setPreview(null)
          const op=data.operation as NativeBlockOperation
          setState(previous => previous ? { ...previous,operations:[op,...(previous.operations ?? []).filter(item => item.id!==op.id)],active_operation:op.status==='running' || op.status==='uncertain' ? op : null } : previous)
          const current=await fetch(`/api/conversations/${conversationId}/native-block`,{ signal:c.signal })
          if (!current.ok) throw new Error(t('inbox.nativeBlockRefreshFailed'))
          if (!c.signal.aborted) { setState(await current.json());setReason('') }
        }
      }
    } catch(e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : t('inbox.nativeBlockUnavailable')) }
    finally { if (!c.signal.aborted) setBusy(false);if (controller.current===c) controller.current=null }
  }
  function prepare() {
    if (!state?.available || typeof state.blocked!=='boolean') return
    const desired=!state.blocked
    const input=retry.current?.action==='prepare' && retry.current.blocked===desired ? retry.current : { action:'prepare' as const,id:crypto.randomUUID(),blocked:desired }
    retry.current=input;void run(input)
  }
  const button='rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50'
  const active=state?.active_operation
  const reviewable=active?.reviewable
  return <details className="border-t pt-2" onToggle={e => { if (e.currentTarget.open && !state) void run() }}>
    <summary className="cursor-pointer font-medium">{t('inbox.nativeBlockTitle')}</summary>
    <div className="mt-2 space-y-2">
      <button type="button" className={button} disabled={busy} onClick={() => { retry.current=null;setPreview(null);void run() }}>{t('inbox.nativeBlockRefresh')}</button>
      {state?.available ? <>
        <p>{state.contact_name} · +{state.recipient}</p>
        <p className="text-muted-foreground">{t('inbox.nativeBlockAccount',{ number:state.business_number ?? state.phone_number_id ?? '' })}</p>
        <p role="status">{t(state.blocked ? 'inbox.nativeBlockBlocked' : 'inbox.nativeBlockUnblocked')}</p>
        {!state.is_admin && <p>{t('inbox.nativeBlockAdmin')}</p>}
        {state.is_admin && !active && !preview && <button type="button" className={button} disabled={busy || !!error} onClick={prepare}>{t(state.blocked ? 'inbox.nativeBlockPrepareUnblock' : 'inbox.nativeBlockPrepareBlock')}</button>}
        {preview && <div className="space-y-2 rounded border p-2">
          <p>{t(preview.desired_blocked ? 'inbox.nativeBlockConfirmBlock' : 'inbox.nativeBlockConfirmUnblock',{ recipient:`+${preview.preview.recipient}` })}</p>
          <p className="text-muted-foreground">{t('inbox.nativeBlockAccount',{ number:preview.preview.business_number ?? preview.preview.phone_number_id })}</p>
          <button type="button" className={button} disabled={busy} onClick={() => void run({ action:'execute',id:preview.id })}>{t('inbox.nativeBlockConfirm')}</button>
          <button type="button" className={button} disabled={busy} onClick={() => setPreview(null)}>{t('inbox.nativeBlockCancel')}</button>
        </div>}
        {active && <div className="space-y-2 rounded border p-2">
          <p>{t(active.status==='running' && !reviewable ? 'inbox.nativeBlockRunning' : 'inbox.nativeBlockUncertain')}</p>
          {reviewable && state.is_admin && <>
            <p>{t('inbox.nativeBlockReviewHelp')}</p>
            <textarea value={reason} maxLength={500} onChange={e => setReason(e.target.value)} aria-label={t('inbox.nativeBlockReviewReason')} placeholder={t('inbox.nativeBlockReviewReason')} className="w-full rounded border p-2" />
            <button type="button" className={button} disabled={busy || reason.trim().length<8} onClick={() => void run({ action:'review',id:active.id,reason })}>{t('inbox.nativeBlockReview')}</button>
          </>}
        </div>}
        {!!state.operations?.length && <details><summary className="cursor-pointer">{t('inbox.nativeBlockHistory')}</summary>
          <div className="mt-2 space-y-2">{state.operations.filter(op => op.status!=='preview').map(op => <div key={op.id} className="border-t pt-2"><p>{t(op.desired_blocked ? 'inbox.nativeBlockPrepareBlock' : 'inbox.nativeBlockPrepareUnblock')} · {t(`inbox.nativeBlockState_${op.status}`)}</p><p className="text-muted-foreground">{fmt.dateTime(op.created_at)}</p>{typeof op.result?.provider_code==='number' && <p>{t('inbox.nativeBlockProviderCode',{ code:String(op.result.provider_code) })}</p>}{typeof op.review?.reason==='string' && <p>{op.review.reason}</p>}</div>)}</div>
        </details>}
      </> : state?.error && <p role="status">{state.error}</p>}
      {busy && <p role="status">{t('inbox.understandingWorking')}</p>}{error && <p role="alert">{error}</p>}
    </div>
  </details>
}
