'use client'
import { useCallback,useEffect,useRef,useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT } from '@/hooks/use-locale'
import { orderItems,type OrderItemDisplay,type ReviewedOrderItem } from '@/lib/shopify/order-items-contract'
type Variant = Pick<OrderItemDisplay,'variantId' | 'title' | 'variantTitle'>
export function CaseOrderItemsForm({ endpoint,onChange }: { endpoint:string; onChange:(items:ReviewedOrderItem[] | null) => void }) {
  const t=useT(), [rows,setRows]=useState<OrderItemDisplay[]>([]), [variants,setVariants]=useState<Variant[]>([])
  const [search,setSearch]=useState(''), [busy,setBusy]=useState(false), [error,setError]=useState<string | null>(null)
  const searchRequest=useRef<AbortController | null>(null)
  const initial=useCallback(async (signal:AbortSignal) => {
    const r=await fetch(endpoint,{ cache:'no-store',signal }), data=await r.json()
    if (!r.ok) throw new Error(data.error ?? t('inbox.orderItemsUnavailable'))
    if (!signal.aborted) {
      setRows(data.current); setVariants(data.variants); onChange(orderItems(data.current.map(({ variantId,quantity,free }:OrderItemDisplay) => ({ variantId,quantity,free }))))
    }
  },[endpoint,t,onChange])
  useEffect(() => {
    const controller=new AbortController()
    void initial(controller.signal).catch(e => { if (!controller.signal.aborted) { setError(e.message); onChange(null) } })
    return () => { controller.abort(); searchRequest.current?.abort() }
  },[initial,onChange])
  function update(next:OrderItemDisplay[]) {
    setRows(next); onChange(orderItems(next.map(({ variantId,quantity,free }) => ({ variantId,quantity,free }))))
  }
  async function find() {
    if (busy) return
    setBusy(true); setError(null)
    const controller=new AbortController(); searchRequest.current=controller
    try {
      const r=await fetch(`${endpoint}${endpoint.includes('?') ? '&' : '?'}search=${encodeURIComponent(search)}`,{ cache:'no-store',signal:controller.signal }), data=await r.json()
      if (!r.ok) throw new Error(data.error ?? t('inbox.orderItemsUnavailable'))
      if (controller.signal.aborted) return
      setVariants(data.variants)
      if (!rows.length) { setRows(data.current); onChange(orderItems(data.current.map(({ variantId,quantity,free }:OrderItemDisplay) => ({ variantId,quantity,free })))) }
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : t('inbox.orderItemsUnavailable')) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  const options=[...new Map([...rows,...variants].map(v => [v.variantId,v])).values()]
  const title=(v:Variant) => [v.title,v.variantTitle].filter(Boolean).join(' · ')
  return <div className="space-y-2">
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <label className="block">{t('inbox.orderItemsSearch')}<Input value={search} maxLength={100} onChange={e => setSearch(e.target.value)} className="mt-1 h-8 text-xs" /></label>
    <Button size="sm" variant="outline" disabled={busy} onClick={() => void find()}>{t('inbox.orderItemsFind')}</Button>
    {rows.map((row,index) => <fieldset key={index} className="space-y-2 rounded-md border p-2" disabled={busy}>
      <label className="block">{t('inbox.orderItemsVariant')}<select className="mt-1 w-full rounded-md border bg-background p-2" value={row.variantId} onChange={e => {
        const variant=options.find(v => v.variantId===e.target.value)
        if (variant) update(rows.map((item,i) => i===index ? { ...item,...variant } : item))
      }}>{options.map(v => <option key={v.variantId} value={v.variantId}>{title(v)}</option>)}</select></label>
      <label className="block">{t('inbox.orderItemsQuantity')}<Input type="number" min="1" max="20" step="1" value={row.quantity} onChange={e => update(rows.map((item,i) => i===index ? { ...item,quantity:Number(e.target.value) } : item))} className="mt-1 h-8 text-xs" /></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={row.free} onChange={e => update(rows.map((item,i) => i===index ? { ...item,free:e.target.checked } : item))} />{t('inbox.orderItemsFree')}</label>
      <Button size="sm" variant="ghost" disabled={rows.length===1} onClick={() => update(rows.filter((_,i) => i!==index))}>{t('inbox.orderItemsRemove')}</Button>
    </fieldset>)}
    <Button size="sm" variant="outline" disabled={busy || !variants.length || rows.length>=20} onClick={() => update([...rows,{ ...variants[0],quantity:1,free:false }])}>{t('inbox.orderItemsAdd')}</Button>
  </div>
}
