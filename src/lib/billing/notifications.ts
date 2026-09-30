import type { SupabaseClient } from '@supabase/supabase-js';
import { pendingSubscriptionPayment, type PendingPayment } from './pending-payment';
import { destinosDeAviso } from '@/lib/avisos/destinos';
import { sendPlatformAlert } from '@/lib/admin/platform-whatsapp';
import { enviarCorreo } from '@/lib/admin/correo';
import { localeDeCuenta } from '@/lib/i18n/cuenta';
import { translate } from '@/lib/i18n/translate';
import type { Locale } from '@/lib/i18n/config';
import { aplicarEvento, stripe, stripeDisponible } from './stripe';
import type Stripe from 'stripe';
import { createHash } from 'node:crypto';

export type BillingPhase = 'pending' | 'reminder6' | 'reminder1' | 'paused' | 'active';
export function billingPhase(payment: PendingPayment | null, now=Date.now()): BillingPhase {
  if (!payment) return 'active';
  const remaining=Date.parse(payment.graceUntil)-now;
  if (remaining<=0) return 'paused';
  if (remaining<=3_600_000) return 'reminder1';
  if (remaining<=6*3_600_000) return 'reminder6';
  return 'pending';
}

export function billingNoticeMessage(phase: BillingPhase, locale: Locale, args: {
  name: string; payment: PendingPayment | null; timezone?: string;
}) {
  const keys={
    pending: ['settings.billingPendingTitle','settings.billingPendingBody'],
    reminder6: ['settings.billingReminder6Title','settings.billingReminder6Body'],
    reminder1: ['settings.billingReminder1Title','settings.billingReminder1Body'],
    paused: ['settings.billingPausedTitle','settings.billingPausedBody'],
    active: ['settings.billingActiveTitle','settings.billingActiveBody'],
  } as const;
  let date='';
  if (args.payment) {
    let timezone=args.timezone || 'UTC';
    try { new Intl.DateTimeFormat('en',{timeZone:timezone}); } catch { timezone='UTC'; }
    date=new Intl.DateTimeFormat(locale==='es'?'es-CO':'en-US',{
      dateStyle:'medium',timeStyle:'short',timeZone:timezone,
    }).format(new Date(args.payment.graceUntil))+' ('+timezone+')';
  }
  const url=phase==='active'?'https://riverz.co/bandeja':
    args.payment?.invoiceUrl || 'https://riverz.co/ajustes?tab=billing';
  return {title:translate(locale,keys[phase][0]),
    body:translate(locale,keys[phase][1],{nombre:args.name,fecha:date,url})};
}

async function accountState(db: SupabaseClient, workspaceId: string) {
  const payment=await pendingSubscriptionPayment(db,workspaceId);
  const sub=await db.from('workspace_subscriptions').select('estado,vencida_desde,stripe_customer_id')
    .eq('workspace_id',workspaceId).maybeSingle();
  if(sub.error)throw new Error('billing_notice_subscription_unavailable');
  if(!payment && sub.data?.estado==='vencida' && sub.data.vencida_desde) {
    const graceUntil=new Date(Date.parse(sub.data.vencida_desde)+24*3_600_000).toISOString();
    const legacy: PendingPayment={invoiceId:'legacy:'+workspaceId+':'+sub.data.vencida_desde,
      invoiceUrl:null,graceUntil,blocked:Date.parse(graceUntil)<=Date.now(),
      hours:Math.max(0,Math.ceil((Date.parse(graceUntil)-Date.now())/3_600_000))};
    return {payment:legacy,phase:billingPhase(legacy),sub:sub.data};
  }
  return {payment,phase:billingPhase(payment),sub:sub.data};
}

async function accountInfo(db: SupabaseClient, workspaceId: string, customerId?: string|null) {
  const workspace=await db.from('workspaces').select('name,owner_id').eq('id',workspaceId).single();
  if(workspace.error)throw new Error('billing_notice_account_unavailable');
  const locale=await localeDeCuenta(db,workspaceId);
  const emails=new Set<string>();
  const owner=await db.auth.admin.getUserById(workspace.data.owner_id);
  if(owner.data.user?.email)emails.add(owner.data.user.email.trim().toLowerCase());
  if(customerId && stripeDisponible()) {
    try {
      const customer=await stripe().customers.retrieve(customerId);
      if(!('deleted' in customer && customer.deleted) && customer.email)emails.add(customer.email.trim().toLowerCase());
    } catch { /* The owner's email and WhatsApp still work if Stripe is unavailable. */ }
  }
  const profile=await db.from('profiles').select('timezone').eq('user_id',workspace.data.owner_id).maybeSingle();
  return {name:workspace.data.name || 'Riverz',locale,emails:[...emails],timezone:profile.data?.timezone as string|undefined};
}

type Notice={id:string;workspace_id:string;invoice_id:string;phase:BillingPhase;channel:'whatsapp'|'email';
  recipient:string;lease_id:string;attempts:number};

