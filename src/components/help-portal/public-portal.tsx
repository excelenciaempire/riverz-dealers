'use client';
import {useEffect,useRef,useState} from 'react';
import type {Locale} from '@/lib/i18n/config';
import {translateMessages} from '@/lib/i18n/namespace';
import {assistant} from '@/lib/i18n/messages/assistant';
import {publicPortal,type PublicPortal} from '@/lib/help-portal/contract';
export function PublicHelpPortal({slug,initialLocale}:{slug:string;initialLocale:Locale}){
 const [locale,setLocale]=useState(initialLocale),[snapshot,setPortal]=useState<PublicPortal|null>(null),[search,setSearch]=useState(''),[error,setError]=useState('');
 const portal=snapshot?.slug===slug&&snapshot.locale===locale?snapshot:null,context=`${slug}:${locale}`;
 const t=(key:string)=>translateMessages(locale,assistant,key);
 useEffect(()=>{
  const abort=new AbortController();
  void fetch(`/api/help-portals/${encodeURIComponent(slug)}?locale=${locale}`,{signal:abort.signal,cache:'no-store'}).then(async response=>{
   if(!response.ok)throw new Error('unavailable');const data=publicPortal.parse(await response.json());
   if(data.slug!==slug||data.locale!==locale)throw new Error('unavailable');if(!abort.signal.aborted){setPortal(data);setError('');}
  }).catch(()=>{if(!abort.signal.aborted)setError(`${slug}:${locale}`);});return()=>abort.abort();
 },[slug,locale]);
 const normalize=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase(locale);
 const articles=portal?.articles.filter(row=>normalize(`${row.title}\n${row.body}`).includes(normalize(search.trim())))??[];
 return <main lang={locale} className="mx-auto min-h-screen max-w-3xl px-5 py-12 text-foreground">
  <div className="mb-8 flex justify-end gap-3"><button type="button" className="underline" aria-pressed={locale==='es'} onClick={()=>setLocale('es')}>Español</button><button type="button" className="underline" aria-pressed={locale==='en'} onClick={()=>setLocale('en')}>English</button></div>
  {error===context?<p role="alert">{t('portal_not_found')}</p>:!portal?<p role="status">{t('portalLoading')}</p>:<>
   <header className="mb-8 border-l-4 pl-4" style={{borderColor:portal.brand.accent}}><h1 className="text-3xl font-semibold">{portal.brand.name}</h1><p className="mt-2 text-muted-foreground">{portal.brand.description}</p></header>
   <label className="block"><span className="sr-only">{t('portalSearch')}</span><input className="w-full rounded-xl border bg-background p-3" placeholder={t('portalSearch')} maxLength={200} value={search} onChange={event=>setSearch(event.target.value)}/></label>
   {!articles.length&&<p className="mt-8">{t(portal.articles.length?'portalNoResults':'portalEmpty')}</p>}
   <PortalArticles key={`${slug}:${locale}`} portal={{...portal,articles}}/>
  </>}
 </main>;
}
export function PortalArticles({portal}:{portal:PublicPortal}){
 const t=(key:string)=>translateMessages(portal.locale,assistant,key),visit=useRef(''),seen=useRef(new Set<string>()),controllers=useRef(new Set<AbortController>());
 const [votes,setVotes]=useState<Record<string,'busy'|'recorded'|'failed'>>({});
 const [answers,setAnswers]=useState<Record<string,boolean>>({}),[avoidance,setAvoidance]=useState<Record<string,'busy'|'recorded'|'failed'>>({});
 useEffect(()=>{const requests=controllers;return()=>{for(const request of requests.current)request.abort();requests.current.clear();};},[]);
 async function report(row:PublicPortal['articles'][number],resolved:boolean|null,avoidedContact:boolean|null=null){
  const key=`${row.id}:${row.revision}`,isAvoidance=avoidedContact!==null;
  if(isAvoidance?(answers[key]!==true||avoidance[key]==='busy'||avoidance[key]==='recorded'):resolved!==null&&(votes[key]==='busy'||votes[key]==='recorded'))return;
  if(!visit.current)visit.current=crypto.randomUUID();const abort=new AbortController();controllers.current.add(abort);
  if(isAvoidance)setAvoidance(old=>({...old,[key]:'busy'}));else if(resolved!==null)setVotes(old=>({...old,[key]:'busy'}));
  try{
   const response=await fetch(`/api/help-portals/${encodeURIComponent(portal.slug)}`,{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',signal:abort.signal,
    body:JSON.stringify({articleId:row.id,revision:row.revision,visitId:visit.current,locale:portal.locale,resolved,avoidedContact})});
   if(!response.ok||(await response.json()).recorded!==true)throw new Error('unavailable');
   if(!abort.signal.aborted){if(isAvoidance)setAvoidance(old=>({...old,[key]:'recorded'}));else if(resolved!==null){setVotes(old=>({...old,[key]:'recorded'}));setAnswers(old=>({...old,[key]:resolved}));}}
  }catch{if(!abort.signal.aborted){if(isAvoidance)setAvoidance(old=>({...old,[key]:'failed'}));else if(resolved!==null)setVotes(old=>({...old,[key]:'failed'}));else seen.current.delete(key);}}
  finally{controllers.current.delete(abort);}
 }
 return <section className="mt-6 space-y-4" aria-label={t('portalTitle')}>{portal.articles.map(row=>{
  const key=`${row.id}:${row.revision}`;return <details key={key} className="rounded-xl border p-4" onToggle={event=>{if(event.currentTarget.open&&!seen.current.has(key)){seen.current.add(key);void report(row,null);}}}>
   <summary className="cursor-pointer font-medium">{row.title}</summary><p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6">{row.body}</p>
   <div className="mt-4 flex flex-wrap gap-3 text-xs">{votes[key]==='recorded'?<>
    <p role="status">{t('portalFeedbackRecorded')}</p>
    {answers[key]===true&&avoidance[key]!=='recorded'&&<>
     <button type="button" className="rounded border px-3 py-2 disabled:opacity-50" disabled={avoidance[key]==='busy'} onClick={()=>void report(row,true,true)}>{t('portalAvoidedMine')}</button>
     <button type="button" className="rounded border px-3 py-2 disabled:opacity-50" disabled={avoidance[key]==='busy'} onClick={()=>void report(row,true,false)}>{t('portalStillContact')}</button>
     {avoidance[key]==='failed'&&<p role="alert">{t('portal_unavailable')}</p>}
    </>}
   </>:<>
    <button type="button" disabled={votes[key]==='busy'} className="rounded border px-3 py-2 disabled:opacity-50" onClick={()=>void report(row,true)}>{t('portalSolvedMine')}</button>
    <button type="button" disabled={votes[key]==='busy'} className="rounded border px-3 py-2 disabled:opacity-50" onClick={()=>void report(row,false)}>{t('portalNeedHelpMine')}</button>
    {votes[key]==='failed'&&<p role="alert">{t('portal_unavailable')}</p>}
   </>}</div>
  </details>;
 })}</section>;
}
