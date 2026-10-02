'use client';
import {useEffect,useRef,useState} from 'react';
import Link from '@/components/i18n/locale-link';
import {useT} from '@/hooks/use-locale';
import {useFormat} from '@/hooks/use-format';
import {useFetchWithCsrf} from '@/lib/api/fetch-with-csrf';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {returnRefundContext,returnRefundInput,preparedReturnRefund,type ReturnRefundContext,type PreparedReturnRefund} from '@/lib/returns/refund-link-contract';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';

export function ReturnRefundPreparation({caseId}:{caseId:string}){
 const t=useT(),format=useFormat(),csrf=useFetchWithCsrf();
 const [context,setContext]=useState<ReturnRefundContext|null>(null),[proposal,setProposal]=useState<PreparedReturnRefund|null>(null),[amount,setAmount]=useState(''),[reason,setReason]=useState('');
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const request=useRef<AbortController|null>(null),pending=useRef<{signature:string;id:string}|null>(null);
 useEffect(()=>()=>request.current?.abort(),[]);
 async function load(){
  request.current?.abort();const controller=new AbortController();request.current=controller;setLoading(true);setError(null);setContext(null);setProposal(null);
  try{const response=await fetch(`/api/devoluciones/${encodeURIComponent(caseId)}/reembolso`,{cache:'no-store',signal:controller.signal});const data=await response.json();
   if(!response.ok){if(!controller.signal.aborted&&request.current===controller)setError(typeof data.error==='string'?data.error:t('returns.refundUnavailable'));return;}const parsed=returnRefundContext.parse(data);if(parsed.case_id!==caseId)throw Error('unconfirmed');
   if(!controller.signal.aborted&&request.current===controller)setContext(parsed);
  }catch{if(!controller.signal.aborted&&request.current===controller)setError(t('returns.refundUnavailable'));}
  finally{if(!controller.signal.aborted&&request.current===controller)setLoading(false);}
 }
 async function prepare(){
  if(!context||busy)return;const raw={receipt_id:context.receipt.id,amount:amount.trim()?Number(amount):null,reason:reason.trim()};const signature=JSON.stringify(raw);
  if(pending.current?.signature!==signature)pending.current={signature,id:crypto.randomUUID()};
  const parsed=returnRefundInput.safeParse({...raw,id:pending.current.id});if(!parsed.success){setError(t('returns.refundInvalid'));return;}
  const operation=parsed.data;setBusy(true);setError(null);
  try{
   const response=await csrf(`/api/devoluciones/${encodeURIComponent(caseId)}/reembolso`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(operation)});const data=await response.json();
   if(!response.ok){setError(typeof data.error==='string'?data.error:t('returns.refundUnavailable'));return;}
   const result=preparedReturnRefund.parse(data);if(result.case_id!==caseId||result.operation_id!==operation.id||result.receipt.id!==operation.receipt_id||result.conversation_id!==context.conversation_id)throw Error('unconfirmed');
   setProposal(result);pending.current=null;
  }catch{setError(t('returns.refundUnavailable'));}finally{setBusy(false);}
 }
 if(!SHOW_RIVERZ_IMPROVEMENTS)return null;
 return <details className="mt-3 border-t pt-3" onToggle={event=>{if(event.currentTarget.open)void load();else{request.current?.abort();setLoading(false);}}}>
  <summary className="cursor-pointer text-xs font-medium">{t('returns.refundPrepare')}</summary>
  <div className="mt-3 space-y-3 text-xs">
   <p className="text-muted-foreground">{t('returns.refundPrepareScope')}</p>
   {loading&&<p role="status">{t('common.loading')}</p>}
   {error&&<div role="alert"><p>{error}</p>{!context&&<Button size="sm" variant="outline" onClick={()=>void load()}>{t('common.retry')}</Button>}</div>}
   {context&&!proposal&&<fieldset disabled={busy||loading} className="space-y-3">
    <p>{t('returns.refundReceipt',{reference:context.receipt.reference,quantity:format.number(context.receipt.quantity),condition:t(`returns.receipt_${context.receipt.condition}`)})}</p>
    <label className="block">{t('returns.refundAmount')}<Input type="number" min="0.000001" step="0.000001" value={amount} onChange={event=>setAmount(event.target.value)} placeholder={t('returns.refundRemaining')}/></label>
    <label className="block">{t('returns.refundReason')}<Input value={reason} maxLength={300} onChange={event=>setReason(event.target.value)}/></label>
    <Button size="sm" onClick={()=>void prepare()}>{t('returns.refundPrepare')}</Button>
   </fieldset>}
   {proposal&&<div className="space-y-2">
    <p className="font-medium">{t('returns.refundProposalAmount',{amount:format.currency(Number(proposal.amount),proposal.currency,{maximumFractionDigits:6})})}</p>
    <p>{t(`inbox.orderStatus.${proposal.status}`)}</p><p>{t('returns.refundPreparedScope')}</p><time dateTime={proposal.expires_at}>{t('returns.refundExpires',{date:format.dateTime(proposal.expires_at)})}</time>
    <Link className="block underline" href={`/bandeja?c=${encodeURIComponent(proposal.conversation_id)}`}>{t('returns.refundReview')}</Link>
   </div>}
  </div>
 </details>;
}
