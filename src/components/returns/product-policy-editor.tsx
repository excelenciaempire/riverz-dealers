'use client';
import {useEffect,useRef,useState} from 'react';
import {z} from 'zod';
import {useT} from '@/hooks/use-locale';
import {useFormat} from '@/hooks/use-format';
import {useFetchWithCsrf} from '@/lib/api/fetch-with-csrf';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {productPolicySnapshot,productPolicyWrite,type ProductPolicySnapshot,type ProductReturnPolicy} from '@/lib/returns/product-policy-contract';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
const initial:ProductReturnPolicy={mode:'review',window_days:null,starts_at:'delivery',remedies:[],conditions:''};
const remedies=['refund','replacement','exchange','store_credit'] as const;
const responseSchema=z.object({snapshot:productPolicySnapshot,can_edit:z.boolean()}).strict();

export function ProductReturnPolicyEditor({productId}:{productId:string}){
 const t=useT(),format=useFormat(),csrf=useFetchWithCsrf(),request=useRef<AbortController|null>(null),pending=useRef<{signature:string;id:string}|null>(null);
 const [snapshot,setSnapshot]=useState<ProductPolicySnapshot|null>(null),[canEdit,setCanEdit]=useState(false),[policy,setPolicy]=useState<ProductReturnPolicy>(initial);
 const [days,setDays]=useState(''),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[saved,setSaved]=useState(false);
 useEffect(()=>()=>request.current?.abort(),[]);
 async function load(){
  request.current?.abort();const controller=new AbortController();request.current=controller;setLoading(true);setError(null);setSnapshot(null);setCanEdit(false);
  try{
   const response=await fetch(`/api/products/${encodeURIComponent(productId)}/return-policy`,{cache:'no-store',signal:controller.signal}),data=await response.json();
   if(!response.ok){if(!controller.signal.aborted&&request.current===controller)setError(typeof data.error==='string'?data.error:t('products.returnPolicyUnavailable'));return;}
   const parsed=responseSchema.parse(data);if(parsed.snapshot.product_id!==productId)throw Error('unconfirmed');
   if(!controller.signal.aborted&&request.current===controller){setSnapshot(parsed.snapshot);setCanEdit(parsed.can_edit);setPolicy(parsed.snapshot.policy??initial);setDays(parsed.snapshot.policy?.window_days?.toString()??'');}
  }catch{if(!controller.signal.aborted&&request.current===controller)setError(t('products.returnPolicyUnavailable'));}
  finally{if(!controller.signal.aborted&&request.current===controller)setLoading(false);}
 }
 async function save(withdraw=false){
  if(!snapshot||!canEdit||busy)return;const next=withdraw?null:{...policy,window_days:days.trim()?Number(days):null};
  const raw={expected_revision:snapshot.revision,policy:next},signature=JSON.stringify(raw);if(pending.current?.signature!==signature)pending.current={signature,id:crypto.randomUUID()};
  const parsed=productPolicyWrite.safeParse({...raw,id:pending.current.id});if(!parsed.success){setError(t('products.returnPolicyInvalid'));return;}
  setBusy(true);setSaved(false);setError(null);
  try{
   const response=await csrf(`/api/products/${encodeURIComponent(productId)}/return-policy`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(parsed.data)}),data=await response.json();
   if(!response.ok){setError(typeof data.error==='string'?data.error:t('products.returnPolicyUnavailable'));return;}
   const output=productPolicySnapshot.parse(data);if(output.product_id!==productId||output.revision!==snapshot.revision+1||JSON.stringify(output.policy)!==JSON.stringify(parsed.data.policy))throw Error('unconfirmed');
   pending.current=null;setSaved(true);await load();
  }catch{setError(t('products.returnPolicyUnavailable'));}finally{setBusy(false);}
 }
 if(!SHOW_RIVERZ_IMPROVEMENTS)return null;
 return <details className="my-4 rounded-xl border border-border bg-card/40" onToggle={event=>{if(event.currentTarget.open)void load();else{request.current?.abort();setLoading(false);setSaved(false);}}}>
  <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{t('products.returnPolicyTitle')}</summary>
  <div className="space-y-3 border-t p-4 text-xs">
   <p className="text-muted-foreground">{t('products.returnPolicyScope')}</p>
   {loading&&<p role="status">{t('common.loading')}</p>}
   {saved&&<p role="status">{t('products.returnPolicySaved')}</p>}
   {error&&<div role="alert"><p>{error}</p><Button size="sm" variant="outline" disabled={busy} onClick={()=>void load()}>{t('common.retry')}</Button></div>}
   {snapshot&&<>
    <p>{snapshot.policy?t('products.returnPolicyVersion',{version:snapshot.revision}):t('products.returnPolicyGeneral')}</p>
    {snapshot.changed_at&&<time dateTime={snapshot.changed_at}>{format.dateTime(snapshot.changed_at)}</time>}
    {!canEdit&&<p className="text-muted-foreground">{t('products.returnPolicyAdmin')}</p>}
    <fieldset disabled={!canEdit||busy||loading} className="space-y-3">
     <label className="block">{t('products.returnPolicyMode')}<select className="mt-1 w-full rounded-md border bg-background p-2" value={policy.mode} onChange={event=>{const mode=event.target.value as ProductReturnPolicy['mode'];setPolicy({...policy,mode,...(mode==='not_offered'?{remedies:[]}: {})});}}>
      {(['allow','review','not_offered'] as const).map(mode=><option key={mode} value={mode}>{t(`products.returnPolicyMode_${mode}`)}</option>)}
     </select></label>
     <div className="grid gap-3 sm:grid-cols-2">
      <label>{t('products.returnPolicyDays')}<Input type="number" min={1} max={365} step={1} value={days} onChange={event=>setDays(event.target.value)} placeholder={t('products.returnPolicyUnspecified')}/></label>
      <label>{t('products.returnPolicyStarts')}<select className="mt-1 w-full rounded-md border bg-background p-2" value={policy.starts_at} onChange={event=>setPolicy({...policy,starts_at:event.target.value as ProductReturnPolicy['starts_at']})}>
       {(['purchase','delivery'] as const).map(start=><option key={start} value={start}>{t(`products.returnPolicyStarts_${start}`)}</option>)}
      </select></label>
     </div>
     <p className="text-muted-foreground">{t('products.returnPolicyWindowScope')}</p>
     <div className="space-y-2"><p>{t('products.returnPolicyRemedies')}</p>{remedies.map(remedy=><label className="mr-4 inline-flex items-center gap-2" key={remedy}>
      <input type="checkbox" disabled={policy.mode==='not_offered'} checked={policy.remedies.includes(remedy)} onChange={event=>setPolicy({...policy,remedies:event.target.checked?[...policy.remedies,remedy]:policy.remedies.filter(value=>value!==remedy)})}/>{t(`products.returnPolicyRemedy_${remedy}`)}
     </label>)}</div>
     <label className="block">{t('products.returnPolicyConditions')}<Textarea rows={3} maxLength={1200} value={policy.conditions} onChange={event=>setPolicy({...policy,conditions:event.target.value})}/></label>
     <div className="flex flex-wrap gap-2"><Button size="sm" onClick={()=>void save()}>{t('common.save')}</Button>{snapshot.policy&&<Button size="sm" variant="outline" onClick={()=>void save(true)}>{t('products.returnPolicyWithdraw')}</Button>}</div>
    </fieldset>
   </>}
  </div>
 </details>;
}
