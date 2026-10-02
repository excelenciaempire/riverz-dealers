'use client';
import {useEffect,useRef,useState} from 'react';
import {useWorkspace} from '@/hooks/use-workspace';
import {useT} from '@/hooks/use-locale';
import {useFormat} from '@/hooks/use-format';
import {useFetchWithCsrf} from '@/lib/api/fetch-with-csrf';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {externalSourceStart,externalSourceSnapshot,externalSourceLabel,type ExternalSourceSnapshot} from '@/lib/migrations/external-source-contract';
import {contactMigrationSnapshot,type ContactMigrationSnapshot} from '@/lib/migrations/contact-import-contract';
import {MigrationImportReview} from './migration-import-review';
const codes=['invalid','notFound','changed','expired','readOnly','limit','unavailable'];
export function ExternalMigration({onImported}:{onImported?:()=>void}){
  const t=useT(),fmt=useFormat(),fetch=useFetchWithCsrf(),{workspace}=useWorkspace(),workspaceId=workspace?.id;
  const [provider,setProvider]=useState<'kommo'|'manychat'>('kommo'),[subscriberIds,setSubscriberIds]=useState('');
  const [origin,setOrigin]=useState(''),[accountId,setAccountId]=useState(''),[token,setToken]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[recovery,setRecovery]=useState('');
  const [job,setJob]=useState<ExternalSourceSnapshot|null>(null),[review,setReview]=useState<ContactMigrationSnapshot|null>(null);
  const attempt=useRef(''),reviewAttempt=useRef(''),version=useRef(0),controller=useRef<AbortController|null>(null);
  useEffect(()=>{
    const requestVersion=version,requestController=controller;requestVersion.current++;requestController.current?.abort();attempt.current='';reviewAttempt.current='';
    setJob(null);setReview(null);setBusy(false);setError('');setRecovery('');setOrigin('');setAccountId('');setToken('');setSubscriberIds('');setProvider('kommo');
    if(workspaceId)try{const id=localStorage.getItem(`riverz:external-migration:${workspaceId}`);if(id&&/^[0-9a-f-]{36}$/i.test(id))setRecovery(id);}catch{/* Only an opaque ID is recoverable. */}
    return()=>{requestVersion.current++;requestController.current?.abort();};
  },[workspaceId]);
  if(!SHOW_RIVERZ_IMPROVEMENTS)return null;
  function remember(id:string){setRecovery(id);try{localStorage.setItem(`riverz:external-migration:${workspaceId}`,id);}catch{/* No source data or credentials are saved in the browser. */}}
  function change(){attempt.current='';reviewAttempt.current='';setError('');}
  async function run(action:'start'|'refresh'|'recover'|'cancel'|'review',after=0){
    if(!workspaceId||busy)return;const request=++version.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;setBusy(true);setError('');
    try{
      let body:unknown,url='/api/contacts/migrations/external',expectedId=job?.id;
      if(action==='start'){
        if(!attempt.current)attempt.current=crypto.randomUUID();
        const account=/^[1-9][0-9]{0,15}$/.test(accountId)?Number(accountId):NaN;
        const ids=subscriberIds.trim().split(/[\s,]+/).map(value=>/^[1-9][0-9]{0,15}$/.test(value)?Number(value):NaN);
        const source=provider==='kommo'?{provider,origin,accountId:account}:{provider,origin:'https://api.manychat.com',accountId:account,subscriberIds:ids};
        const input=externalSourceStart.safeParse({id:attempt.current,source,token});
        if(!input.success)throw new Error('invalid');expectedId=input.data.id;remember(input.data.id);body={action,input:input.data};
      }else if(action==='refresh'||action==='recover'){
        expectedId=action==='recover'?recovery:job?.id;if(!expectedId)throw new Error('invalid');url+=`?id=${encodeURIComponent(expectedId)}&after=${after}`;
      }else if(action==='cancel'){
        if(!job)throw new Error('invalid');body={action,input:{id:job.id}};
      }else{
        if(!job||job.state!=='ready')throw new Error('invalid');
        if(review||!reviewAttempt.current)reviewAttempt.current=crypto.randomUUID();body={action,input:{id:job.id,reviewId:reviewAttempt.current}};
      }
      const response=await fetch(url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-workspace-id':workspaceId},...(body?{body:JSON.stringify(body)}:{}),signal:abort.signal});
      const value:unknown=await response.json().catch(()=>null);if(version.current!==request)return;
      if(!response.ok){const code=value&&typeof value==='object'&&'code'in value?value.code:'unavailable';throw new Error(typeof code==='string'&&codes.includes(code)?code:'unavailable');}
      if(action==='review'){
        const parsed=contactMigrationSnapshot.safeParse(value);if(!parsed.success||parsed.data.id!==reviewAttempt.current||parsed.data.workspace_id!==workspaceId||!job||parsed.data.provider!==job.source.provider||parsed.data.account!==externalSourceLabel(job.source))throw new Error('unavailable');
        setReview(parsed.data);try{localStorage.setItem(`riverz:migration:${workspaceId}`,parsed.data.id);}catch{/* Recovery does not contain contacts. */}
      }else{
        const parsed=externalSourceSnapshot.safeParse(value);if(!parsed.success||parsed.data.workspace_id!==workspaceId||parsed.data.id!==expectedId)throw new Error('unavailable');
        setJob(parsed.data);setProvider(parsed.data.source.provider);remember(parsed.data.id);if(action==='start'||action==='cancel'||action==='recover'){setToken('');setSubscriberIds('');}
        if(action==='cancel')setReview(null);
      }
    }catch(cause){if(version.current===request){const code=cause instanceof Error&&codes.includes(cause.message)?cause.message:'unavailable';setError(code);if(action==='review'&&['changed','expired'].includes(code))reviewAttempt.current='';}}
    finally{if(version.current===request)setBusy(false);}
  }
  const inputClass='min-w-0 w-full rounded border border-border bg-card p-2 text-sm',active=job&&['queued','fetching','ready'].includes(job.state);
  return <section className="space-y-3 rounded border border-border p-3">
    <h3 className="text-sm font-medium">{t('contacts.externalTitle')}</h3><p className="text-xs text-muted-foreground">{t(provider==='kommo'?'contacts.externalKommoScope':'contacts.externalManyChatScope')}</p>
    {!job&&<><label className="block text-xs">{t('contacts.migrationProvider')}<select className={inputClass} value={provider} disabled={busy} onChange={event=>{change();setProvider(event.target.value as 'kommo'|'manychat');setToken('');setOrigin('');setSubscriberIds('');setAccountId('');}}><option value="kommo">Kommo</option><option value="manychat">ManyChat</option></select></label><div className="grid gap-2 sm:grid-cols-2">
      {provider==='kommo'&&<label className="text-xs">{t('contacts.externalOrigin')}<input className={inputClass} type="url" maxLength={120} disabled={busy} value={origin} onChange={event=>{change();setOrigin(event.target.value);}} placeholder="https://your-store.kommo.com" autoComplete="off"/></label>}
      <label className="text-xs">{t('contacts.externalAccount')}<input className={inputClass} inputMode="numeric" maxLength={16} disabled={busy} value={accountId} onChange={event=>{change();setAccountId(event.target.value);}} autoComplete="off"/></label>
    </div>{provider==='manychat'&&<label className="block text-xs">{t('contacts.externalSubscriberIds')}<textarea className={inputClass} maxLength={1700} disabled={busy} value={subscriberIds} onChange={event=>{change();setSubscriberIds(event.target.value);}} autoComplete="off"/></label>}<label className="block text-xs">{t('contacts.nativeToken')}<input className={inputClass} type="password" autoComplete="new-password" maxLength={4096} disabled={busy} value={token} onChange={event=>{change();setToken(event.target.value);}}/></label>
    <button type="button" disabled={busy||!workspaceId||!accountId||!token||(provider==='kommo'?!origin:!subscriberIds.trim())} className="rounded border border-border px-3 py-2 text-sm disabled:opacity-50" onClick={()=>void run('start')}>{t('contacts.nativeStart')}</button></>}
    {recovery&&!job&&<button type="button" disabled={busy} className="block text-xs underline" onClick={()=>void run('recover')}>{t('contacts.nativeRecover')}</button>}
    {job&&<><p role="status" className="text-xs">{t(`contacts.nativeState_${job.state}`)} · {fmt.number(job.collected)}{job.total!==null?` / ${fmt.number(job.total)}`:''}</p>
      <p className="break-all text-xs text-muted-foreground">{job.source.origin} #{job.source.accountId} · {job.id}</p>
      {job.error&&<p role="alert" className="text-xs text-destructive">{t(job.error==='source_auth'?'contacts.externalAuth':`contacts.nativeError_${job.error}`)}</p>}
      {active&&<div className="flex flex-wrap gap-3"><button type="button" disabled={busy} className="text-xs underline" onClick={()=>void run('refresh')}>{t('contacts.nativeRefresh')}</button>
        <button type="button" disabled={busy} className="text-xs underline" onClick={()=>void run('cancel')}>{t('contacts.nativeCancel')}</button></div>}
      {job.state==='ready'&&<button type="button" disabled={busy} className="rounded border border-border px-3 py-2 text-sm disabled:opacity-50" onClick={()=>void run('review')}>{t('contacts.nativeReview')}</button>}
      {!active&&<button type="button" disabled={busy} className="text-xs underline" onClick={()=>{setJob(null);setReview(null);setToken('');change();}}>{t('contacts.nativeNew')}</button>}
    </>}
    {review&&<MigrationImportReview key={review.id} input={null} initialReview={review} onImported={onImported}/>}
    {error&&<p role="alert" className="text-xs text-destructive">{t(`contacts.migrationServer_${error}`)}</p>}
  </section>;
}
