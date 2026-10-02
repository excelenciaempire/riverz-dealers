'use client';
import {useEffect,useRef,useState} from 'react';
import {useWorkspace} from '@/hooks/use-workspace';
import {useT} from '@/hooks/use-locale';
import {useFormat} from '@/hooks/use-format';
import {useFetchWithCsrf} from '@/lib/api/fetch-with-csrf';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {archiveStart,archiveSnapshot,archiveMessagesPage,type ArchiveSnapshot,type ArchiveMessagesPage} from '@/lib/migrations/archive-contract';
const codes=['invalid','notFound','changed','expired','readOnly','limit','unavailable'];
export function HistoryMigration(){
 const t=useT(),fmt=useFormat(),fetch=useFetchWithCsrf(),{workspace}=useWorkspace(),workspaceId=workspace?.id;
 const [receiptId,setReceiptId]=useState(''),[origin,setOrigin]=useState(''),[accountId,setAccountId]=useState(''),[token,setToken]=useState(''),[after,setAfter]=useState<string|null>(null),[recovery,setRecovery]=useState('');
 const [job,setJob]=useState<ArchiveSnapshot|null>(null),[page,setPage]=useState<ArchiveMessagesPage|null>(null),[checked,setChecked]=useState(false),[eraseChecked,setEraseChecked]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const version=useRef(0),controller=useRef<AbortController|null>(null),attempt=useRef(''),blobUrls=useRef(new Set<string>());
 useEffect(()=>{
  const requestVersion=version,requestController=controller,urls=blobUrls;requestVersion.current++;requestController.current?.abort();attempt.current='';
  setReceiptId('');setOrigin('');setAccountId('');setToken('');setAfter(null);setJob(null);setPage(null);setChecked(false);setEraseChecked(false);setBusy(false);setError('');setRecovery('');
  if(workspaceId)try{const saved=localStorage.getItem(`riverz:history-migration:${workspaceId}`),receipt=localStorage.getItem(`riverz:migration:${workspaceId}`);if(saved&&/^[0-9a-f-]{36}$/i.test(saved))setRecovery(saved);if(receipt&&/^[0-9a-f-]{36}$/i.test(receipt))setReceiptId(receipt);}catch{/* Opaque recovery IDs only. */}
  return()=>{requestVersion.current++;requestController.current?.abort();for(const url of urls.current)URL.revokeObjectURL(url);urls.current.clear();};
 },[workspaceId]);
 if(!SHOW_RIVERZ_IMPROVEMENTS)return null;
 function remember(id:string){setRecovery(id);try{localStorage.setItem(`riverz:history-migration:${workspaceId}`,id);}catch{/* No messages, files or credentials in browser storage. */}}
 function change(){attempt.current='';setError('');}
 function reset(){version.current++;controller.current?.abort();setBusy(false);setJob(null);setPage(null);setChecked(false);setEraseChecked(false);setToken('');setAfter(null);change();}
 async function run(action:'start'|'refresh'|'recover'|'preview'|'confirm'|'cancel'|'delete'|'file',cursor=0,fileId?:string){
  if(!workspaceId||busy)return;if(action==='confirm'&&(!checked||!page||page.revision!==job?.revision)||action==='delete'&&!eraseChecked)return;
  const request=++version.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;setBusy(true);setError('');
  try{
   let body:unknown,url='/api/contacts/migrations/history',id=action==='recover'?recovery:job?.id;
   if(action==='start'){
    if(!attempt.current)attempt.current=crypto.randomUUID();const input=archiveStart.safeParse({id:attempt.current,receiptId,provider:'chatwoot',origin,accountId:/^[1-9][0-9]{0,15}$/.test(accountId)?Number(accountId):NaN,token,after});
    if(!input.success)throw new Error('invalid');id=input.data.id;remember(id);body={action,input:input.data};
   }else{
    if(!id)throw new Error('invalid');
    if(action==='confirm'){if(!job?.revision)throw new Error('invalid');body={action,input:{id,revision:job.revision,confirmed:true}};}
    else if(action==='cancel'||action==='delete')body={action,input:{id}};
    else url+=`?id=${encodeURIComponent(id)}${action==='preview'?`&view=messages&after=${cursor}`:action==='file'?`&view=file&fileId=${encodeURIComponent(fileId??'')}`:''}`;
   }
   const response=await fetch(url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-workspace-id':workspaceId},...(body?{body:JSON.stringify(body)}:{}),signal:abort.signal});
   if(action==='file'&&response.ok){
    const blob=await response.blob();if(version.current!==request)return;const link=document.createElement('a'),objectUrl=URL.createObjectURL(blob);blobUrls.current.add(objectUrl);link.href=objectUrl;link.download=`archive-${fileId}`;document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>{URL.revokeObjectURL(objectUrl);blobUrls.current.delete(objectUrl);},10000);return;
   }
   const value:unknown=await response.json().catch(()=>null);if(version.current!==request)return;
   if(!response.ok){const code=value&&typeof value==='object'&&'code'in value?value.code:'unavailable';throw new Error(typeof code==='string'&&codes.includes(code)?code:'unavailable');}
   if(action==='preview'){
    const parsed=archiveMessagesPage.safeParse(value);if(!parsed.success||parsed.data.id!==id||parsed.data.revision!==job?.revision)throw new Error('unavailable');setPage(parsed.data);
   }else{
    const parsed=archiveSnapshot.safeParse(value);if(!parsed.success||parsed.data.workspace_id!==workspaceId||parsed.data.id!==id)throw new Error('unavailable');setJob(parsed.data);remember(parsed.data.id);setChecked(false);setEraseChecked(false);setPage(null);
    if(action==='start'||action==='recover'||action==='cancel'||action==='delete')setToken('');
   }
  }catch(cause){if(version.current===request)setError(cause instanceof Error&&codes.includes(cause.message)?cause.message:'unavailable');}
  finally{if(version.current===request)setBusy(false);}
 }
 const inputClass='min-w-0 w-full rounded border border-border bg-card p-2 text-sm',active=job&&['queued','fetching','ready'].includes(job.state),readable=job&&['ready','confirmed'].includes(job.state);
 return <details className="space-y-3 rounded border border-border p-3" onToggle={event=>{if(event.target===event.currentTarget&&!event.currentTarget.open)reset();}}>
  <summary className="cursor-pointer text-sm font-medium">{t('contacts.historyTitle')}</summary><div className="mt-3 space-y-3">
  <p className="text-xs text-muted-foreground">{t('contacts.historyScope')}</p>
  {!job&&<><label className="block text-xs">{t('contacts.historyReceipt')}<input className={inputClass} value={receiptId} maxLength={36} disabled={busy} onChange={event=>{change();setAfter(null);setReceiptId(event.target.value);}} autoComplete="off"/></label>
   <div className="grid gap-2 sm:grid-cols-2"><label className="text-xs">{t('contacts.nativeOrigin')}<input className={inputClass} type="url" maxLength={120} value={origin} disabled={busy} onChange={event=>{change();setOrigin(event.target.value);}} autoComplete="off" placeholder="https://chatwoot.example.com"/></label>
   <label className="text-xs">{t('contacts.nativeAccount')}<input className={inputClass} inputMode="numeric" maxLength={16} value={accountId} disabled={busy} onChange={event=>{change();setAccountId(event.target.value);}} autoComplete="off"/></label></div>
   <label className="block text-xs">{t('contacts.nativeToken')}<input className={inputClass} type="password" maxLength={4096} value={token} disabled={busy} onChange={event=>{change();setToken(event.target.value);}} autoComplete="new-password"/></label>
   {after&&<p className="text-xs">{t('contacts.historyNextBatch')}</p>}
   <button type="button" className="rounded border border-border px-3 py-2 text-sm disabled:opacity-50" disabled={busy||!receiptId||!origin||!accountId||!token} onClick={()=>void run('start')}>{t('contacts.historyStart')}</button>
  </>}
  {recovery&&!job&&<button type="button" className="block text-xs underline" disabled={busy} onClick={()=>void run('recover')}>{t('contacts.historyRecover')}</button>}
  {job&&<><p role="status" className="text-xs">{t(`contacts.historyState_${job.state}`)}</p><p className="break-all text-xs text-muted-foreground">{job.source.origin} #{job.source.accountId} · {job.id}</p>
   <p className="text-xs">{t('contacts.historyCounts',{contacts:fmt.number(job.contacts_collected),total:fmt.number(job.targets),conversations:fmt.number(job.conversations),messages:fmt.number(job.messages),files:fmt.number(job.files)})}</p>
   {job.error&&<p role="alert" className="text-xs text-destructive">{t(`contacts.nativeError_${job.error}`)}</p>}
   {active&&<div className="flex flex-wrap gap-3"><button type="button" className="text-xs underline" disabled={busy} onClick={()=>void run('refresh')}>{t('contacts.nativeRefresh')}</button><button type="button" className="text-xs underline" disabled={busy} onClick={()=>void run('cancel')}>{t('contacts.historyCancel')}</button></div>}
   {readable&&<button type="button" className="text-xs underline" disabled={busy} onClick={()=>void run('preview')}>{t('contacts.historyPreview')}</button>}
   {page&&<div className="space-y-2"><p className="text-xs text-muted-foreground">{t('contacts.historySample',{shown:fmt.number(page.rows.length),total:fmt.number(page.total)})}</p>
    <div className="max-h-80 space-y-3 overflow-auto rounded border border-border p-2">{page.rows.map(row=><article key={row.message.sourceId} className="space-y-1 border-b border-border pb-2">
     <p className="break-all text-xs text-muted-foreground">{t('contacts.historySource',{contact:row.contactSourceId,conversation:row.conversation.sourceId})} · {fmt.dateTime(row.message.at)}</p>
     <p className="text-xs font-medium">{t(row.message.private?'contacts.historyPrivate':`contacts.historyKind_${row.message.kind}`)}</p>
     <p className="whitespace-pre-wrap break-words text-xs">{row.message.sourceDeleted?t('contacts.historyDeleted'):row.message.text||'—'}</p>
     {row.files.map(file=><button key={file.fileId} type="button" className="block break-all text-xs underline" disabled={busy} onClick={()=>void run('file',0,file.fileId)}>{t('contacts.historyDownload',{id:file.fileId,size:fmt.number(file.bytes)})}</button>)}
    </article>)}</div>
    {page.next!==null&&<button type="button" className="text-xs underline" disabled={busy} onClick={()=>void run('preview',page.next!)}>{t('contacts.historyMoreMessages')}</button>}
   </div>}
   {job.state==='ready'&&<><label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" disabled={busy||!page} checked={checked} onChange={event=>setChecked(event.target.checked)}/><span>{t('contacts.historyAcknowledge')}</span></label>
    <button type="button" className="rounded border border-border px-3 py-2 text-sm disabled:opacity-50" disabled={busy||!checked||!page||page.revision!==job.revision} onClick={()=>void run('confirm')}>{t('contacts.historyConfirm')}</button></>}
   {job.state==='confirmed'&&<><p className="text-xs">{t('contacts.historySaved')}</p><label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" disabled={busy} checked={eraseChecked} onChange={event=>setEraseChecked(event.target.checked)}/><span>{t('contacts.historyDeleteAcknowledge')}</span></label>
    <button type="button" className="text-xs underline" disabled={busy||!eraseChecked} onClick={()=>void run('delete')}>{t('contacts.historyDelete')}</button></>}
   {!active&&<button type="button" className="block text-xs underline" disabled={busy} onClick={()=>{const next=job.next;setReceiptId(job.receipt_id);setOrigin(job.source.origin);setAccountId(String(job.source.accountId));reset();setAfter(next);}}>{t(job.next?'contacts.historyNextBatch':'contacts.historyNew')}</button>}
  </>}
  {error&&<p role="alert" className="text-xs text-destructive">{t(`contacts.migrationServer_${error}`)}</p>}
  </div>
 </details>;
}
