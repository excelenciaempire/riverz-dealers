'use client';
import {useEffect,useRef,useState} from 'react';
import {Loader2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {useT} from '@/hooks/use-locale';
import {useFetchWithCsrf} from '@/lib/api/fetch-with-csrf';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {smsSettings,smsSettingsInput} from '@/lib/integrations/expansion/sms-ui-contract';
import type {z} from 'zod';
type State=z.infer<typeof smsSettings>;
const empty={phoneNumberId:'',phone:'',profileId:'',organizationId:''};
export function SmsSettings({workspaceId}:{workspaceId:string}){
 const t=useT(),fetch=useFetchWithCsrf(),version=useRef(0),inFlight=useRef(false);
 const [data,setData]=useState<State|null>(null),[identity,setIdentity]=useState(empty),[key,setKey]=useState(''),[publicKey,setPublicKey]=useState(''),[enabled,setEnabled]=useState(false),[maxSegments,setMaxSegments]=useState(3),[dailySegments,setDailySegments]=useState(100),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 useEffect(()=>{
  const lifecycle=version,generation=++lifecycle.current,controller=new AbortController();inFlight.current=false;setData(null);setKey('');setPublicKey('');setIdentity(empty);setEnabled(false);setLoading(true);setError('');setBusy(false);setSaved(false);
  if(!SHOW_RIVERZ_IMPROVEMENTS||!workspaceId)return;
  void(async()=>{try{const response=await fetch('/api/integrations/sms?view=settings',{cache:'no-store',headers:{'x-workspace-id':workspaceId},signal:controller.signal});const raw=await response.json();if(!response.ok)throw new Error(raw.code==='notAllowed'?'notAllowed':'unavailable');const value=smsSettings.safeParse(raw);if(!value.success)throw new Error('unavailable');if(lifecycle.current===generation){setData(value.data);if(value.data.configured){setIdentity({phoneNumberId:value.data.phoneNumberId,phone:value.data.phone,profileId:value.data.profileId,organizationId:value.data.organizationId});setEnabled(value.data.enabled);setMaxSegments(value.data.maxSegments);setDailySegments(value.data.dailySegments);}}}catch(cause){if(lifecycle.current===generation)setError(cause instanceof Error?cause.message:'unavailable');}finally{if(lifecycle.current===generation)setLoading(false);}})();
  return()=>{lifecycle.current++;controller.abort();};
 },[workspaceId,fetch]);
 if(!SHOW_RIVERZ_IMPROVEMENTS)return null;
 async function save(){
  if(!data||inFlight.current)return;const generation=version.current;inFlight.current=true;setBusy(true);setError('');setSaved(false);
  try{
   const draft={identity,...(key?{key}:{}),...(publicKey?{publicKey}:{}),enabled,maxSegments,dailySegments};if(!smsSettingsInput.safeParse(draft).success||!data.configured&&(!key||!publicKey))throw new Error('invalid');
   const response=await fetch('/api/integrations/sms',{method:'POST',headers:{'Content-Type':'application/json','x-workspace-id':workspaceId},body:JSON.stringify({action:'settings',input:draft})}),raw=await response.json();if(!response.ok)throw new Error(['invalid','notAllowed','uncertain'].includes(raw.code)?raw.code:'unavailable');const value=smsSettings.safeParse(raw);if(!value.success)throw new Error('unavailable');
   if(version.current===generation){setData(value.data);setEnabled(value.data.enabled);if(value.data.configured){setMaxSegments(value.data.maxSegments);setDailySegments(value.data.dailySegments);}setKey('');setPublicKey('');setSaved(true);}
  }catch(cause){if(version.current===generation)setError(cause instanceof Error&&['invalid','notAllowed','uncertain'].includes(cause.message)?cause.message:'unavailable');}finally{if(version.current===generation){inFlight.current=false;setBusy(false);}}
 }
 async function retryInbox(){
  if(!data?.configured||!data.enabled||inFlight.current)return;const generation=version.current;inFlight.current=true;setBusy(true);setError('');setSaved(false);
  try{const response=await fetch('/api/integrations/sms',{method:'POST',headers:{'Content-Type':'application/json','x-workspace-id':workspaceId},body:JSON.stringify({action:'retryInbox',connectionId:data.connectionId})}),raw=await response.json();if(!response.ok||!Number.isInteger(raw.queued)||raw.queued<0||raw.queued>20)throw new Error(raw.code==='notAllowed'?'notAllowed':'unavailable');
   const current=await fetch('/api/integrations/sms?view=settings',{cache:'no-store',headers:{'x-workspace-id':workspaceId}}),value=smsSettings.safeParse(await current.json());if(!current.ok||!value.success)throw new Error('unavailable');if(version.current===generation)setData(value.data);
  }catch(cause){if(version.current===generation)setError(cause instanceof Error&&cause.message==='notAllowed'?'notAllowed':'unavailable');}finally{if(version.current===generation){inFlight.current=false;setBusy(false);}}
 }
 return <li className="min-w-0 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5"><details><summary className="cursor-pointer text-sm font-semibold">{t('settings.smsTitle')}</summary><div className="mt-3 space-y-3">
  <p className="text-xs text-muted-foreground">{t('settings.smsProviderBilling')}</p>
  {loading?<Loader2 className="size-4 animate-spin"/>:data?<fieldset disabled={busy} className="space-y-3 min-w-0">
   {data.configured&&<p className="text-sm">{data.phone}</p>}
   <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={event=>{setEnabled(event.target.checked);setSaved(false);}}/>{t('settings.smsEnabled')}</label>
   <div className="grid gap-3 sm:grid-cols-2">
    <label className="space-y-1 text-xs">{t('settings.smsMaxSegments')}<Input type="number" min={1} max={10} value={maxSegments} onChange={event=>{setMaxSegments(Number(event.target.value));setSaved(false);}}/></label>
    <label className="space-y-1 text-xs">{t('settings.smsDailySegments')}<Input type="number" min={1} max={10000} value={dailySegments} onChange={event=>{setDailySegments(Number(event.target.value));setSaved(false);}}/></label>
   </div>
   <details open={!data.configured}><summary className="cursor-pointer text-xs font-medium">{t('settings.smsInstallation')}</summary><div className="mt-2 grid gap-3 sm:grid-cols-2">
    {(['phone','phoneNumberId','profileId','organizationId'] as const).map(name=><label key={name} className="min-w-0 space-y-1 text-xs">{t(`settings.smsField_${name}`)}<Input value={identity[name]} readOnly={data.configured} autoComplete="off" onChange={event=>{setIdentity({...identity,[name]:event.target.value});setSaved(false);}}/></label>)}
    <label className="min-w-0 space-y-1 text-xs">{t('settings.smsKey')}<Input type="password" autoComplete="new-password" value={key} placeholder={data.configured?t('settings.smsKeepKey'):''} onChange={event=>{setKey(event.target.value);setSaved(false);}}/></label>
    <label className="min-w-0 space-y-1 text-xs">{t('settings.smsSigningKey')}<Input autoComplete="off" value={publicKey} placeholder={data.configured?t('settings.smsKeepKey'):''} onChange={event=>{setPublicKey(event.target.value);setSaved(false);}}/></label>
    {data.configured&&<label className="min-w-0 space-y-1 text-xs sm:col-span-2">{t('settings.smsWebhook')}<Input readOnly value={`/api/integrations/sms/webhook/${data.connectionId}`}/></label>}
    <p className="text-xs text-muted-foreground sm:col-span-2">{t('settings.smsInstallationNote')}</p>
   </div></details>
   <Button size="sm" onClick={save} disabled={busy}>{busy?<Loader2 className="size-4 animate-spin"/>:t('settings.smsSave')}</Button>
   {data.configured&&!!data.inboundQueue?.pending&&<p className="text-xs text-muted-foreground">{t('settings.smsQueuePending',{count:data.inboundQueue.pending})}</p>}
   {data.configured&&!!data.inboundQueue?.failed&&<div className="space-y-2"><p className="text-xs text-destructive" role="status">{t('settings.smsQueueFailed',{count:data.inboundQueue.failed})}</p><Button size="sm" variant="outline" disabled={busy||!data.enabled} onClick={retryInbox}>{t('settings.smsRetryInbox')}</Button></div>}
  </fieldset>:null}
  {saved&&<p className="text-xs" role="status">{t('settings.smsSaved')}</p>}
  {error&&<p className="text-xs text-destructive" role="alert">{t(`settings.smsError_${['invalid','notAllowed','uncertain'].includes(error)?error:'unavailable'}`)}</p>}
 </div></details></li>;
}
