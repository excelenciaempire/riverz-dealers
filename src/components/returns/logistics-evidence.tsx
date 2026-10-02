'use client';
import {useEffect,useRef,useState} from 'react';
import {useT} from '@/hooks/use-locale';
import {useFormat} from '@/hooks/use-format';
import {useFetchWithCsrf} from '@/lib/api/fetch-with-csrf';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {returnLogisticsPage,returnLogisticsInput,type ReturnLogisticsPage} from '@/lib/returns/logistics-contract';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {toast} from 'sonner';

export function ReturnLogisticsEvidence({caseId,onChanged}:{caseId:string;onChanged:()=>void}){
 const t=useT(),format=useFormat(),fetchWithCsrf=useFetchWithCsrf();
 const [page,setPage]=useState<ReturnLogisticsPage|null>(null),[loading,setLoading]=useState(false),[failed,setFailed]=useState(false),[saving,setSaving]=useState(false);
 const [kind,setKind]=useState<'guide'|'receipt'>('guide'),[carrier,setCarrier]=useState(''),[tracking,setTracking]=useState(''),[reference,setReference]=useState(''),[quantity,setQuantity]=useState('1');
 const [condition,setCondition]=useState<'accepted'|'damaged'|'incomplete'>('accepted'),[note,setNote]=useState('');
 const request=useRef<AbortController|null>(null),pending=useRef<{signature:string;id:string;received_at:string}|null>(null);
 useEffect(()=>()=>request.current?.abort(),[]);
 async function load(cursor?:string){
  request.current?.abort();const controller=new AbortController();request.current=controller;setLoading(true);setFailed(false);
  try{
   const response=await fetch(`/api/devoluciones/${encodeURIComponent(caseId)}/logistica${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`,{cache:'no-store',signal:controller.signal});
   if(!response.ok)throw Error('unavailable');const value=returnLogisticsPage.parse(await response.json());if(value.case_id!==caseId)throw Error('unavailable');
   if(!controller.signal.aborted&&request.current===controller)setPage(previous=>cursor&&previous?{...value,events:[...new Map([...previous.events,...value.events].map(event=>[event.id,event])).values()]}:value);
  }catch{if(!controller.signal.aborted&&request.current===controller)setFailed(true);}
  finally{if(!controller.signal.aborted&&request.current===controller)setLoading(false);}
 }
 async function save(){
  if(!page||saving)return;
  const signature=JSON.stringify({kind,carrier:carrier.trim(),tracking:tracking.trim(),reference:reference.trim(),quantity,condition,note:note.trim()});
  if(pending.current?.signature!==signature)pending.current={signature,id:crypto.randomUUID(),received_at:new Date().toISOString()};
  const operation=pending.current;
  const input=returnLogisticsInput.safeParse({id:operation.id,kind,expected_updated_at:page.updated_at,
   payload:kind==='guide'?{carrier,tracking_number:tracking}:{reference,quantity:Number(quantity),condition,note,received_at:operation.received_at}});
  if(!input.success){toast.error(t('returns.logisticsInvalid'));return;}
  setSaving(true);
  try{
   const response=await fetchWithCsrf(`/api/devoluciones/${encodeURIComponent(caseId)}/logistica`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input.data)});
   const result=await response.json();if(!response.ok){toast.error(typeof result.error==='string'?result.error:t('returns.logisticsFailed'));return;}
   if(result.event_id!==operation.id||typeof result.unchanged!=='boolean')throw Error('unconfirmed');
   pending.current=null;toast.success(t('returns.logisticsSaved'));onChanged();
  }catch{toast.error(t('returns.logisticsFailed'));}finally{setSaving(false);}
 }
 if(!SHOW_RIVERZ_IMPROVEMENTS)return null;
 return <details className="mt-3 border-t pt-3" onToggle={event=>{if(event.currentTarget.open)void load();else{request.current?.abort();setLoading(false);}}}>
  <summary className="cursor-pointer text-xs font-medium">{t('returns.logisticsTitle')}</summary>
  <div className="mt-3 space-y-3 text-xs">
   <p className="text-muted-foreground">{t('returns.logisticsScope')}</p>
   {failed&&<div role="alert"><p>{t('returns.logisticsFailed')}</p><Button size="sm" variant="outline" disabled={loading} onClick={()=>void load()}>{t('common.retry')}</Button></div>}
   {loading&&<p role="status">{t('common.loading')}</p>}
   {page&&!failed&&<>
    {page.events.map(event=><div key={event.id} className="space-y-1 border-l-2 pl-3">
     <p className="font-medium">{t(`returns.logistics_${event.kind}`)}</p><time dateTime={event.recorded_at}>{format.dateTime(event.recorded_at)}</time>
     {event.kind==='guide'?<p>{event.payload.carrier} · {event.payload.tracking_number}</p>:<>
      <p>{event.payload.reference} · {format.number(event.payload.quantity)} · {t(`returns.receipt_${event.payload.condition}`)}</p>
      <p>{t('returns.receivedAt',{date:format.dateTime(event.payload.received_at)})}</p>{event.payload.note&&<p className="whitespace-pre-wrap">{event.payload.note}</p>}
     </>}
    </div>)}
    {page.events.length===0&&<p>{t('returns.logisticsEmpty')}</p>}
    {page.next_cursor&&page.events.length<100&&<Button variant="outline" size="sm" disabled={loading} onClick={()=>void load(page.next_cursor??undefined)}>{t('returns.historyOlder')}</Button>}
    {!page.platform&&['aprobada','recibida'].includes(page.status)&&<fieldset disabled={saving||loading} className="space-y-3 border-t pt-3">
     <label className="block">{t('returns.logisticsRecord')}<select className="mt-1 block w-full rounded-md border bg-background p-2" value={kind} onChange={event=>setKind(event.target.value as typeof kind)}>
      <option value="guide">{t('returns.logistics_guide')}</option><option value="receipt">{t('returns.logistics_receipt')}</option></select></label>
     {kind==='guide'?<>
      <label className="block">{t('returns.carrier')}<Input value={carrier} maxLength={80} onChange={event=>setCarrier(event.target.value)}/></label>
      <label className="block">{t('returns.trackingNumber')}<Input value={tracking} maxLength={100} onChange={event=>setTracking(event.target.value)}/></label>
     </>:<>
      <label className="block">{t('returns.receiptReference')}<Input value={reference} maxLength={100} onChange={event=>setReference(event.target.value)}/></label>
      <label className="block">{t('returns.receiptQuantity')}<Input type="number" min={1} max={10000} step={1} value={quantity} onChange={event=>setQuantity(event.target.value)}/></label>
      <label className="block">{t('returns.receiptCondition')}<select className="mt-1 block w-full rounded-md border bg-background p-2" value={condition} onChange={event=>setCondition(event.target.value as typeof condition)}>
       {(['accepted','damaged','incomplete'] as const).map(value=><option key={value} value={value}>{t(`returns.receipt_${value}`)}</option>)}</select></label>
      <label className="block">{t('returns.receiptNote')}<Input value={note} maxLength={500} onChange={event=>setNote(event.target.value)}/></label>
      <p className="text-muted-foreground">{t('returns.receiptSaveScope')}</p>
     </>}
     <Button size="sm" onClick={()=>void save()}>{t('common.save')}</Button>
    </fieldset>}
   </>}
  </div>
 </details>;
}
