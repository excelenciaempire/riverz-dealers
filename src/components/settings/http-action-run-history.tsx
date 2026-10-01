'use client';
import {useEffect,useRef,useState} from 'react';
import {useLocale,useT} from '@/hooks/use-locale';
import {useFetchWithCsrf} from '@/lib/api/fetch-with-csrf';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {httpRunHistory,httpRunHistoryCsv,type HttpRunHistory} from '@/lib/integrations/http-action-run-history-contract';
const button='rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50';
export function HttpActionRunHistory({workspaceId,actionId,allowed}:{workspaceId:string;actionId:string;allowed:boolean}) {
 return SHOW_RIVERZ_IMPROVEMENTS&&allowed?<History key={`${workspaceId}:${actionId}`} workspaceId={workspaceId} actionId={actionId}/>:null;
}
function History({workspaceId,actionId}:{workspaceId:string;actionId:string}) {
 const t=useT(),{locale}=useLocale(),request=useFetchWithCsrf();
 const [open,setOpen]=useState(false),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
 const [runs,setRuns]=useState<HttpRunHistory['runs']>([]),[next,setNext]=useState<HttpRunHistory['next_cursor']>(null);
 const active=useRef<AbortController|null>(null);
 useEffect(()=>()=>{active.current?.abort();active.current=null;},[]);
 async function load(cursor:HttpRunHistory['next_cursor']=null) {
  if(active.current)return;
  const controller=new AbortController();active.current=controller;setBusy(true);setFailed(false);
  try {
   const query=cursor?`?cursor=${encodeURIComponent(JSON.stringify(cursor))}`:'';
   const response=await request(`/api/integrations/http-actions/${actionId}/runs${query}`,{cache:'no-store',signal:controller.signal,headers:{'x-riverz-workspace':workspaceId}});
   if(!response.ok)throw new Error('unavailable');
   const data=httpRunHistory.parse(await response.json());
   if(active.current!==controller||controller.signal.aborted)return;
   setRuns(current=>cursor?[...new Map([...current,...data.runs].map(row=>[row.id,row])).values()].slice(0,100):data.runs);
   setNext(data.next_cursor);setLoaded(true);
  }catch{if(active.current===controller&&!controller.signal.aborted)setFailed(true);}
  finally{if(active.current===controller){active.current=null;setBusy(false);}}
 }
 function download() {
  const url=URL.createObjectURL(new Blob([httpRunHistoryCsv(locale,runs)],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download='riverz-integration-receipts.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 return <div className="space-y-2 border-t border-border pt-2">
  <button type="button" className={button} aria-expanded={open} onClick={()=>{setOpen(!open);if(!open&&!loaded)void load();}}>{t('settings.httpRunsTitle')}</button>
  {open&&<div className="space-y-3 text-xs">
   <p className="text-muted-foreground">{t('settings.httpRunsHelp')}</p>
   {busy&&<p role="status">{t('settings.httpLoading')}</p>}
   {failed&&<p role="alert" className="text-destructive">{t('settings.httpAction_unavailable')}</p>}
   {loaded&&!runs.length&&<p>{t('settings.httpRunsEmpty')}</p>}
   {runs.length>0&&<div className="overflow-x-auto"><table className="w-full text-left"><thead><tr>{['httpRunsCreated','httpRunsState','httpRunsCode','httpRunsReceipt'].map(key=><th key={key} className="p-2">{t(`settings.${key}`)}</th>)}</tr></thead>
    <tbody>{runs.map(row=><tr key={row.id} className="border-t border-border"><td className="p-2 whitespace-nowrap"><time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString(locale)}</time><span className="block text-muted-foreground">{t('settings.httpVersion',{n:row.action_revision})}</span></td>
     <td className="p-2">{t(`settings.httpRunState_${row.state}`)}{row.error_code&&<span className="block text-muted-foreground">{t(`settings.httpRunError_${row.error_code}`)}</span>}</td><td className="p-2">{row.status_code??'—'}</td><td className="p-2 font-mono break-all">{row.id}</td></tr>)}</tbody></table></div>}
   <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={()=>void load()}>{t('settings.httpReload')}</button>
    {next&&runs.length<100&&<button type="button" className={button} disabled={busy} onClick={()=>void load(next)}>{t('settings.httpRunsMore')}</button>}
    {runs.length>0&&<button type="button" className={button} disabled={busy} onClick={download}>{t('settings.httpRunsExport')}</button>}</div>
   <p className="text-muted-foreground">{t('settings.httpRunsExportHelp')}</p>
  </div>}
 </div>;
}
