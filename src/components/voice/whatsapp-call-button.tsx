'use client';
import {useEffect,useRef,useState} from 'react';
import {Loader2,PhoneCall} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle,DialogTrigger} from '@/components/ui/dialog';
import {useT} from '@/hooks/use-locale';
import {useFetchWithCsrf} from '@/lib/api/fetch-with-csrf';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {whatsappPeer} from '@/lib/voice/whatsapp-calling-contract';
import {z} from 'zod';
const receiptSchema=z.object({callId:z.string().uuid(),contactId:z.string().uuid(),state:z.enum(['starting','initiated','accepted','connecting','connected','terminated','uncertain']),status:z.string(),cleanupState:z.enum(['not_requested','pending','acknowledged','uncertain']),providerEnded:z.boolean()}).passthrough();
const terminal=new Set(['completed','failed','no_answer','busy','voicemail','canceled']);
export function WhatsAppCallButton({workspaceId,contactId,name,phone}:{workspaceId:string;contactId:string;name:string|null;phone:string}){
 const t=useT(),fetch=useFetchWithCsrf(),version=useRef(0),inFlight=useRef(false),attempt=useRef('');
 const [open,setOpen]=useState(false),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState<z.infer<typeof receiptSchema>|null>(null),[pending,setPending]=useState(false),[retrySame,setRetrySame]=useState(false);
 const peer=phone.replace(/^\+/,''),storageKey=`riverz:whatsapp-call:${workspaceId}:${contactId}`;
 useEffect(()=>{
  const lifecycle=version;++lifecycle.current;inFlight.current=false;attempt.current='';setOpen(false);setConfirmed(false);setBusy(false);setError('');setReceipt(null);setPending(false);setRetrySame(false);
  if(SHOW_RIVERZ_IMPROVEMENTS){try{const previous=sessionStorage.getItem(storageKey);if(previous&&z.string().uuid().safeParse(previous).success){attempt.current=previous;setPending(true);}}catch{/* Starting requires saving the attempt before the request. */}}
  return()=>{lifecycle.current++;};
 },[storageKey,phone]);
 if(!SHOW_RIVERZ_IMPROVEMENTS)return null;
 function remember(id:string){sessionStorage.setItem(storageKey,id);attempt.current=id;setPending(true);}
 async function recover(){
  if(!attempt.current||inFlight.current)return;const generation=version.current;inFlight.current=true;setBusy(true);setError('');
  try{const response=await fetch(`/api/voice/whatsapp?callId=${encodeURIComponent(attempt.current)}`,{cache:'no-store',headers:{'x-workspace-id':workspaceId}});const data=await response.json();
   if(response.status===404&&data.code==='attemptNotFound'){
    if(version.current===generation){setPending(false);setConfirmed(false);setRetrySame(true);setReceipt(null);}return;
   }
   if(!response.ok)throw new Error(response.status===404?'uncertain':['notAllowed','uncertain'].includes(data.code)?data.code:'unavailable');
   const parsed=receiptSchema.safeParse(data);if(!parsed.success||parsed.data.callId!==attempt.current||parsed.data.contactId!==contactId)throw new Error('uncertain');
   if(version.current===generation)setReceipt(parsed.data);
  }catch(cause){if(version.current===generation)setError(cause instanceof Error&&['notAllowed','uncertain','unavailable'].includes(cause.message)?cause.message:'unavailable');}finally{if(version.current===generation){inFlight.current=false;setBusy(false);}}
 }
 async function start(){
  if(!confirmed||!whatsappPeer.safeParse(peer).success||inFlight.current)return;const generation=version.current;inFlight.current=true;setBusy(true);setError('');
  try{
   const id=attempt.current||crypto.randomUUID();remember(id);setRetrySame(false);
   const response=await fetch('/api/voice/whatsapp',{method:'POST',headers:{'Content-Type':'application/json','x-workspace-id':workspaceId},body:JSON.stringify({action:'call',contactId,attemptId:id,expectedPeer:peer,confirmed:true})});
   const data=await response.json();if(!response.ok||data.callId!==id)throw new Error(['invalid','notAllowed','uncertain','unavailable'].includes(data.code)?data.code:'uncertain');
   const value=data.receipt??{callId:id,contactId,state:'initiated',status:'dialing',cleanupState:'not_requested',providerEnded:false};const parsed=receiptSchema.safeParse(value);
   if(!parsed.success||parsed.data.callId!==id||parsed.data.contactId!==contactId)throw new Error('uncertain');
   if(version.current===generation)setReceipt(parsed.data);
  }catch(cause){if(version.current===generation)setError(cause instanceof Error&&['invalid','notAllowed','uncertain','unavailable'].includes(cause.message)?cause.message:'uncertain');}finally{if(version.current===generation){inFlight.current=false;setBusy(false);}}
 }
 const canPrepareNew=receipt&&terminal.has(receipt.status)&&(receipt.providerEnded||receipt.cleanupState==='acknowledged'||(receipt.state==='terminated'&&receipt.cleanupState==='not_requested'));
 function newCall(){if(!canPrepareNew||busy)return;try{sessionStorage.removeItem(storageKey);}catch{setError('unavailable');return;}attempt.current='';setReceipt(null);setPending(false);setConfirmed(false);setError('');}
 return <Dialog open={open} onOpenChange={next=>{setOpen(next);if(!next)setConfirmed(false);}}>
  <DialogTrigger render={<Button variant="outline" size="sm" className="w-full"/>}><PhoneCall className="size-3.5"/>{t('voice.whatsappCall')}</DialogTrigger>
  <DialogContent>
   <DialogHeader><DialogTitle>{t('voice.whatsappCall')}</DialogTitle><DialogDescription>{t('voice.whatsappCallNote')}</DialogDescription></DialogHeader>
   <p className="break-words text-sm">{name??t('voice.whatsappContact')} · {phone}</p>
   {retrySame&&<p role="status" className="text-xs">{t('voice.whatsappReviewSame')}</p>}
   {!pending&&<label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} disabled={busy}/>{t('voice.whatsappConfirm')}</label>}
   {receipt&&<p role="status" className="text-sm">{t(`voice.whatsappState_${terminal.has(receipt.status)?'terminated':receipt.state}`)}</p>}
   {error&&<p role="alert" className="text-destructive text-xs">{t(`voice.whatsappError_${error}`)}</p>}
   <DialogFooter>
    {pending?<Button onClick={recover} disabled={busy}>{busy?<Loader2 className="size-4 animate-spin"/>:t('voice.whatsappRecover')}</Button>:<Button onClick={start} disabled={busy||!confirmed||!whatsappPeer.safeParse(peer).success}>{busy?<Loader2 className="size-4 animate-spin"/>:t('voice.whatsappStart')}</Button>}
    {canPrepareNew&&<Button variant="outline" onClick={newCall} disabled={busy}>{t('voice.whatsappNewCall')}</Button>}
   </DialogFooter>
  </DialogContent>
 </Dialog>;
}
