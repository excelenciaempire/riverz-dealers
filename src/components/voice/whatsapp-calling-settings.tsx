'use client';
import {useEffect,useRef,useState} from 'react';
import {Loader2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {useT} from '@/hooks/use-locale';
import {useFetchWithCsrf} from '@/lib/api/fetch-with-csrf';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {whatsappCallingSettingsInput} from '@/lib/voice/whatsapp-calling-contract';
type Settings={inboundEnabled:boolean;outboundEnabled:boolean;apiVersion:'23.0'|'24.0'|'25.0'|'26.0';ratesConfigured:{inbound:boolean;outbound:boolean}};
export function WhatsAppCallingSettings({workspaceId}:{workspaceId?:string}){
 const t=useT(),fetch=useFetchWithCsrf(),version=useRef(0);
 const [settings,setSettings]=useState<Settings|null>(null),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 useEffect(()=>{
  const lifecycle=version,generation=++lifecycle.current;setSettings(null);setError('');setLoading(true);setSaved(false);setSaving(false);
  if(!SHOW_RIVERZ_IMPROVEMENTS||!workspaceId)return;
  const controller=new AbortController();
  void(async()=>{try{
   const response=await fetch('/api/voice/whatsapp',{cache:'no-store',headers:{'x-workspace-id':workspaceId},signal:controller.signal});
   const data=await response.json();if(!response.ok||!whatsappCallingSettingsInput.safeParse({inboundEnabled:data.inboundEnabled,outboundEnabled:data.outboundEnabled,apiVersion:data.apiVersion}).success||typeof data.ratesConfigured?.inbound!=='boolean'||typeof data.ratesConfigured?.outbound!=='boolean')throw new Error('unavailable');
   if(lifecycle.current===generation)setSettings(data);
  }catch{if(lifecycle.current===generation)setError('unavailable');}finally{if(lifecycle.current===generation)setLoading(false);}})();
  return()=>{lifecycle.current++;controller.abort();};
 },[workspaceId,fetch]);
 if(!SHOW_RIVERZ_IMPROVEMENTS)return null;
 async function save(){
  if(!workspaceId||!settings||saving)return;const generation=version.current;setSaving(true);setError('');setSaved(false);
  try{
   const response=await fetch('/api/voice/whatsapp',{method:'POST',headers:{'Content-Type':'application/json','x-workspace-id':workspaceId},body:JSON.stringify({action:'settings',input:{inboundEnabled:settings.inboundEnabled,outboundEnabled:settings.outboundEnabled,apiVersion:settings.apiVersion}})});
   const data=await response.json();if(!response.ok)throw new Error(['notAllowed','unavailable'].includes(data.code)?data.code:'unavailable');
   if(version.current===generation)setSaved(true);
  }catch(cause){if(version.current===generation)setError(cause instanceof Error&&['notAllowed','unavailable'].includes(cause.message)?cause.message:'unavailable');}finally{if(version.current===generation)setSaving(false);}
 }
 return <details className="border-border bg-card rounded-2xl border p-4 shadow-sm sm:p-5">
  <summary className="cursor-pointer text-sm font-semibold">{t('voice.whatsappTitle')}</summary>
  <div className="mt-3 space-y-3">
   <p className="text-muted-foreground text-xs">{t('voice.whatsappSetupNote')}</p>
   {loading?<Loader2 className="size-4 animate-spin"/>:settings?<>
    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={settings.inboundEnabled} disabled={saving||(!settings.ratesConfigured.inbound&&!settings.inboundEnabled)} onChange={event=>{setSettings({...settings,inboundEnabled:event.target.checked});setSaved(false);}}/>{t('voice.whatsappInbound')}</label>
    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={settings.outboundEnabled} disabled={saving||(!settings.ratesConfigured.outbound&&!settings.outboundEnabled)} onChange={event=>{setSettings({...settings,outboundEnabled:event.target.checked});setSaved(false);}}/>{t('voice.whatsappOutbound')}</label>
    {(!settings.ratesConfigured.inbound||!settings.ratesConfigured.outbound)&&<p className="text-muted-foreground text-xs">{t('voice.whatsappRatesUnavailable')}</p>}
    <Button size="sm" onClick={save} disabled={saving||!workspaceId}>{saving?<Loader2 className="size-4 animate-spin"/>:t('voice.save')}</Button>
    {saved&&<p className="text-xs" role="status">{t('voice.saved')}</p>}
   </>:null}
   {error&&<p className="text-destructive text-xs" role="alert">{t(`voice.whatsappError_${error}`)}</p>}
  </div>
 </details>;
}
