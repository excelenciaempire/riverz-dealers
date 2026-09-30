'use client'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf'
import type { CaseOrderOperation } from '@/lib/inbox/order-action-contract'

interface State { orders: { id:string; shopify_order_id:string }[]; history:CaseOrderOperation[]; locks:{ order_id:string; status:string }[]; actors:Record<string,string | null>; can_execute:boolean }
interface Review { source_id:string; fingerprint:string; preview:CaseOrderOperation['preview'] }
const PAYMENT:Record<string,string>={ paid:'financialPaid',pending:'financialPending',refunded:'financialRefunded',partially_refunded:'financialPartiallyRefunded',voided:'financialVoided',authorized:'financialAuthorized' }
const SHIPMENT:Record<string,string>={ fulfilled:'fulfillmentFulfilled',partial:'fulfillmentPartial',restocked:'fulfillmentRestocked','':'fulfillmentUnfulfilled' }
export function CaseOrderActions({ conversationId,shopifyOrderId }: { conversationId:string; shopifyOrderId:string }) {
  const t = useT(), fmt = useFormat(), csrf = useFetchWithCsrf()
  const [open,setOpen] = useState(false), [state,setState] = useState<State | null>(null)
  const [error,setError] = useState<string | null>(null), [busy,setBusy] = useState(false)
  const [action,setAction] = useState<'refund' | 'cancel'>('refund'), [amount,setAmount] = useState(''), [reason,setReason] = useState('')
  const [preview,setPreview] = useState<CaseOrderOperation | null>(null), [confirmed,setConfirmed] = useState(false)
  const [review,setReview] = useState<Review | null>(null), [reviewReason,setReviewReason] = useState(''), [reviewConfirmed,setReviewConfirmed] = useState(false)
  const endpoint = `/api/conversations/${conversationId}/orders`
  const load = useCallback(async (signal?:AbortSignal) => {
    const r = await fetch(`${endpoint}?shopify_order_id=${encodeURIComponent(shopifyOrderId)}`,{ cache:'no-store',signal })
    const data = await r.json()
    if (!r.ok) throw new Error(data.error ?? t('inbox.orderUnavailable'))
    if (!signal?.aborted) { setState(data); setError(null) }
  },[endpoint,shopifyOrderId,t])
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    void load(controller.signal).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  },[open,load])
  async function prepare() {
    const local = state?.orders.find(o => String(o.shopify_order_id) === shopifyOrderId)
    if (!local || busy) return
    setBusy(true); setError(null)
    try {
      const r = await csrf(endpoint,{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ id:crypto.randomUUID(),order_id:local.id,
        action:{ type:action,reason,...(action === 'refund' ? { amount:amount.trim() ? Number(amount) : null } : {}) } }) })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? t('inbox.orderUnavailable'))
      setPreview(data.operation); setConfirmed(false)
    } catch (e) { setError(e instanceof Error ? e.message : t('inbox.orderUnavailable')) }
    finally { setBusy(false) }
  }
  async function execute() {
    if (!preview || !confirmed || busy) return
    setBusy(true); setError(null)
    try {
      const r = await csrf(`${endpoint}/${preview.id}/execute`,{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ confirmed:true }) })
      const data = await r.json()
      if (data.operation) { setPreview(data.operation); setConfirmed(false); await load() }
      else if (!r.ok) throw new Error(data.error ?? t('inbox.orderUnavailable'))
    } catch (e) { setError(e instanceof Error ? e.message : t('inbox.orderResultUnverified')) }
    finally { setBusy(false) }
  }
  async function inspectResult() {
    const local = state?.orders.find(o => String(o.shopify_order_id) === shopifyOrderId)
    if (!local || busy) return
    setBusy(true); setError(null)
    try {
      const r = await fetch(`${endpoint}/${local.id}/review`,{ cache:'no-store' }), data = await r.json()
      if (!r.ok) throw new Error(data.error ?? t('inbox.orderUnavailable'))
      setReview(data); setReviewConfirmed(false); setReviewReason('')
    } catch (e) { setError(e instanceof Error ? e.message : t('inbox.orderUnavailable')) }
    finally { setBusy(false) }
  }
  async function reconcile() {
    const local = state?.orders.find(o => String(o.shopify_order_id) === shopifyOrderId)
    if (!local || !review || !reviewConfirmed || busy) return
    setBusy(true); setError(null)
    try {
      const r = await csrf(`${endpoint}/${local.id}/review`,{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ source_id:review.source_id,fingerprint:review.fingerprint,confirmed:true,reason:reviewReason }) })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? t('inbox.orderUnavailable'))
      setPreview(null); setReview(null); setConfirmed(false); await load()
    } catch (e) { setError(e instanceof Error ? e.message : t('inbox.orderUnavailable')) }
    finally { setBusy(false) }
  }
  function money(op:CaseOrderOperation) { return op.preview.amount === null ? t('inbox.orderNoRefund') : fmt.currency(Number(op.preview.amount),op.preview.currency) }
  function payment(value:string) { return PAYMENT[value] ? t(`inbox.${PAYMENT[value]}`) : value }
  function shipment(value:string | null) { return SHIPMENT[value ?? ''] ? t(`inbox.${SHIPMENT[value ?? '']}`) : value }
  return <details className="mt-2 border-t pt-2" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary className="cursor-pointer text-xs font-medium">{t('inbox.orderActions')}</summary>
    {open && <div className="mt-2 space-y-2 text-xs">
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {!state && <Button variant="ghost" size="sm" onClick={() => void load().catch(e => setError(e.message))}>{t('inbox.actionRetry')}</Button>}
      {!!state?.locks.length && <p className="text-muted-foreground">{t('inbox.orderBusy')}</p>}
      {state?.can_execute && state.locks.some(lock => lock.status === 'uncertain') && !review && <Button size="sm" variant="outline" disabled={busy} onClick={() => void inspectResult()}>{t('inbox.orderReconcile')}</Button>}
      {review && <div className="space-y-2 rounded-md border p-2">
        <p className="font-medium">{review.preview.order_name}</p>
        <p>{payment(review.preview.financial_status)} · {shipment(review.preview.fulfillment_status)}</p>
        <p>{t('inbox.orderAvailableBalance')}: {review.preview.amount === null ? t('inbox.orderNoRefund') : fmt.currency(Number(review.preview.amount),review.preview.currency)}</p>
        <label className="block">{t('inbox.orderReconcileReason')}<Input value={reviewReason} maxLength={300} onChange={e => setReviewReason(e.target.value)} className="mt-1 h-8 text-xs" /></label>
        <label className="flex items-start gap-2"><input type="checkbox" checked={reviewConfirmed} onChange={e => setReviewConfirmed(e.target.checked)} /><span>{t('inbox.orderReconcileConfirm')}</span></label>
        <Button size="sm" disabled={busy || !reviewConfirmed || !reviewReason.trim()} onClick={() => void reconcile()}>{t('inbox.orderReconcileSave')}</Button>
      </div>}
      {state && state.orders.length === 0 && <p className="text-muted-foreground">{t('inbox.orderNotFound')}</p>}
      {state && state.orders.length > 0 && !preview && <>
        <label className="block">{t('inbox.orderOperation')}<select className="mt-1 w-full rounded-md border bg-background p-2" value={action} onChange={e => setAction(e.target.value as 'refund' | 'cancel')}>
          <option value="refund">{t('inbox.orderRefund')}</option><option value="cancel">{t('inbox.orderCancel')}</option>
        </select></label>
        {action === 'refund' && <label className="block">{t('inbox.orderAmount')}<Input type="number" min="0" step="any" value={amount} onChange={e => setAmount(e.target.value)} placeholder={t('inbox.orderFullBalance')} className="mt-1 h-8 text-xs" /></label>}
        <label className="block">{t('inbox.orderReason')}<Input maxLength={300} value={reason} onChange={e => setReason(e.target.value)} className="mt-1 h-8 text-xs" /></label>
        <Button size="sm" variant="outline" disabled={busy || state.locks.length > 0 || !reason.trim() || (action === 'refund' && !!amount.trim() && !(Number(amount)>0))} onClick={() => void prepare()}>{t('inbox.orderPreview')}</Button>
      </>}
      {preview && <div className="space-y-2 rounded-md bg-muted/40 p-2">
        <p className="font-medium">{preview.preview.order_name} · {t(preview.action.type === 'cancel' ? 'inbox.orderCancel' : 'inbox.orderRefund')}</p>
        <p>{payment(preview.preview.financial_status)} · {shipment(preview.preview.fulfillment_status)}</p>
        <p>{money(preview)}</p><p className="break-words">{preview.action.reason}</p>
        <p className="text-muted-foreground">{t(`inbox.orderStatus.${preview.status}`)}</p>
        {typeof preview.result?.error === 'string' && <p role="alert">{t(`inbox.${preview.result.error}`)}</p>}
        {preview.status === 'preview' && <>
          <p className="text-muted-foreground">{t('inbox.orderPreviewExpires',{ date:fmt.dateTime(preview.expires_at) })}</p>
          {state?.can_execute ? <>
            <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>{t('inbox.orderConfirm')}</span></label>
            <Button size="sm" disabled={!confirmed || busy} onClick={() => void execute()}>{t('inbox.orderExecute')}</Button>
          </> : <p>{t('inbox.orderApprovalForbidden')}</p>}
        </>}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setPreview(null); setConfirmed(false) }}>{t('inbox.orderNewPreview')}</Button>
      </div>}
      {state && state.history.filter(op => state.orders.some(o => o.id === op.order_id)).length > 0 && <details>
        <summary className="cursor-pointer text-muted-foreground">{t('inbox.orderHistory')}</summary>
        <ul className="mt-2 space-y-2">{state.history.filter(op => state.orders.some(o => o.id === op.order_id)).map(op => <li key={op.id} className="rounded-md border p-2">
          <p>{t(op.action.type === 'cancel' ? 'inbox.orderCancel' : 'inbox.orderRefund')} · {money(op)}</p>
          <p>{t(`inbox.orderStatus.${op.status}`)}</p><p className="text-muted-foreground">{fmt.dateTime(op.created_at)}</p>
          {typeof op.result?.refunded_amount === 'string' && <p>{t('inbox.orderActualRefund')}: {fmt.currency(Number(op.result.refunded_amount),typeof op.result.currency === 'string' ? op.result.currency : op.preview.currency)}</p>}
          <p className="text-muted-foreground">{t('inbox.orderRequestedBy',{ actor:state.actors[op.requested_by] || op.requested_by.slice(0,8) })}</p>
          {op.approved_by && <p className="text-muted-foreground">{t('inbox.orderApprovedBy',{ actor:state.actors[op.approved_by] || op.approved_by.slice(0,8) })}</p>}
          {op.status === 'preview' && <Button size="sm" variant="ghost" onClick={() => { setPreview(op); setConfirmed(false) }}>{t('inbox.orderReview')}</Button>}
        </li>)}</ul>
      </details>}
    </div>}
  </details>
}