/** Durable, independent delivery by invoice, phase, recipient and channel. No daily suppression. */
export async function maintainBillingNotifications(db: SupabaseClient) {
  const candidates=await db.rpc('billing_notice_accounts');
  if(candidates.error)throw new Error('billing_notice_discovery_unavailable');
  const accounts=new Map<string,Set<string>>();
  for(const row of candidates.data??[]) {
    const invoices=accounts.get(row.workspace_id)??new Set<string>();
    invoices.add(row.invoice_id);accounts.set(row.workspace_id,invoices);
  }
  const failures:string[]=[];
  for(const [workspaceId,invoices] of accounts) {
    try {
      const state=await accountState(db,workspaceId);
      if(state.phase==='active' && !['activa','prueba'].includes(state.sub?.estado??'')) {
        const cancelled=await db.from('workspace_billing_notices').update({status:'cancelled'})
          .eq('workspace_id',workspaceId).eq('status','pending');
        if(cancelled.error)throw cancelled.error;
        continue; // A cancelled or separately suspended subscription must not promise activation.
      }
      const previous=await db.from('workspace_billing_notices').select('invoice_id,phase')
        .eq('workspace_id',workspaceId).in('invoice_id',[...invoices]);
      if(previous.error)throw previous.error;
      const invoiceIds=state.payment?[state.payment.invoiceId]:
        [...invoices].filter(id=>previous.data?.some(n=>n.invoice_id===id && n.phase!=='active'));
      const info=await accountInfo(db,workspaceId,state.sub?.stripe_customer_id);
      const phones=await destinosDeAviso(db,workspaceId,'plata').catch(()=>[] as string[]);
      if(!phones.length)failures.push(workspaceId+':missing_whatsapp_recipient');
      if(!info.emails.length)failures.push(workspaceId+':missing_email_recipient');
      const rows=invoiceIds.flatMap(invoiceId=>[
        ...phones.map(recipient=>({workspace_id:workspaceId,invoice_id:invoiceId,phase:state.phase,channel:'whatsapp',recipient})),
        ...info.emails.map(recipient=>({workspace_id:workspaceId,invoice_id:invoiceId,phase:state.phase,channel:'email',recipient})),
      ]);
      if(rows.length) {
        const saved=await db.from('workspace_billing_notices').upsert(rows,{
          onConflict:'workspace_id,invoice_id,phase,channel,recipient',ignoreDuplicates:true,
        });
        if(saved.error)throw saved.error;
      } else if(invoiceIds.length) failures.push(workspaceId+':missing_billing_recipient');
      const stale=await db.from('workspace_billing_notices').update({status:'cancelled'})
        .eq('workspace_id',workspaceId).eq('status','pending').neq('phase',state.phase);
      if(stale.error)throw stale.error;
    } catch {failures.push(workspaceId+':billing_notice_preparation_failed');}
  }
  const claimed=await db.rpc('claim_billing_notices',{p_limit:20});
  if(claimed.error)throw new Error('billing_notice_claim_failed');
  let sent=0;
  const deadline=Date.now()+70_000;
  for(const notice of (claimed.data??[]) as Notice[]) {
    if(Date.now()>deadline)break;
    let ok=false,obsolete=false;
    try {
      // Recheck immediately before every send: payment or expiry cancels old reminders.
      if(notice.invoice_id.startsWith('in_') && stripeDisponible()) {
        await aplicarEvento(db,{type:'invoice.updated',data:{object:{id:notice.invoice_id}}} as unknown as Stripe.Event,false);
      }
      const state=await accountState(db,notice.workspace_id);
      obsolete=state.phase!==notice.phase ||
        (state.payment!==null && state.payment.invoiceId!==notice.invoice_id) ||
        (notice.phase==='active' && !['activa','prueba'].includes(state.sub?.estado??''));
      if(!obsolete) {
        const info=await accountInfo(db,notice.workspace_id,state.sub?.stripe_customer_id);
        const message=billingNoticeMessage(notice.phase,info.locale,{...info,payment:state.payment});
        if(notice.channel==='whatsapp') {
          const result=await sendPlatformAlert({to:notice.recipient,...message});
          ok=result.ok && Boolean(result.messageId);
        } else {
          const key=createHash('sha256').update(notice.id).digest('hex');
          ok=await enviarCorreo(notice.recipient,message.title,message.body,'billing/'+key);
        }
      }
    } catch { /* Retry the failed channel independently. Never mark a failed send as delivered. */ }
    const status=obsolete?'cancelled':ok?'sent':'pending';
    const retryMs=Math.min(6*3_600_000,60_000*2**Math.min(notice.attempts,8));
    const updated=await db.from('workspace_billing_notices').update({
      status,lease_id:null,lease_until:null,
      ...(ok?{sent_at:new Date().toISOString()}:{next_attempt_at:new Date(Date.now()+retryMs).toISOString()}),
    }).eq('id',notice.id).eq('lease_id',notice.lease_id);
    if(updated.error)failures.push(notice.workspace_id+':billing_notice_persistence_failed');
    if(!ok && !obsolete)failures.push(notice.workspace_id+':'+notice.channel+'_delivery_retry');
    if(ok)sent++;
  }
  return {sent,failures};
}
