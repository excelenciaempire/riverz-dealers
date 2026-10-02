'use client';
import {useEffect,useRef,useState} from 'react';
import {z} from 'zod';
import {Loader2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {useT} from '@/hooks/use-locale';
import {useWorkspace} from '@/hooks/use-workspace';
import {useFetchWithCsrf} from '@/lib/api/fetch-with-csrf';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {storeReviewPage,reviewReplyText,reviewReplyReceipt,type NativeReviewReplyReceipt} from '@/lib/integrations/expansion/review-ui-contract';

const pendingSchema=z.object({attemptId:z.string().uuid(),connectionId:z.string().uuid(),reviewId:z.number().int().positive().max(Number.MAX_SAFE_INTEGER)}).strict();
type Pending=z.infer<typeof pendingSchema>;
type Page=z.infer<typeof storeReviewPage>;
export function StoreReviews(){return SHOW_RIVERZ_IMPROVEMENTS?<WorkspaceReviews/>:null;}
function WorkspaceReviews(){const {workspace}=useWorkspace();return workspace?<StoreReviewTools key={workspace.id} workspaceId={workspace.id}/>:null;}
/** Only an explicit opening loads provider data. Recovery is independent of
 * provider availability, so a paused/uninstalled store can still be checked. */
export function StoreReviewTools({workspaceId}:{workspaceId:string}){
 const t=useT(),fetch=useFetchWithCsrf(),version=useRef(0),inFlight=useRef(false),pendingRef=useRef<Pending|null>(null);
 const [page,setPage]=useState<Page|null>(null),[selected,setSelected]=useState<number|null>(null),[text,setText]=useState(''),[confirmed,setConfirmed]=useState(false),[storefront,setStorefront]=useState(false),[pending,setPending]=useState<Pending|null>(null),[receipt,setReceipt]=useState<NativeReviewReplyReceipt|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const storageKey=`riverz:review:${workspaceId}`;
 useEffect(()=>{
  const lifecycle=version;lifecycle.current++;inFlight.current=false;pendingRef.current=null;setPage(null);setSelected(null);setText('');setConfirmed(false);setStorefront(false);setPending(null);setReceipt(null);setBusy(false);setError('');
  if(SHOW_RIVERZ_IMPROVEMENTS)try{const raw=sessionStorage.getItem(storageKey);if(raw){const parsed=pendingSchema.safeParse(JSON.parse(raw));if(!parsed.success)throw new Error('invalid');pendingRef.current=parsed.data;setPending(parsed.data);}}catch{setError('unavailable');}
  return()=>{lifecycle.current++;};
 },[workspaceId,storageKey]);
 if(!SHOW_RIVERZ_IMPROVEMENTS)return null;
 function code(value:unknown){return typeof value==='string'&&['invalid','notAllowed','uncertain'].includes(value)?value:'unavailable';}
 async function load(number=1){
  if(inFlight.current)return;const generation=version.current;inFlight.current=true;setBusy(true);setError('');setSelected(null);setText('');setConfirmed(false);setStorefront(false);
  try{const response=await fetch(`/api/integrations/reviews?view=page&page=${number}`,{cache:'no-store',headers:{'x-workspace-id':workspaceId}}),raw=await response.json();if(!response.ok)throw new Error(code(raw.code));const parsed=storeReviewPage.safeParse(raw);if(!parsed.success||parsed.data.configured&&parsed.data.page!==number)throw new Error('unavailable');if(version.current===generation)setPage(parsed.data);}
  catch(cause){if(version.current===generation){setPage(null);setError(code(cause instanceof Error?cause.message:null));}}finally{if(version.current===generation){inFlight.current=false;setBusy(false);}}
 }
 function acceptReceipt(raw:unknown,target:Pending,expectedText?:string){const parsed=reviewReplyReceipt.safeParse(raw);if(!parsed.success||parsed.data.attemptId!==target.attemptId||parsed.data.connectionId!==target.connectionId||parsed.data.reviewId!==target.reviewId||expectedText!==undefined&&parsed.data.text!==expectedText)throw new Error('uncertain');return parsed.data;}
 async function recover(){
  const target=pendingRef.current;if(!target||inFlight.current)return;const generation=version.current;inFlight.current=true;setBusy(true);setError('');
  try{const response=await fetch(`/api/integrations/reviews?view=receipt&attemptId=${encodeURIComponent(target.attemptId)}`,{cache:'no-store',headers:{'x-workspace-id':workspaceId}}),raw=await response.json();
   if(response.status===404&&raw.code==='attemptNotFound'){sessionStorage.removeItem(storageKey);if(version.current===generation){pendingRef.current=null;setPending(null);setReceipt(null);setConfirmed(false);setStorefront(false);}return;}
   if(!response.ok)throw new Error(response.status===404?'uncertain':code(raw.code));const value=acceptReceipt(raw,target);if(version.current===generation)setReceipt(value);
  }catch(cause){if(version.current===generation)setError(code(cause instanceof Error?cause.message:null));}finally{if(version.current===generation){inFlight.current=false;setBusy(false);}}
 }
 async function publish(){
  if(!page?.configured||selected===null||!confirmed||!storefront||pendingRef.current||inFlight.current||!reviewReplyText.safeParse(text).success)return;
  const row=page.rows.find(value=>value.id===selected);if(!row||row.hidden||row.reply.blocked)return;
  const generation=version.current;inFlight.current=true;setBusy(true);setError('');
  try{const target={attemptId:crypto.randomUUID(),connectionId:page.connectionId,reviewId:row.id};sessionStorage.setItem(storageKey,JSON.stringify(target));pendingRef.current=target;setPending(target);setConfirmed(false);setStorefront(false);
   const response=await fetch('/api/integrations/reviews',{method:'POST',headers:{'Content-Type':'application/json','x-workspace-id':workspaceId},body:JSON.stringify({action:'reply',input:{...target,revision:page.revision,snapshot:row.snapshot,text,confirmed:true,reviewedStorefront:true}})}),raw=await response.json();if(!response.ok)throw new Error(code(raw.code));const value=acceptReceipt(raw.receipt,target,text);if(version.current===generation)setReceipt(value);
  }catch(cause){if(version.current===generation)setError(code(cause instanceof Error?cause.message:null));}finally{if(version.current===generation){inFlight.current=false;setBusy(false);}}
 }
 function closeReceipt(){if(!receipt||!['accepted','canceled'].includes(receipt.state)||inFlight.current)return;try{sessionStorage.removeItem(storageKey);}catch{setError('unavailable');return;}
  if(receipt.state==='accepted')setPage(current=>current?.configured?{...current,rows:current.rows.map(row=>row.id===receipt.reviewId?{...row,reply:{blocked:true,state:'accepted',ownAttemptId:receipt.attemptId}}:row)}:current);
  pendingRef.current=null;setPending(null);setReceipt(null);setSelected(null);setText('');setConfirmed(false);setStorefront(false);setError('');
 }
 function openReply(id:number){if(inFlight.current||pendingRef.current)return;setSelected(id);setText('');setConfirmed(false);setStorefront(false);setError('');}
 function openSaved(target:Pending){if(inFlight.current||pendingRef.current)return;try{sessionStorage.setItem(storageKey,JSON.stringify(target));pendingRef.current=target;setPending(target);setReceipt(null);setSelected(null);setConfirmed(false);setStorefront(false);}catch{setError('unavailable');}}
 return <section className="min-w-0 rounded-2xl border bg-card p-4 sm:p-5"><details onToggle={event=>{if(event.currentTarget.open&&!page&&!inFlight.current&&!pendingRef.current)void load();}}><summary className="cursor-pointer text-sm font-semibold">{t('settings.reviewTitle')}</summary><div className="mt-3 min-w-0 space-y-3">
  {pending&&<div className="space-y-2 rounded-lg border p-3 text-xs"><p>Judge.me · #{pending.reviewId}</p><Button size="sm" variant="outline" disabled={busy} onClick={recover}>{t('settings.reviewRecover')}</Button>
   {receipt&&<div role="status" className="space-y-2"><p>{t(`settings.reviewState_${receipt.state}`)}</p><p className="whitespace-pre-wrap break-words">{receipt.text}</p>{receipt.state!=='canceled'&&<p className="text-muted-foreground">{t('settings.reviewVisibilityPending')}</p>}{['accepted','canceled'].includes(receipt.state)&&<Button variant="outline" size="sm" disabled={busy} onClick={closeReceipt}>{t('settings.reviewCloseReceipt')}</Button>}</div>}
  </div>}
  <Button size="sm" variant="outline" disabled={busy} onClick={()=>void load(page?.configured?page.page:1)}>{busy?<Loader2 className="size-4 animate-spin"/>:t('settings.reviewLoad')}</Button>
  {page&&!page.configured&&<p className="text-xs text-muted-foreground">{t('settings.reviewConfigure')}</p>}
  {page?.configured&&<>
   <p className="break-words text-sm">{page.shopDomain}</p><p className="text-xs text-muted-foreground">{t('settings.reviewPage',{page:page.page,count:page.rows.length})}</p>
   {!page.rows.length&&<p className="text-xs">{t('settings.reviewEmpty')}</p>}
   <ul className="space-y-3">{page.rows.map(row=><li key={row.id} className="min-w-0 rounded-lg border p-3 space-y-2 text-sm"><p className="text-xs text-muted-foreground">#{row.id} · {'★'.repeat(row.rating)}{row.productTitle&&` · ${row.productTitle}`}</p>{row.title&&<p className="break-words font-medium">{row.title}</p>}<p className="whitespace-pre-wrap break-words">{row.body}</p>
    {row.hidden?<p className="text-xs text-muted-foreground">{t('settings.reviewHidden')}</p>:row.reply.blocked?<div className="space-y-2 text-xs"><p>{t(`settings.reviewState_${row.reply.state}`)}</p>{row.reply.ownAttemptId&&<Button variant="outline" size="sm" disabled={busy||!!pending} onClick={()=>openSaved({attemptId:row.reply.ownAttemptId!,connectionId:page.connectionId,reviewId:row.id})}>{t('settings.reviewRecover')}</Button>}</div>:selected!==row.id?<Button size="sm" variant="outline" disabled={busy||!!pending} onClick={()=>openReply(row.id)}>{t('settings.reviewReply')}</Button>:<fieldset disabled={busy||!!pending} className="space-y-2">
     <label className="block space-y-1 text-xs">{t('settings.reviewReplyText')}<Textarea value={text} maxLength={4000} onChange={event=>{setText(event.target.value);setConfirmed(false);setStorefront(false);}}/></label>
     <p className="text-xs text-muted-foreground">{t('settings.reviewPublicNote')}</p>
     <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={storefront} onChange={event=>setStorefront(event.target.checked)}/>{t('settings.reviewStorefront')}</label>
     <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>{t('settings.reviewConfirm',{shop:page.shopDomain,id:row.id})}</label>
     <Button size="sm" disabled={busy||!!pending||!confirmed||!storefront||!reviewReplyText.safeParse(text).success} onClick={publish}>{t('settings.reviewPublish')}</Button>
    </fieldset>}
   </li>)}</ul>
   <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy||page.page===1} onClick={()=>void load(page.page-1)}>{t('settings.reviewPrevious')}</Button><Button size="sm" variant="outline" disabled={busy||!page.hasNext||page.page>=50} onClick={()=>void load(page.page+1)}>{t('settings.reviewNext')}</Button></div>
   {page.hasNext&&page.page>=50&&<p className="text-xs text-muted-foreground">{t('settings.reviewPageLimit')}</p>}
  </>}
  {error&&<p role="alert" className="text-xs text-destructive">{t(`settings.reviewError_${code(error)}`)}</p>}
 </div></details></section>;
}
