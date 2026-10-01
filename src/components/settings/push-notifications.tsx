'use client';
import {useEffect,useRef,useState} from 'react';
import {z} from 'zod';
import {useT,useLocale} from '@/hooks/use-locale';
import {useWorkspace} from '@/hooks/use-workspace';
import {useFetchWithCsrf} from '@/lib/api/fetch-with-csrf';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {browserPushSupported,enableBrowserPush,disableBrowserPush} from '@/lib/pwa/push-browser';
const configuration=z.object({enabled:z.boolean(),public_key:z.string().nullable()}).strict();
export function PushNotifications(){return SHOW_RIVERZ_IMPROVEMENTS?<Access/>:null;}
function Access(){
 const {workspace,membership,loading}=useWorkspace();if(loading||!workspace||!membership)return null;
 const owner=workspace.owner_id===membership.user_id;
 if(!owner&&membership.allowed_sections&&!membership.allowed_sections.includes('/bandeja'))return null;
 return <Control key={`${workspace.id}:${membership.user_id}`} workspaceId={workspace.id}/>;
}
function Control({workspaceId}:{workspaceId:string}){
 const t=useT(),{locale}=useLocale(),request=useFetchWithCsrf();
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[key,setKey]=useState<string|null>(null);
 const [status,setStatus]=useState<'idle'|'unsupported'|'unavailable'|'enabled'|'disabled'|'denied'>('idle');
 const active=useRef<AbortController|null>(null);
 useEffect(()=>()=>{active.current?.abort();active.current=null;},[]);
 const button='mt-3 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50';
 async function send(method:string,body?:unknown,signal?:AbortSignal){
  const response=await request('/api/pwa/notifications',{method,cache:'no-store',signal,headers:{'Content-Type':'application/json','x-riverz-workspace':workspaceId},...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok)throw new Error('push_unavailable');return response.json();
 }
 async function load(){
  if(active.current)return;if(!browserPushSupported(window)){setStatus('unsupported');return;}
  const controller=new AbortController();active.current=controller;setBusy(true);
  try{const data=configuration.parse(await send('GET',undefined,controller.signal));if(active.current===controller){setKey(data.enabled?data.public_key:null);setStatus(data.enabled?'idle':'unavailable');}}
  catch{if(active.current===controller&&!controller.signal.aborted)setStatus('unavailable');}
  finally{if(active.current===controller){active.current=null;setBusy(false);}}
 }
 async function change(enable:boolean){
  if(active.current||(!key&&enable))return;const controller=new AbortController();active.current=controller;setBusy(true);
  try{
   if(enable)await enableBrowserPush(window,key!,async subscription=>{if(controller.signal.aborted)throw new Error('cancelled');await send('POST',{subscription,locale},controller.signal);});
   else await disableBrowserPush(window,async endpoint=>{if(controller.signal.aborted)throw new Error('cancelled');await send('DELETE',{endpoint},controller.signal);});
   if(active.current===controller)setStatus(enable?'enabled':'disabled');
  }catch(error){if(active.current===controller&&!controller.signal.aborted)setStatus(error instanceof Error&&error.message==='push_denied'?'denied':'unavailable');}
  finally{if(active.current===controller){active.current=null;setBusy(false);}}
 }
 return <div className="mt-4 border-t border-border pt-3"><button type="button" aria-expanded={open} className="text-sm font-medium" onClick={()=>{setOpen(!open);if(!open&&!key)void load();}}>{t('settings.pushTitle')}</button>
  {open&&<div className="space-y-2"><p className="mt-2 text-xs text-muted-foreground">{t('settings.pushHelp')}</p>
   <p className="text-sm" role={status==='unavailable'?'alert':'status'}>{busy?t('settings.httpLoading'):t(`settings.pushStatus_${status}`)}</p>
   {status!=='unsupported'&&<div className="flex flex-wrap gap-2"><button className={button} disabled={busy||!key} type="button" onClick={()=>void change(true)}>{t('settings.pushEnable')}</button><button className={button} disabled={busy} type="button" onClick={()=>void change(false)}>{t('settings.pushDisable')}</button></div>}
   <p className="text-xs text-muted-foreground">{t('settings.pushCompatibility')}</p><p className="text-xs text-muted-foreground">{t('settings.pushLimits')}</p>
  </div>}
 </div>;
}
