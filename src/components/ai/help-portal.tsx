'use client';
import {useEffect,useRef,useState} from 'react';
import {useWorkspace} from '@/hooks/use-workspace';
import {useT} from '@/hooks/use-locale';
import {useFormat} from '@/hooks/use-format';
import {useFetchWithCsrf} from '@/lib/api/fetch-with-csrf';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import type {DocumentSource} from '@/lib/ai/document-contract';
import {portalCommand,portalSnapshot,portalStatistics,type PortalSnapshot} from '@/lib/help-portal/contract';
import type {z} from 'zod';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import Link from '@/components/i18n/locale-link';

export function HelpPortalManager({agentId,sources}:{agentId:string;sources:DocumentSource[]}){
 const t=useT(),fmt=useFormat(),fetch=useFetchWithCsrf(),{workspace}=useWorkspace(),workspaceId=workspace?.id;
 const [statistics,setStatistics]=useState<z.infer<typeof portalStatistics>|null>(null);
 const [portal,setPortal]=useState<PortalSnapshot|null>(null),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [name,setName]=useState(''),[description,setDescription]=useState(''),[accent,setAccent]=useState('#202020'),[slug,setSlug]=useState(''),[visible,setVisible]=useState(false);
 const [selected,setSelected]=useState(''),[sourceId,setSourceId]=useState(''),[title,setTitle]=useState(''),[body,setBody]=useState(''),[locale,setLocale]=useState<'es'|'en'>('es'),[reviewed,setReviewed]=useState(false);
 const controller=useRef<AbortController|null>(null),version=useRef(0),portalAttempt=useRef(''),articleAttempt=useRef('');
 const active=sources.filter(row=>row.status==='active'),source=active.find(row=>row.id===sourceId),article=portal?.articles.find(row=>row.id===selected);
 const unchanged=Boolean(article&&source&&article.source_id===source.id&&article.source_revision===source.revision&&article.title===title.trim()&&article.body===body.trim()&&article.locale===locale);
 useEffect(()=>{const requests=controller,serial=version;serial.current++;requests.current?.abort();portalAttempt.current='';articleAttempt.current='';
  setPortal(null);setStatistics(null);setLoaded(false);setBusy(false);setError('');setSelected('');setSourceId('');setTitle('');setBody('');setReviewed(false);setName('');setDescription('');setSlug('');setVisible(false);
  return()=>{serial.current++;requests.current?.abort();};
 },[agentId,workspaceId]);
 useEffect(()=>{setReviewed(false);},[sources]);
 if(!SHOW_RIVERZ_IMPROVEMENTS)return null;
 function choose(id:string,next=portal){const row=next?.articles.find(item=>item.id===id);setSelected(row?.id??'');setSourceId(row?.source_id??'');
  setTitle(row?.title??'');setBody(row?.body??'');setLocale(row?.locale??'es');setReviewed(false);articleAttempt.current='';}
 function adopt(next:PortalSnapshot|null){setPortal(next);setLoaded(true);setName(next?.brand.name??'');setDescription(next?.brand.description??'');setAccent(next?.brand.accent??'#202020');setSlug(next?.slug??'');setVisible(next?.published??false);}
 async function request(command?:unknown){
  if(!workspaceId||busy)return;const operation=++version.current,abort=new AbortController();controller.current?.abort();controller.current=abort;setBusy(true);setError('');
  try{
   if(command&&!portalCommand.safeParse(command).success)throw new Error('portal_invalid');
   const response=await fetch(`/api/ai/agents/${agentId}/help-portal`,{method:command?'POST':'GET',headers:{'Content-Type':'application/json','x-workspace-id':workspaceId},
    ...(command?{body:JSON.stringify(command)}:{}),cache:'no-store',signal:abort.signal});
   const value=await response.json();if(operation!==version.current)return;
   if(!response.ok)throw new Error(typeof value.code==='string'?value.code:'portal_unavailable');
   const parsed=value.portal===null?null:portalSnapshot.safeParse(value.portal);
   if(parsed&&(!parsed.success||parsed.data.workspace_id!==workspaceId||parsed.data.agent_id!==agentId))throw new Error('portal_unavailable');
   const next=parsed?.success?parsed.data:null;adopt(next);
   if(!command){const stats=value.statistics?portalStatistics.safeParse(value.statistics):null;if(stats&&!stats.success)throw new Error('portal_unavailable');setStatistics(stats?.success?stats.data:null);}
   const saved=command&&typeof command==='object'&&'action'in command&&command.action==='save'&&'input'in command?command.input:null;
   choose(saved&&typeof saved==='object'&&'id'in saved&&typeof saved.id==='string'?saved.id:selected,next);
  }catch(cause){if(operation===version.current&&!abort.signal.aborted){const code=cause instanceof Error&&/^portal_(invalid|not_found|changed|source_changed|read_only|limit|unavailable)$/.test(cause.message)?cause.message:'portal_unavailable';setError(t(`assistant.${code}`));}}
  finally{if(operation===version.current){setBusy(false);controller.current=null;}}
 }
 function configure(){if(!portalAttempt.current)portalAttempt.current=crypto.randomUUID();void request({action:'configure',input:{id:portal?.id??portalAttempt.current,agentId,slug,brand:{name,description,accent},revision:portal?.revision??0,published:visible}});}
 function save(){if(!portal||!source)return;if(!articleAttempt.current)articleAttempt.current=crypto.randomUUID();void request({action:'save',input:{id:article?.id??articleAttempt.current,portalId:portal.id,sourceId:source.id,sourceRevision:source.revision,title,body,locale,revision:article?.revision??0}});}
 function change(){setReviewed(false);articleAttempt.current='';}
 function publish(){if(!portal||!article||!reviewed||!unchanged)return;void request({action:'publish',input:{id:article.id,portalId:portal.id,revision:article.revision,action:'publish',reviewed:true}});}
 const field='w-full rounded border bg-background p-2 text-sm';
 return <details className="rounded-lg border p-3" onToggle={event=>{event.stopPropagation();if(event.currentTarget.open){if(!loaded&&!busy)void request();}
  else{version.current++;controller.current?.abort();controller.current=null;setBusy(false);setReviewed(false);setBody('');setSelected('');setSourceId('');}}}>
  <summary className="cursor-pointer font-medium">{t('assistant.portalTitle')}</summary>
  <div className="mt-3 space-y-3">
   {error&&<p role="alert" className="text-destructive text-sm">{error}</p>}{busy&&<p role="status">{t('assistant.portalLoading')}</p>}
   <Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>void request()}>{t('assistant.portalRefresh')}</Button>
   {loaded&&<>
    <label className="block"><span>{t('assistant.portalName')}</span><input className={field} maxLength={120} value={name} disabled={busy} onChange={event=>setName(event.target.value)}/></label>
    <label className="block"><span>{t('assistant.portalDescription')}</span><input className={field} maxLength={300} value={description} disabled={busy} onChange={event=>setDescription(event.target.value)}/></label>
    <label className="block"><span>{t('assistant.portalSlug')}</span><input className={field} maxLength={64} value={slug} disabled={busy} onChange={event=>setSlug(event.target.value)}/></label>
    <label className="flex items-center gap-2"><span>{t('assistant.portalAccent')}</span><input type="color" value={accent} disabled={busy} onChange={event=>setAccent(event.target.value)}/></label>
    <label className="flex items-center gap-2"><input type="checkbox" checked={visible} disabled={busy} onChange={event=>setVisible(event.target.checked)}/>{t('assistant.portalVisibility')}</label>
    <Button type="button" size="sm" disabled={busy} onClick={configure}>{t('assistant.portalSaveSettings')}</Button>
    {portal&&<>
     {statistics&&<dl className="space-y-1 text-xs text-muted-foreground">{[
      ['portalViews',statistics.views],['portalResponses',statistics.responded],['portalResolved',statistics.resolved],['portalNeedsHelp',statistics.needsHelp],
      ['portalAvoidanceResponses',statistics.avoidanceResponded],['portalReportedAvoided',statistics.reportedAvoided],
     ].map(([key,value])=><div key={key} className="flex justify-between gap-3"><dt>{t(`assistant.${key}`)}</dt><dd>{fmt.number(Number(value))}</dd></div>)}</dl>}
     {portal.published&&<Link href={`/ayuda/${portal.slug}`} target="_blank" rel="noopener noreferrer" className="block text-sm underline">{t('assistant.portalOpen')}</Link>}
     <div className="space-y-2">{portal.articles.map(row=><Button key={row.id} type="button" size="sm" variant="outline" disabled={busy} onClick={()=>choose(row.id)}>{row.title} · {t(`assistant.portalStatus_${row.status}`)}</Button>)}</div>
     <Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>choose('')}>{t('assistant.portalNewArticle')}</Button>
     <label className="block"><span>{t('assistant.portalSource')}</span><select className={field} value={sourceId} disabled={busy} onChange={event=>{setSourceId(event.target.value);change();}}><option value="">—</option>{active.map(row=><option key={row.id} value={row.id}>{row.name} · v{row.revision}</option>)}</select></label>
     <label className="block"><span>{t('assistant.portalArticleTitle')}</span><input className={field} maxLength={160} value={title} disabled={busy} onChange={event=>{setTitle(event.target.value);change();}}/></label>
     <label className="block"><span>{t('assistant.portalExcerpt')}</span><Textarea value={body} maxLength={16000} rows={6} disabled={busy} onChange={event=>{setBody(event.target.value);change();}}/></label>
     <label className="block"><span>{t('assistant.portalLanguage')}</span><select className={field} value={locale} disabled={busy} onChange={event=>{setLocale(event.target.value==='en'?'en':'es');change();}}><option value="es">Español</option><option value="en">English</option></select></label>
     <Button type="button" size="sm" disabled={busy||!source||!title.trim()||!body.trim()} onClick={save}>{t('assistant.portalSaveDraft')}</Button>
     {article&&<>
      <label className="flex items-center gap-2"><input type="checkbox" checked={reviewed&&unchanged} disabled={busy||!unchanged} onChange={event=>setReviewed(event.target.checked)}/>{t('assistant.portalReview')}</label>
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={busy||!reviewed||!unchanged} onClick={publish}>{t('assistant.portalPublish')}</Button>
       <Button type="button" size="sm" variant="outline" disabled={busy||article.status==='withdrawn'} onClick={()=>void request({action:'withdraw',input:{id:article.id,portalId:portal.id,revision:article.revision,action:'withdraw'}})}>{t('assistant.portalWithdraw')}</Button></div>
     </>}
    </>}
   </>}
  </div>
 </details>;
}
