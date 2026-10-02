'use client';
import {useEffect,useRef,useState} from 'react';
import {useWorkspace} from '@/hooks/use-workspace';
import {useT} from '@/hooks/use-locale';
import {useFormat} from '@/hooks/use-format';
import {useFetchWithCsrf} from '@/lib/api/fetch-with-csrf';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {contactMigrationSnapshot,contactMigrationResults,type ContactMigrationPreparation,type ContactMigrationSnapshot,type ContactMigrationResults} from '@/lib/migrations/contact-import-contract';

type Props={input:Omit<ContactMigrationPreparation,'id'>|null;initialReview?:ContactMigrationSnapshot|null;onImported?:()=>void};
const codes=['invalid','notFound','changed','expired','readOnly','limit','unavailable'] as const;
/** Confirmation is a separate, reversible review step. No implicit import on upload. */
export function MigrationImportReview({input,initialReview,onImported}:Props){
  const t=useT(),fmt=useFormat(),fetch=useFetchWithCsrf(),{workspace}=useWorkspace();
  const [snapshot,setSnapshot]=useState<ContactMigrationSnapshot|null>(null),[report,setReport]=useState<ContactMigrationResults|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[approved,setApproved]=useState(false),[recovery,setRecovery]=useState('');
  const attempt=useRef(''),version=useRef(0),controller=useRef<AbortController|null>(null);
  const workspaceId=workspace?.id;
  useEffect(()=>{
    const requestVersion=version,requestController=controller;
    requestVersion.current++;requestController.current?.abort();attempt.current='';
    setSnapshot(null);setReport(null);setApproved(false);setBusy(false);setError('');setRecovery('');
    if(!workspaceId)return;
    if(initialReview?.workspace_id===workspaceId){const parsed=contactMigrationSnapshot.safeParse(initialReview);if(parsed.success){setSnapshot(parsed.data);setRecovery(parsed.data.id);}}
    try{const id=localStorage.getItem(`riverz:migration:${workspaceId}`);if(id&&/^[0-9a-f-]{36}$/i.test(id))setRecovery(id);}catch{/* Receipt recovery remains available by its visible ID. */}
    return()=>{requestVersion.current++;requestController.current?.abort();};
  },[workspaceId,initialReview]);
  if(!SHOW_RIVERZ_IMPROVEMENTS)return null;
  function remember(id:string){setRecovery(id);try{localStorage.setItem(`riverz:migration:${workspaceId}`,id);}catch{/* No contact fields are stored in the browser. */}}
  async function run(operation:'prepare'|'confirm'|'page'|'report'|'recover',after=0){
    if(!workspaceId||busy)return;
    const request=++version.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;
    setBusy(true);setError('');
    try{
      let url='/api/contacts/migrations',body:unknown;const options:RequestInit={signal:abort.signal,headers:{'Content-Type':'application/json','x-workspace-id':workspaceId}};
      if(operation==='prepare'){
        if(!input)throw new Error('invalid');
        if(!attempt.current)attempt.current=crypto.randomUUID();remember(attempt.current);
        body={action:'prepare',input:{...input,id:attempt.current}};
      }else if(operation==='confirm'){
        if(!snapshot||snapshot.state!=='prepared'||!approved)throw new Error('invalid');
        body={action:'confirm',input:{id:snapshot.id,revision:snapshot.revision,confirmed:true}};
      }else{
        const id=operation==='recover'?recovery:snapshot?.id;if(!id)throw new Error('invalid');
        url+=`?id=${encodeURIComponent(id)}&after=${after}${operation==='report'?'&results=true':''}`;
      }
      if(body){options.method='POST';options.body=JSON.stringify(body);}
      const response=await fetch(url,options),value:unknown=await response.json().catch(()=>null);
      if(!response.ok){const code=value&&typeof value==='object'&&'code'in value?value.code:'unavailable';throw new Error(codes.includes(code as typeof codes[number])?String(code):'unavailable');}
      if(version.current!==request)return;
      if(operation==='report'){
        const parsed=contactMigrationResults.safeParse(value);if(!parsed.success||parsed.data.workspace_id!==workspaceId||parsed.data.id!==snapshot?.id||parsed.data.revision!==snapshot.revision)throw new Error('unavailable');setReport(parsed.data);
      }else{
        const parsed=contactMigrationSnapshot.safeParse(value);if(!parsed.success||parsed.data.workspace_id!==workspaceId||parsed.data.id!==(operation==='prepare'?attempt.current:operation==='recover'?recovery:snapshot?.id))throw new Error('unavailable');
        const saved=parsed.data;
        if(operation==='recover'&&saved.state!=='completed')throw new Error(saved.state==='expired'?'expired':'changed');
        if(operation==='confirm'&&(saved.state!=='completed'||saved.revision!==snapshot?.revision))throw new Error('unavailable');
        setSnapshot(saved);setReport(null);setApproved(false);remember(saved.id);
        if(operation==='confirm'&&saved.counts.created>0)onImported?.();
      }
    }catch(cause){
      if(version.current===request){const code=cause instanceof Error&&codes.includes(cause.message as typeof codes[number])?cause.message:'unavailable';setError(code);setApproved(false);
        if(operation==='prepare'&&(code==='changed'||code==='expired'))attempt.current='';
        if(operation==='confirm'&&(code==='changed'||code==='expired')){setSnapshot(null);attempt.current='';}
      }
    }finally{if(version.current===request)setBusy(false);}
  }
  const rows=report?.rows??snapshot?.rows??[],next=report?.next??snapshot?.next;
  return <section className="space-y-3 rounded border border-border p-3">
    <p className="text-xs text-muted-foreground">{t('contacts.migrationPrepareScope')}</p>
    {!snapshot&&input&&<button type="button" disabled={busy||!workspaceId} className="rounded border border-border px-3 py-2 text-sm disabled:opacity-50" onClick={()=>void run('prepare')}>{t('contacts.migrationPrepare')}</button>}
    {recovery&&snapshot?.state!=='completed'&&<button type="button" disabled={busy||!workspaceId} className="block text-xs underline disabled:opacity-50" onClick={()=>void run('recover')}>{t('contacts.migrationRecover')}</button>}
    {snapshot&&<>
      <p className="break-all text-xs">{snapshot.provider} · {snapshot.account}</p>
      <p className="text-xs">{t('contacts.migrationServerCounts',{new:fmt.number(snapshot.counts.new),existing:fmt.number(snapshot.counts.existing),excluded:fmt.number(snapshot.counts.excluded)})}</p>
      <p className="text-xs text-muted-foreground">{t('contacts.migrationConsentScope')}</p>
      <p className="break-all text-xs text-muted-foreground">{t('contacts.migrationReceipt')}: {snapshot.id}</p>
      {snapshot.state==='prepared'&&<>
        <label className="flex gap-2 text-xs"><input type="checkbox" checked={approved} disabled={busy} onChange={event=>setApproved(event.target.checked)}/><span>{t('contacts.migrationApprove',{count:fmt.number(snapshot.counts.new)})}</span></label>
        <button type="button" disabled={busy||!approved} className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50" onClick={()=>void run('confirm')}>{t('contacts.migrationCommit')}</button>
      </>}
      {snapshot.state==='expired'&&<p className="text-xs">{t('contacts.migrationServer_expired')}</p>}
      {snapshot.state==='completed'&&<><p role="status" className="text-sm">{t('contacts.migrationSaved',{count:fmt.number(snapshot.counts.created)})}</p><button type="button" disabled={busy} className="text-xs underline" onClick={()=>void run('report')}>{t('contacts.migrationReceipt')}</button></>}
    </>}
    {rows.length>0&&<div className="max-h-64 overflow-auto rounded border border-border"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">{t('contacts.migrationField_sourceId')}</th><th className="p-2">{t('contacts.migrationStatus')}</th></tr></thead><tbody>{rows.map(row=><tr key={row.row} className="border-t border-border"><td className="max-w-32 break-all p-2">{row.sourceId||'—'}</td><td className="p-2">{row.issues.length?row.issues.map(issue=>t(`contacts.migrationIssue_${issue}`)).join(' · '):t(`contacts.migrationRowState_${row.state}`)}</td></tr>)}</tbody></table></div>}
    {rows.length>0&&rows[0].row>2&&<button type="button" disabled={busy} className="mr-3 text-xs underline" onClick={()=>void run(report?'report':'page',0)}>{t('contacts.migrationFirstPage')}</button>}
    {next!==null&&next!==undefined&&<button type="button" disabled={busy} className="text-xs underline" onClick={()=>void run(report?'report':'page',next)}>{t('contacts.migrationNextPage')}</button>}
    {error&&<p role="alert" className="text-xs text-destructive">{t(`contacts.migrationServer_${error}`)}</p>}
  </section>;
}
