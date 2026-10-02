'use client';
import {useEffect,useRef,useState} from 'react';
import {Loader2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {useT} from '@/hooks/use-locale';
import {useFetchWithCsrf} from '@/lib/api/fetch-with-csrf';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {storeReviewSettings,storeReviewSettingsInput} from '@/lib/integrations/expansion/review-ui-contract';
import type {z} from 'zod';
type State=z.infer<typeof storeReviewSettings>;
export function ReviewSettings({workspaceId}:{workspaceId:string}){
 const t=useT(),fetch=useFetchWithCsrf(),version=useRef(0),inFlight=useRef(false);
 const [data,setData]=useState<State|null>(null),[shopId,setShopId]=useState(''),[key,setKey]=useState(''),[enabled,setEnabled]=useState(false),[dailyReplies,setDailyReplies]=useState(50),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 useEffect(()=>{const lifecycle=version;lifecycle.current++;inFlight.current=false;setData(null);setShopId('');setKey('');setEnabled(false);setDailyReplies(50);setBusy(false);setError('');setSaved(false);return()=>{lifecycle.current++;};},[workspaceId]);
 if(!SHOW_RIVERZ_IMPROVEMENTS)return null;
 function code(value:unknown){return typeof value==='string'&&['invalid','notAllowed','uncertain'].includes(value)?value:'unavailable';}
 async function load(){
  if(inFlight.current||!workspaceId)return;const generation=version.current;inFlight.current=true;setBusy(true);setError('');
  try{const response=await fetch('/api/integrations/reviews?view=settings',{cache:'no-store',headers:{'x-workspace-id':workspaceId}}),raw=await response.json();if(!response.ok)throw new Error(code(raw.code));const parsed=storeReviewSettings.safeParse(raw);if(!parsed.success)throw new Error('unavailable');if(version.current===generation){const value=parsed.data;setData(value);setShopId(value.configured?value.shopifyConnectionId:value.stores[0]?.id??'');setEnabled(value.enabled);setDailyReplies(value.configured?value.dailyReplies:50);setKey('');}}
  catch(cause){if(version.current===generation)setError(code(cause instanceof Error?cause.message:null));}finally{if(version.current===generation){inFlight.current=false;setBusy(false);}}
 }
 async function save(){
  if(!data||inFlight.current)return;const generation=version.current;inFlight.current=true;setBusy(true);setError('');setSaved(false);
  try{const shop=data.configured?{id:data.shopifyConnectionId,shopDomain:data.shopDomain}:data.stores.find(value=>value.id===shopId),draft={shopifyConnectionId:shop?.id,shopDomain:shop?.shopDomain,...(key?{key}:{}),enabled,dailyReplies};
   if(!storeReviewSettingsInput.safeParse(draft).success||!data.configured&&!key)throw new Error('invalid');
   const response=await fetch('/api/integrations/reviews',{method:'POST',headers:{'Content-Type':'application/json','x-workspace-id':workspaceId},body:JSON.stringify({action:'settings',input:draft})}),raw=await response.json();if(!response.ok)throw new Error(code(raw.code));const parsed=storeReviewSettings.safeParse(raw);if(!parsed.success)throw new Error('unavailable');
   if(version.current===generation){setData(parsed.data);setEnabled(parsed.data.enabled);if(parsed.data.configured){setShopId(parsed.data.shopifyConnectionId);setDailyReplies(parsed.data.dailyReplies);}setKey('');setSaved(true);}
  }catch(cause){if(version.current===generation)setError(code(cause instanceof Error?cause.message:null));}finally{if(version.current===generation){inFlight.current=false;setBusy(false);}}
 }
 return <li className="min-w-0 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5"><details onToggle={event=>{if(event.currentTarget.open&&!data&&!inFlight.current)void load();}}><summary className="cursor-pointer text-sm font-semibold">{t('settings.reviewTitle')}</summary><div className="mt-3 space-y-3">
  {busy&&!data?<Loader2 className="size-4 animate-spin"/>:data?<fieldset disabled={busy} className="space-y-3 min-w-0">
   {!data.configured&&!data.stores.length?<p className="text-xs text-muted-foreground">{t('settings.reviewNoStores')}</p>:<>
    <label className="block space-y-1 text-xs">{t('settings.reviewShop')}{data.configured?<Input readOnly value={data.shopDomain}/>:<select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={shopId} onChange={event=>{setShopId(event.target.value);setSaved(false);}}>{data.stores.map(store=><option key={store.id} value={store.id}>{store.shopDomain}</option>)}</select>}</label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={event=>{setEnabled(event.target.checked);setSaved(false);}}/>{t('settings.reviewEnabled')}</label>
    <label className="block space-y-1 text-xs">{t('settings.reviewDailyLimit')}<Input type="number" min={1} max={1000} value={dailyReplies} onChange={event=>{setDailyReplies(Number(event.target.value));setSaved(false);}}/></label>
    <details open={!data.configured}><summary className="cursor-pointer text-xs font-medium">{t('settings.smsInstallation')}</summary><div className="mt-2 space-y-2">
     <label className="block space-y-1 text-xs">{t('settings.reviewKey')}<Input type="password" autoComplete="new-password" value={key} placeholder={data.configured?t('settings.reviewKeepKey'):''} onChange={event=>{setKey(event.target.value);setSaved(false);}}/></label>
     <p className="text-xs text-muted-foreground">{t('settings.reviewInstallNote')}</p>
    </div></details>
    <Button size="sm" onClick={save} disabled={busy}>{busy?<Loader2 className="size-4 animate-spin"/>:t('settings.reviewSave')}</Button>
   </>}
  </fieldset>:<Button variant="outline" size="sm" disabled={busy} onClick={load}>{t('settings.reviewLoad')}</Button>}
  {saved&&<p className="text-xs" role="status">{t('settings.reviewSaved')}</p>}
  {error&&<p className="text-xs text-destructive" role="alert">{t(`settings.reviewError_${code(error)}`)}</p>}
 </div></details></li>;
}
