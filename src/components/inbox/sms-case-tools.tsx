'use client';
import {useEffect,useRef,useState} from 'react';
import {Loader2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {useT} from '@/hooks/use-locale';
import {useFetchWithCsrf} from '@/lib/api/fetch-with-csrf';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {smsEncoding,smsPhone} from '@/lib/integrations/expansion/sms-contract';
import {smsPeerPolicy,smsReceipt,type NativeSmsReceipt} from '@/lib/integrations/expansion/sms-ui-contract';
import {z} from 'zod';
export function SmsCaseTools({workspaceId,conversationId,contactId,connectionId,peer,disabled=false}:{workspaceId:string;conversationId:string;contactId:string;connectionId:string;peer:string;disabled?:boolean}){
 const t=useT(),fetch=useFetchWithCsrf(),version=useRef(0),inFlight=useRef(false),attempt=useRef('');
 const [policy,setPolicy]=useState<z.infer<typeof smsPeerPolicy>|null>(null),[text,setText]=useState(''),[evidence,setEvidence]=useState(''),[consented,setConsented]=useState(false),[confirmed,setConfirmed]=useState(false),[receipt,setReceipt]=useState<NativeSmsReceipt|null>(null),[pending,setPending]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const storageKey=`riverz:sms:${workspaceId}:${conversationId}`,encoding=smsEncoding(text);
 useEffect(()=>{
  const lifecycle=version,generation=++lifecycle.current,controller=new AbortController();inFlight.current=false;attempt.current='';setPolicy(null);setText('');setEvidence('');setConsented(false);setConfirmed(false);setReceipt(null);setPending(false);setBusy(false);setError('');
  if(!SHOW_RIVERZ_IMPROVEMENTS)return;
  try{const id=sessionStorage.getItem(storageKey);if(id&&z.string().uuid().safeParse(id).success){attempt.current=id;setPending(true);}}catch{/* Creating a send requires a successful durable browser receipt. */}
  void(async()=>{try{const response=await fetch(`/api/integrations/sms?view=policy&connectionId=${encodeURIComponent(connectionId)}&peer=${encodeURIComponent(peer)}`,{cache:'no-store',headers:{'x-workspace-id':workspaceId},signal:controller.signal}),raw=await response.json();if(!response.ok)throw new Error(raw.code==='notAllowed'?'notAllowed':'unavailable');const value=smsPeerPolicy.safeParse(raw);if(!value.success||value.data.connectionId!==connectionId)throw new Error('unavailable');if(lifecycle.current===generation)setPolicy(value.data);}catch(cause){if(lifecycle.current===generation)setError(cause instanceof Error&&cause.message==='notAllowed'?'notAllowed':'unavailable');}})();
  return()=>{lifecycle.current++;controller.abort();};
 },[workspaceId,conversationId,contactId,connectionId,peer,storageKey,fetch]);
 if(!SHOW_RIVERZ_IMPROVEMENTS)return null;
 const canSend=!!policy?.enabled&&policy.consent&&!!encoding&&encoding.segments<=policy.maxSegments&&smsPhone.safeParse(peer).success&&!disabled&&!pending;
 function errorCode(raw:unknown){return typeof raw==='string'&&['invalid','notAllowed','uncertain','unavailable'].includes(raw)?raw:'unavailable';}
 function acceptedReceipt(raw:unknown,id:string){const parsed=smsReceipt.safeParse(raw);if(!parsed.success||parsed.data.attemptId!==id||parsed.data.conversationId!==conversationId||parsed.data.contactId!==contactId||parsed.data.peer!==peer)throw new Error('uncertain');return parsed.data;}
 async function recover(){
  if(!attempt.current||inFlight.current)return;const generation=version.current;inFlight.current=true;setBusy(true);setError('');
  try{const response=await fetch(`/api/integrations/sms?view=receipt&attemptId=${encodeURIComponent(attempt.current)}`,{cache:'no-store',headers:{'x-workspace-id':workspaceId}}),raw=await response.json();
   if(response.status===404&&raw.code==='attemptNotFound'){if(version.current===generation){setPending(false);setReceipt(null);setConfirmed(false);}return;}
   if(!response.ok)throw new Error(response.status===404?'uncertain':errorCode(raw.code));const value=acceptedReceipt(raw,attempt.current);if(version.current===generation){setReceipt(value);setText(value.text);setConfirmed(false);}
  }catch(cause){if(version.current===generation)setError(cause instanceof Error?errorCode(cause.message):'unavailable');}finally{if(version.current===generation){inFlight.current=false;setBusy(false);}}
 }
 async function send(){
  if(!confirmed||!canSend||!policy||inFlight.current)return;const generation=version.current;inFlight.current=true;setBusy(true);setError('');
  try{const id=attempt.current||crypto.randomUUID();sessionStorage.setItem(storageKey,id);attempt.current=id;setPending(true);setConfirmed(false);
   const response=await fetch('/api/integrations/sms',{method:'POST',headers:{'Content-Type':'application/json','x-workspace-id':workspaceId},body:JSON.stringify({action:'send',attemptId:id,conversationId,contactId,connectionId,revision:policy.revision,peer,text,confirmed:true})}),raw=await response.json();if(!response.ok)throw new Error(errorCode(raw.code));const value=acceptedReceipt(raw.receipt,id);if(value.text!==text)throw new Error('uncertain');if(version.current===generation)setReceipt(value);
  }catch(cause){if(version.current===generation)setError(cause instanceof Error?errorCode(cause.message):'uncertain');}finally{if(version.current===generation){inFlight.current=false;setBusy(false);}}
 }
 async function saveConsent(allow:boolean){
  if(!policy||inFlight.current||disabled||allow&&(!consented||!evidence.trim()||policy.consentSource==='STOP'))return;const generation=version.current;inFlight.current=true;setBusy(true);setError('');
  try{const response=await fetch('/api/integrations/sms',{method:'POST',headers:{'Content-Type':'application/json','x-workspace-id':workspaceId},body:JSON.stringify({action:'consent',connectionId,peer,consented:allow,evidence:evidence.trim()||'Business withdrew SMS consent'})}),raw=await response.json();if(!response.ok||raw.saved!==true)throw new Error(errorCode(raw.code));
   // Read back current authority; never turn a POST acknowledgement into a
   // guessed consent grant when a customer STOP races this UI.
   const current=await fetch(`/api/integrations/sms?view=policy&connectionId=${encodeURIComponent(connectionId)}&peer=${encodeURIComponent(peer)}`,{cache:'no-store',headers:{'x-workspace-id':workspaceId}}),value=smsPeerPolicy.safeParse(await current.json());if(!current.ok||!value.success||value.data.connectionId!==connectionId)throw new Error('unavailable');if(version.current===generation){setPolicy(value.data);setEvidence('');setConsented(false);setConfirmed(false);}
  }catch(cause){if(version.current===generation)setError(cause instanceof Error?errorCode(cause.message):'unavailable');}finally{if(version.current===generation){inFlight.current=false;setBusy(false);}}
 }
 function prepareNew(){if(!receipt||!['accepted','canceled'].includes(receipt.state)||inFlight.current)return;try{sessionStorage.removeItem(storageKey);}catch{setError('unavailable');return;}attempt.current='';setPending(false);setReceipt(null);setText('');setConfirmed(false);setError('');}
 return <div className="min-w-0 space-y-3 border-t border-border p-3 sm:p-4">
  <p className="text-xs font-medium">{peer} · SMS</p>
  {policy&&<details><summary className="cursor-pointer text-xs text-muted-foreground">{t(policy.consent?'settings.smsConsentPresent':'settings.smsConsentMissing')}</summary><fieldset disabled={busy||disabled} className="mt-2 space-y-2">
   {policy.consentSource==='STOP'&&!policy.consent?<p className="text-xs">{t('settings.smsConsentStop')}</p>:!policy.consent?<>
    <label className="block space-y-1 text-xs">{t('settings.smsConsentEvidence')}<Textarea maxLength={1000} value={evidence} onChange={event=>setEvidence(event.target.value)}/></label>
    <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={consented} onChange={event=>setConsented(event.target.checked)}/>{t('settings.smsConsentConfirm')}</label>
    <Button size="sm" disabled={busy||!consented||!evidence.trim()} onClick={()=>void saveConsent(true)}>{t('settings.smsConsentSave')}</Button>
   </>:<Button variant="outline" size="sm" onClick={()=>void saveConsent(false)}>{t('settings.smsConsentRevoke')}</Button>}
  </fieldset></details>}
  <label className="block space-y-1 text-xs">{t('settings.smsComposer')}<Textarea data-inbox-composer value={text} maxLength={6700} disabled={busy||disabled||pending} onChange={event=>{setText(event.target.value);setConfirmed(false);}}/></label>
  {encoding&&<p className="text-xs text-muted-foreground">{t('settings.smsSegments',{count:encoding.segments,encoding:encoding.encoding})}</p>}
  {!pending&&<><label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} disabled={busy||!canSend} onChange={event=>setConfirmed(event.target.checked)}/>{t('settings.smsSendReview',{phone:peer})}</label><Button size="sm" disabled={busy||!canSend||!confirmed} onClick={send}>{busy?<Loader2 className="size-4 animate-spin"/>:t('settings.smsSend')}</Button></>}
  {pending&&<Button variant="outline" size="sm" disabled={busy} onClick={recover}>{busy?<Loader2 className="size-4 animate-spin"/>:t('settings.smsRecover')}</Button>}
  {receipt&&<div role="status" className="space-y-1 text-xs"><p>{t(`settings.smsState_${receipt.state}`)}</p>{receipt.providerStatus&&<p>{t(`settings.smsStatus_${receipt.providerStatus}`)} · {t(receipt.deliveryConfirmed?'settings.smsDeliveryConfirmed':'settings.smsDeliveryPending')}</p>}<p>{receipt.cost?`${receipt.cost.amount} ${receipt.cost.currency}`:t('settings.smsCostUnknown')}</p>{['accepted','canceled'].includes(receipt.state)&&<Button variant="outline" size="sm" disabled={busy} onClick={prepareNew}>{t('settings.smsPrepareNew')}</Button>}</div>}
  {error&&<p role="alert" className="text-xs text-destructive">{t(`settings.smsError_${errorCode(error)}`)}</p>}
 </div>;
}
