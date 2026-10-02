'use client';
import {useEffect,useRef,useState} from 'react';
import {useT} from '@/hooks/use-locale';
import {useFormat} from '@/hooks/use-format';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {MIGRATION_FIELDS,MIGRATION_PROVIDERS,MIGRATION_MAX_BYTES,MigrationPreviewError,readMigrationCsv,previewContactMigration,type MigrationProvider,type MigrationMapping} from '@/lib/migrations/contact-preview';
import {MigrationImportReview} from './migration-import-review';
import {NativeMigration} from './native-migration';

const emptyMapping=():MigrationMapping=>({sourceId:-1,phone:-1,name:-1,email:-1,company:-1});
export function MigrationPreview({onImported}:{onImported?:()=>void}={}) {
  const t=useT(),fmt=useFormat(),version=useRef(0),fileInput=useRef<HTMLInputElement>(null);
  const [provider,setProvider]=useState<MigrationProvider>('chatwoot'),[account,setAccount]=useState('');
  const [data,setData]=useState<ReturnType<typeof readMigrationCsv>|null>(null),[mapping,setMapping]=useState<MigrationMapping>(emptyMapping);
  const [csv,setCsv]=useState('');
  const [generation,setGeneration]=useState(0);
  const [nativeGeneration,setNativeGeneration]=useState(0);
  const [preview,setPreview]=useState<ReturnType<typeof previewContactMigration>|null>(null),[error,setError]=useState(''),[reading,setReading]=useState(false);
  useEffect(()=>()=>{version.current++;},[]);
  if(!SHOW_RIVERZ_IMPROVEMENTS)return null;
  function invalidate(){version.current++;setGeneration(value=>value+1);setPreview(null);setError('');setReading(false);}
  async function load(file:File|undefined) {
    const request=++version.current;setGeneration(value=>value+1);setData(null);setCsv('');setMapping(emptyMapping());setPreview(null);setError('');setReading(false);
    if(!file)return;
    setReading(true);
    try {
      if(file.size>MIGRATION_MAX_BYTES)throw new MigrationPreviewError('size');
      const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer()),parsed=readMigrationCsv(text);
      if(version.current===request){setData(parsed);setCsv(text);}
    } catch(cause) {if(version.current===request)setError(cause instanceof MigrationPreviewError?cause.code:'csv');}
    finally {if(version.current===request)setReading(false);}
  }
  function review() {
    setPreview(null);setError('');if(!data)return;
    try{setPreview(previewContactMigration({provider,account,...data,mapping}));}
    catch(cause){setError(cause instanceof MigrationPreviewError?cause.code:'csv');}
  }
  const inputClass='min-w-0 w-full rounded border border-border bg-card p-2 text-sm';
  return <details className="rounded-lg border border-border p-3" onToggle={event=>{if(event.target!==event.currentTarget)return;if(!event.currentTarget.open){invalidate();setNativeGeneration(value=>value+1);setData(null);setCsv('');setMapping(emptyMapping());if(fileInput.current)fileInput.current.value='';}}}>
    <summary className="cursor-pointer text-sm font-medium">{t('contacts.migrationTitle')}</summary>
    <div className="mt-3 space-y-3">
      <NativeMigration key={`native:${nativeGeneration}`} onImported={onImported}/>
      <p className="text-xs text-muted-foreground">{t('contacts.migrationScope')}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-xs">{t('contacts.migrationProvider')}<select className={inputClass} value={provider} onChange={event=>{invalidate();setProvider(event.target.value as MigrationProvider);}}>{MIGRATION_PROVIDERS.map(value=><option key={value} value={value}>{value==='kommo'?'Kommo':value==='leadsales'?'Leadsales':value==='manychat'?'ManyChat':value==='chatwoot'?'Chatwoot':value==='gorgias'?'Gorgias':'Zendesk'}</option>)}</select></label>
        <label className="space-y-1 text-xs">{t('contacts.migrationAccount')}<input className={inputClass} maxLength={160} value={account} onChange={event=>{invalidate();setAccount(event.target.value);}} /></label>
      </div>
      <label className="block space-y-1 text-xs">{t('contacts.migrationFile')}<input ref={fileInput} className={inputClass} type="file" accept=".csv,text/csv" onChange={event=>void load(event.target.files?.[0])} /></label>
      {data&&<div className="grid gap-2 sm:grid-cols-2">{MIGRATION_FIELDS.map(field=><label key={field} className="space-y-1 text-xs">{t(`contacts.migrationField_${field}`)}<select className={inputClass} value={mapping[field]} onChange={event=>{invalidate();setMapping(previous=>({...previous,[field]:Number(event.target.value)}));}}><option value={-1}>{t('contacts.columnNone')}</option>{data.headers.map((header,index)=><option key={index} value={index}>{header||`#${index+1}`}</option>)}</select></label>)}</div>}
      {data&&<button type="button" disabled={reading} className="rounded border border-border px-3 py-2 text-sm disabled:opacity-50" onClick={review}>{t('contacts.migrationReview')}</button>}
      {error&&<p role="alert" className="text-xs text-destructive">{t(`contacts.migrationError_${error}`)}</p>}
      {preview&&<div className="space-y-2">
        <p className="text-xs">{t('contacts.migrationCounts',{ready:fmt.number(preview.reviewable),excluded:fmt.number(preview.excluded)})}</p>
        <p className="text-xs text-muted-foreground">{t('contacts.migrationIdentityScope')}</p>
        <div className="max-h-64 overflow-auto rounded border border-border"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">{t('contacts.migrationField_sourceId')}</th><th className="p-2">{t('contacts.colPhone')}</th><th className="p-2">{t('contacts.migrationStatus')}</th></tr></thead><tbody>{preview.rows.slice(0,25).map(row=><tr key={row.row} className="border-t border-border"><td className="max-w-28 break-all p-2">{row.sourceId||'—'}</td><td className="whitespace-nowrap p-2">{row.phone||'—'}</td><td className="p-2">{row.issues.length?row.issues.map(issue=>t(`contacts.migrationIssue_${issue}`)).join(' · '):t('contacts.migrationReviewable')}</td></tr>)}</tbody></table></div>
        {preview.rows.length>25&&<p className="text-xs text-muted-foreground">{t('contacts.migrationSample',{count:fmt.number(preview.rows.length)})}</p>}
      </div>}
      <MigrationImportReview key={`csv:${generation}`} input={preview?{provider,account,csv,mapping}:null} onImported={onImported}/>
    </div>
  </details>;
}
