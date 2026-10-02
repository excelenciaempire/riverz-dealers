'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT, useLocale } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf'
import type { CaseOrderOperation } from '@/lib/inbox/order-action-contract'
import { SHIPPING_COUNTRIES,shippingAddress, type OrderShippingAddress } from '@/lib/shopify/shipping-address-contract'
import type { ReviewedOrderItem,OrderItemDisplay } from '@/lib/shopify/order-items-contract'
import { CaseOrderItemsForm } from './case-order-items-form'
import type { ReplacementDraftState } from '@/lib/shopify/replacement-draft'
import type { HoldPreparation } from '@/lib/shopify/fulfillment-hold'
import type { StoreCreditReceipt,ObservedStoreCredit } from '@/lib/shopify/store-credit'
import Link from '@/components/i18n/locale-link'
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview'
import {returnRefundReceipt,returnRefundContext} from '@/lib/returns/refund-link-contract'
import { CustomerAddressRequests } from './customer-address-requests'

interface State { orders: { id:string; shopify_order_id:string }[]; history:CaseOrderOperation[]; locks:{ order_id:string; status:string }[]; actors:Record<string,string | null>; can_execute:boolean }
interface Review { source_id:string; action_type:CaseOrderOperation['action']['type'] | 'financial'; fingerprint:string; preview:CaseOrderOperation['preview'] }
const PAYMENT:Record<string,string>={ paid:'financialPaid',pending:'financialPending',refunded:'financialRefunded',partially_refunded:'financialPartiallyRefunded',voided:'financialVoided',authorized:'financialAuthorized' }
const SHIPMENT:Record<string,string>={ fulfilled:'fulfillmentFulfilled',partial:'fulfillmentPartial',restocked:'fulfillmentRestocked','':'fulfillmentUnfulfilled' }
const ACTION_LABEL = { refund:'orderRefund',cancel:'orderCancel',address:'orderAddress',items:'orderItems',replacement:'orderReplacement',hold:'orderHold',credit:'orderCredit' }
const ADDRESS_FIELDS = { address1:'orderAddress1',address2:'orderAddress2',city:'orderAddressCity',province:'orderAddressProvince',zip:'orderAddressZip' } as const
const EMPTY_ADDRESS:OrderShippingAddress = { address1:'',address2:'',city:'',province:'',zip:'',countryCode:'' }
export function CaseOrderActions({ conversationId,shopifyOrderId }: { conversationId:string; shopifyOrderId:string }) {
  const t = useT(), fmt = useFormat(), csrf = useFetchWithCsrf(), { locale } = useLocale()
  const [open,setOpen] = useState(false), [state,setState] = useState<State | null>(null)
  const [error,setError] = useState<string | null>(null), [busy,setBusy] = useState(false)
  const [action,setAction] = useState<'refund' | 'cancel' | 'address' | 'items' | 'replacement' | 'hold' | 'credit'>('refund'), [amount,setAmount] = useState(''), [reason,setReason] = useState('')
  const [items,setItems] = useState<ReviewedOrderItem[] | null>(null)
  const [address,setAddress] = useState<OrderShippingAddress>(EMPTY_ADDRESS), [addressReady,setAddressReady] = useState(false)
  const [addressRevision,setAddressRevision] = useState(0)
  const [preview,setPreview] = useState<CaseOrderOperation | null>(null), [confirmed,setConfirmed] = useState(false)
  const [review,setReview] = useState<Review | null>(null), [reviewReason,setReviewReason] = useState(''), [reviewConfirmed,setReviewConfirmed] = useState(false)
  const endpoint = `/api/conversations/${conversationId}/orders`
  const localOrderId = state?.orders.find(o => String(o.shopify_order_id) === shopifyOrderId)?.id
  const countries = useMemo(() => {
    const names = new Intl.DisplayNames([locale],{ type:'region' })
    return SHIPPING_COUNTRIES.map(code => ({ code,name:names.of(code) ?? code })).sort((a,b) => a.name.localeCompare(b.name,locale))
  },[locale])
  const load = useCallback(async (signal?:AbortSignal) => {
    const r = await fetch(`${endpoint}?shopify_order_id=${encodeURIComponent(shopifyOrderId)}`,{ cache:'no-store',signal })
    const data = await r.json()
    if (!r.ok) throw new Error(data.error ?? t('inbox.orderUnavailable'))
    if (!signal?.aborted) { setState(data); setError(null) }
    return data as State
  },[endpoint,shopifyOrderId,t])
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    void load(controller.signal).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  },[open,load])
  useEffect(() => {
    if (!open || action !== 'address' || !localOrderId) return
    const controller = new AbortController()
    void fetch(`${endpoint}/${localOrderId}/context`,{ cache:'no-store',signal:controller.signal }).then(async r => {
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? t('inbox.orderUnavailable'))
      if (!controller.signal.aborted) {
        setAddress(data.shipping_address ?? EMPTY_ADDRESS); setAddressReady(!!data.shipping_address && data.can_modify === true)
        if (!data.can_modify) setError(t('inbox.orderAlreadyShipped'))
        else if (!data.shipping_address) setError(t('inbox.orderAddressUnavailable'))
      }
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  },[open,action,localOrderId,endpoint,t,addressRevision])
  async function prepare() {
    const local = state?.orders.find(o => String(o.shopify_order_id) === shopifyOrderId)
    if (!local || busy) return
    setBusy(true); setError(null)
    try {
      const r = await csrf(endpoint,{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ id:crypto.randomUUID(),order_id:local.id,
        action:{ type:action,reason,...(action === 'credit' ? { amount:Number(amount) } : action === 'refund' ? { amount:amount.trim() ? Number(amount) : null } : action === 'address' ? { address } : ['items','replacement'].includes(action) ? { items } : {}) } }) })
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
      const r = await csrf(`${endpoint}/${preview.id}/execute`,{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ confirmed:true,action_type:preview.action.type }) })
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
      const r = await csrf(`${endpoint}/${local.id}/review`,{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ source_id:review.source_id,action_type:review.action_type,fingerprint:review.fingerprint,confirmed:true,reason:reviewReason }) })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? t('inbox.orderUnavailable'))
      setPreview(null); setReview(null); setConfirmed(false); await load()
    } catch (e) { setError(e instanceof Error ? e.message : t('inbox.orderUnavailable')) }
    finally { setBusy(false) }
  }
  function displayAmount(value:string | number,currency:string) { return fmt.currency(Number(value),currency,{ maximumFractionDigits:6 }) }
  function money(op:CaseOrderOperation) { return op.preview.amount === null ? t('inbox.orderNoRefund') : displayAmount(Number(op.preview.amount),op.preview.currency) }
  function returnReceipt(op:CaseOrderOperation){
    const marker=op.preview.return_receipt;
    if(!SHOW_RIVERZ_IMPROVEMENTS||!marker||marker.version!==1||!returnRefundContext.shape.case_id.safeParse(marker.case_id).success)return null;
    const parsed=returnRefundReceipt.safeParse({id:marker.receipt_id,reference:marker.reference,condition:marker.condition,quantity:marker.quantity,recorded_at:marker.recorded_at});
    if(!parsed.success)return null;const receipt=parsed.data;
    return <div className="space-y-1 border-l-2 pl-3"><p>{t('returns.refundReceipt',{reference:receipt.reference,quantity:fmt.number(receipt.quantity),condition:t(`returns.receipt_${receipt.condition}`)})}</p>
      <p className="text-muted-foreground">{t('returns.logisticsScope')}</p><Link className="underline" href={`/devoluciones#return-${marker.case_id}`}>{t('returns.history')}</Link></div>
  }
  function payment(value:string) { return PAYMENT[value] ? t(`inbox.${PAYMENT[value]}`) : value }
  function shipment(value:string | null) { return SHIPMENT[value ?? ''] ? t(`inbox.${SHIPMENT[value ?? '']}`) : value }
  function addressText(value:OrderShippingAddress | null) {
    return value ? [value.address1,value.address2,value.city,value.province,value.zip,countries.find(c => c.code === value.countryCode)?.name ?? value.countryCode].filter(Boolean).join(', ') : ''
  }
  function addressPreview(op:CaseOrderOperation) {
    const change = op.preview.shipping_change
    return change ? <div className="space-y-1 break-words">
      <p><span className="font-medium">{t('inbox.orderAddressBefore')}: </span>{addressText(change.before)}</p>
      <p><span className="font-medium">{t('inbox.orderAddressAfter')}: </span>{addressText(change.after)}</p>
      {change.validation === 'confirm' && <p>{t('inbox.orderAddressNeedsConfirmation')}</p>}
    </div> : null
  }
  function itemList(value:OrderItemDisplay[]) { return <ul className="space-y-1">{value.map((item,i) => <li key={i} className="break-words">{item.quantity} × {[item.title,item.variantTitle].filter(Boolean).join(' · ')}{item.free && <> · {t('inbox.orderItemsFree')}</>}</li>)}</ul> }
  function itemPreview(op:CaseOrderOperation) {
    const quote=op.preview.item_change
    return quote ? <div className="space-y-2">
      <p className="font-medium">{t('inbox.orderItemsBefore')}</p>{itemList(quote.before)}<p>{displayAmount(Number(quote.total_before),quote.currency)}</p>
      <p className="font-medium">{t('inbox.orderItemsAfter')}</p>{itemList(quote.after)}<p>{displayAmount(Number(quote.total_after),quote.currency)}</p>
      <p>{t('inbox.orderItemsDifference')}: {displayAmount(Number(quote.difference),quote.currency)}</p><p>{t('inbox.orderItemsSettlement')}</p>
    </div> : null
  }
  function actualItemTotal(op:CaseOrderOperation) {
    const total=op.result?.total as { amount?:unknown; currencyCode?:unknown } | undefined
    return typeof total?.amount === 'string' && typeof total.currencyCode === 'string' ? <p>{t('inbox.orderItemsActualTotal')}: {displayAmount(Number(total.amount),total.currencyCode)}</p> : null
  }
  function draftState(value:ReplacementDraftState) {
    return <div className="space-y-1"><p className="font-medium">{value.name} · {t(`inbox.orderDraftStatus.${value.status}`)}</p>{itemList(value.items)}<p>{displayAmount(value.total,value.currency)}</p>
      {value.shipping_address && <p>{addressText(value.shipping_address)}</p>}
      {value.invoice_sent_at && <p>{t('inbox.orderDraftInvoiceSent',{ date:fmt.dateTime(value.invoice_sent_at) })}</p>}
    </div>
  }
  function replacementPreview(op:CaseOrderOperation) {
    const quote=op.preview.replacement
    return quote ? <div className="space-y-2">{itemList(quote.items)}<p>{displayAmount(quote.total,quote.currency)}</p><p>{addressText(quote.shipping_address)}</p><p>{t('inbox.orderDraftExplanation')}</p></div> : null
  }
  function preparations(value:HoldPreparation[]) {
    return <div className="space-y-2">{value.map(item => <div key={item.id} className="space-y-1 rounded-md border p-2">
      <p className="font-medium">{item.location} · {t('inbox.orderHoldPreparation',{ id:item.id.split('/').pop()! })}</p><p>{t(`inbox.orderHoldStatus.${item.status}`)}</p>
      <ul>{item.items.map((line,i) => <li key={i}>{line.quantity} × {[line.title,line.variant_title].filter(Boolean).join(' · ')}</li>)}</ul>
      {!!item.holds.length && <p>{t('inbox.orderHoldExisting',{ count:String(item.holds.length) })}</p>}
    </div>)}</div>
  }
  function holdPreview(op:CaseOrderOperation) { return op.preview.hold ? <div className="space-y-2">{preparations(op.preview.hold.preparations)}<p>{t('inbox.orderHoldExplanation')}</p></div> : null }
  function creditPreview(op:CaseOrderOperation) {
    const quote=op.preview.credit
    return quote ? <div className="space-y-1"><p className="font-medium">{quote.customer_name}</p>
      <p>{t('inbox.orderCreditAmount')}: {displayAmount(quote.amount,quote.currency)}</p><p>{t('inbox.orderCreditBalance')}: {displayAmount(quote.balance,quote.currency)}</p>
      <p>{t('inbox.orderCreditEstimatedBalance')}: {displayAmount(quote.estimated_balance_after,quote.currency)}</p><p>{t('inbox.orderCreditExplanation')}</p></div> : null
  }
  function creditReceipt(value:StoreCreditReceipt) {
    return <div className="space-y-1"><p>{t('inbox.orderCreditIssued')}: {displayAmount(value.amount,value.currency)}</p>
      <p>{t('inbox.orderCreditBalanceAfter')}: {displayAmount(value.balance_after,value.currency)}</p><p>{fmt.dateTime(value.created_at)} · {value.id.split('/').pop()}</p>
      {value.expires_at && <p>{t('inbox.orderCreditExpiry',{ date:fmt.dateTime(value.expires_at) })}</p>}</div>
  }
  function creditObserved(value:ObservedStoreCredit) {
    return <div className="space-y-2"><p className="font-medium">{value.customer_name}</p><p>{t('inbox.orderCreditBalance')}: {displayAmount(value.balance,value.currency)}</p>
      {value.receipt ? creditReceipt(value.receipt) : <><p>{t('inbox.orderCreditUnknownReceipt')}</p><details><summary className="cursor-pointer">{t('inbox.orderCreditRecent')}</summary>
        <ul className="space-y-2">{value.recent_credits.map(item => <li key={item.id} className="rounded-md border p-2">{creditReceipt(item)}</li>)}</ul>
        {value.more_credits && <p>{t('inbox.orderCreditMore')}</p>}</details></>}</div>
  }
  return <details className="mt-2 border-t pt-2" onToggle={e => { setOpen(e.currentTarget.open); if (!e.currentTarget.open) setAddressReady(false) }}>
    <summary className="cursor-pointer text-xs font-medium">{t('inbox.orderActions')}</summary>
    {open && <div className="mt-2 space-y-2 text-xs">
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {!state && <Button variant="ghost" size="sm" onClick={() => void load().catch(e => setError(e.message))}>{t('inbox.actionRetry')}</Button>}
      {!!state?.locks.length && <p className="text-muted-foreground">{t('inbox.orderBusy')}</p>}
      {SHOW_RIVERZ_IMPROVEMENTS && localOrderId && <CustomerAddressRequests key={`${conversationId}-${localOrderId}`} conversationId={conversationId} orderId={localOrderId} onPrepared={async (operationId, requestId) => {
        const fresh = await load(), operation = fresh.history.find(value => value.id === operationId && value.order_id === localOrderId);
        if (!operation || operation.action.type !== 'address' || operation.preview.customer_request?.request_id !== requestId) throw new Error(t('inbox.orderUnavailable'));
        setPreview(operation); setConfirmed(false)
      }} />}
      {state?.can_execute && state.locks.some(lock => lock.status === 'uncertain') && !review && <Button size="sm" variant="outline" disabled={busy} onClick={() => void inspectResult()}>{t('inbox.orderReconcile')}</Button>}
      {review && <div className="space-y-2 rounded-md border p-2">
        <p className="font-medium">{review.preview.order_name}</p>
        <p>{payment(review.preview.financial_status)} · {shipment(review.preview.fulfillment_status)}</p>
        {review.preview.shipping_address ? <p>{t('inbox.orderAddressApplied')}: {addressText(review.preview.shipping_address)}</p> : !review.preview.item_current && !review.preview.draft_current && !review.preview.hold_current && !review.preview.credit_current && <p>{t('inbox.orderAvailableBalance')}: {review.preview.amount === null ? t('inbox.orderNoRefund') : displayAmount(Number(review.preview.amount),review.preview.currency)}</p>}
        {review.preview.item_current && <>{itemList(review.preview.item_current.items)}<p>{displayAmount(Number(review.preview.item_current.total),review.preview.item_current.currency)}</p></>}
        {review.preview.draft_current && draftState(review.preview.draft_current)}
        {review.preview.hold_current && preparations(review.preview.hold_current)}
        {review.preview.credit_current && creditObserved(review.preview.credit_current)}
        <label className="block">{t('inbox.orderReconcileReason')}<Input value={reviewReason} maxLength={300} onChange={e => setReviewReason(e.target.value)} className="mt-1 h-8 text-xs" /></label>
        <label className="flex items-start gap-2"><input type="checkbox" checked={reviewConfirmed} onChange={e => setReviewConfirmed(e.target.checked)} /><span>{t(review.preview.credit_current ? 'inbox.orderCreditReconcileConfirm' : review.preview.hold_current ? 'inbox.orderHoldReconcileConfirm' : review.preview.draft_current ? 'inbox.orderDraftReconcileConfirm' : review.preview.item_current ? 'inbox.orderItemsReconcileConfirm' : review.preview.shipping_address ? 'inbox.orderAddressReconcileConfirm' : 'inbox.orderReconcileConfirm')}</span></label>
        <Button size="sm" disabled={busy || !reviewConfirmed || !reviewReason.trim()} onClick={() => void reconcile()}>{t('inbox.orderReconcileSave')}</Button>
      </div>}
      {state && state.orders.length === 0 && <p className="text-muted-foreground">{t('inbox.orderNotFound')}</p>}
      {state && state.orders.length > 0 && !preview && <>
        <label className="block">{t('inbox.orderOperation')}<select className="mt-1 w-full rounded-md border bg-background p-2" value={action} onChange={e => { setAction(e.target.value as typeof action); setAddressReady(false); setItems(null); setError(null) }}>
          <option value="refund">{t('inbox.orderRefund')}</option><option value="cancel">{t('inbox.orderCancel')}</option>
          <option value="address">{t('inbox.orderAddress')}</option>
          <option value="items">{t('inbox.orderItems')}</option>
          <option value="replacement">{t('inbox.orderReplacement')}</option>
          <option value="hold">{t('inbox.orderHold')}</option>
          <option value="credit">{t('inbox.orderCredit')}</option>
        </select></label>
        {action === 'refund' && <label className="block">{t('inbox.orderAmount')}<Input type="number" min="0" step="any" value={amount} onChange={e => setAmount(e.target.value)} placeholder={t('inbox.orderFullBalance')} className="mt-1 h-8 text-xs" /></label>}
        {action === 'credit' && <label className="block">{t('inbox.orderCreditAmount')}<Input type="number" min="0" step="any" value={amount} onChange={e => setAmount(e.target.value)} className="mt-1 h-8 text-xs" /></label>}
        {action === 'address' && <fieldset className="space-y-2" disabled={!addressReady || busy}>
          {Object.entries(ADDRESS_FIELDS).map(([field,label]) => <label key={field} className="block">{t(`inbox.${label}`)}<Input value={address[field as keyof typeof ADDRESS_FIELDS]} maxLength={field === 'zip' ? 32 : 255} onChange={e => setAddress(previous => ({ ...previous,[field]:e.target.value }))} className="mt-1 h-8 text-xs" /></label>)}
          <label className="block">{t('inbox.orderAddressCountry')}<select className="mt-1 w-full rounded-md border bg-background p-2" value={address.countryCode} onChange={e => setAddress(previous => ({ ...previous,countryCode:e.target.value }))}>
            <option value="" disabled>{t('inbox.orderAddressCountry')}</option>{countries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select></label>
        </fieldset>}
        {action === 'address' && !addressReady && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAddressRevision(previous => previous+1)}>{t('inbox.actionRetry')}</Button>}
        {['items','replacement'].includes(action) && localOrderId && <CaseOrderItemsForm key={`${localOrderId}-${action}`} endpoint={`${endpoint}/${localOrderId}/items${action === 'replacement' ? '?mode=replacement' : ''}`} onChange={setItems} />}
        <label className="block">{t('inbox.orderReason')}<Input maxLength={300} value={reason} onChange={e => setReason(e.target.value)} className="mt-1 h-8 text-xs" /></label>
        <Button size="sm" variant="outline" disabled={busy || state.locks.length > 0 || !reason.trim() || (action === 'credit' && (!amount.trim() || !(Number(amount)>0))) || (action === 'refund' && !!amount.trim() && !(Number(amount)>0)) || (action === 'address' && (!addressReady || !address.address1.trim() || !address.city.trim() || !address.countryCode)) || (['items','replacement'].includes(action) && !items)} onClick={() => void prepare()}>{t('inbox.orderPreview')}</Button>
      </>}
      {preview && <div className="space-y-2 rounded-md bg-muted/40 p-2">
        <p className="font-medium">{preview.preview.order_name} · {t(`inbox.${ACTION_LABEL[preview.action.type]}`)}</p>
        <p>{payment(preview.preview.financial_status)} · {shipment(preview.preview.fulfillment_status)}</p>
        {preview.action.type === 'credit' ? creditPreview(preview) : preview.action.type === 'hold' ? holdPreview(preview) : preview.action.type === 'replacement' ? replacementPreview(preview) : preview.action.type === 'address' ? addressPreview(preview) : preview.action.type === 'items' ? itemPreview(preview) : <p>{money(preview)}</p>}<p className="break-words">{preview.preview.customer_request && preview.action.reason === 'webchat_address_request' ? t('webchat.addressRequestTitle') : preview.action.reason}</p>
        {returnReceipt(preview)}
        <p className="text-muted-foreground">{t(`inbox.orderStatus.${preview.status}`)}</p>
        {typeof preview.result?.error === 'string' && <p role="alert">{t(`inbox.${preview.result.error}`)}</p>}
        {preview.status === 'preview' && <>
          <p className="text-muted-foreground">{t('inbox.orderPreviewExpires',{ date:fmt.dateTime(preview.expires_at) })}</p>
          {state?.can_execute ? <>
            <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>{t(preview.action.type === 'credit' ? 'inbox.orderCreditConfirm' : preview.action.type === 'hold' ? 'inbox.orderHoldConfirm' : preview.action.type === 'replacement' ? 'inbox.orderDraftConfirm' : preview.action.type === 'items' ? 'inbox.orderItemsConfirm' : preview.action.type === 'address' ? 'inbox.orderAddressConfirm' : 'inbox.orderConfirm')}</span></label>
            <Button size="sm" disabled={!confirmed || busy} onClick={() => void execute()}>{t('inbox.orderExecute')}</Button>
          </> : <p>{t('inbox.orderApprovalForbidden')}</p>}
        </>}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setPreview(null); setConfirmed(false) }}>{t('inbox.orderNewPreview')}</Button>
      </div>}
      {state && state.history.filter(op => state.orders.some(o => o.id === op.order_id)).length > 0 && <details>
        <summary className="cursor-pointer text-muted-foreground">{t('inbox.orderHistory')}</summary>
        <ul className="mt-2 space-y-2">{state.history.filter(op => state.orders.some(o => o.id === op.order_id)).map(op => <li key={op.id} className="rounded-md border p-2">
          <p>{t(`inbox.${ACTION_LABEL[op.action.type]}`)}{['refund','cancel'].includes(op.action.type) && <> · {money(op)}</>}</p>
          {returnReceipt(op)}
          {op.action.type === 'address' && addressPreview(op)}
          {op.action.type === 'items' && itemPreview(op)}
          {op.action.type === 'items' && op.status === 'completed' && actualItemTotal(op)}
          {op.action.type === 'replacement' && replacementPreview(op)}
          {op.action.type === 'replacement' && !!op.result?.draft && draftState(op.result!.draft as ReplacementDraftState)}
          {op.action.type === 'hold' && holdPreview(op)}
          {op.action.type === 'hold' && Array.isArray(op.result?.preparations) && preparations(op.result!.preparations as HoldPreparation[])}
          {op.action.type === 'credit' && creditPreview(op)}
          {op.action.type === 'credit' && !!op.result?.credit_receipt && creditReceipt(op.result!.credit_receipt as StoreCreditReceipt)}
          {op.status === 'completed' && shippingAddress(op.result?.shipping_after) && <p>{t('inbox.orderAddressApplied')}: {addressText(shippingAddress(op.result?.shipping_after))}</p>}
          <p>{t(`inbox.orderStatus.${op.status}`)}</p><p className="text-muted-foreground">{fmt.dateTime(op.created_at)}</p>
          {typeof op.result?.refunded_amount === 'string' && <p>{t('inbox.orderActualRefund')}: {displayAmount(Number(op.result.refunded_amount),typeof op.result.currency === 'string' ? op.result.currency : op.preview.currency)}</p>}
          <p className="text-muted-foreground">{t('inbox.orderRequestedBy',{ actor:state.actors[op.requested_by] || op.requested_by.slice(0,8) })}</p>
          {op.approved_by && <p className="text-muted-foreground">{t('inbox.orderApprovedBy',{ actor:state.actors[op.approved_by] || op.approved_by.slice(0,8) })}</p>}
          {op.status === 'preview' && <Button size="sm" variant="ghost" onClick={() => { setPreview(op); setConfirmed(false) }}>{t('inbox.orderReview')}</Button>}
        </li>)}</ul>
      </details>}
    </div>}
  </details>
}
