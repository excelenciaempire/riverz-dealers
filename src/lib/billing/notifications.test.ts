import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PendingPayment } from './pending-payment';
const mocks=vi.hoisted(()=>({payment:vi.fn(),wa:vi.fn(),email:vi.fn(),stripe:vi.fn()}));
vi.mock('./pending-payment',()=>({pendingSubscriptionPayment:mocks.payment}));
vi.mock('./stripe',()=>({stripeDisponible:()=>true,stripe:()=>({customers:{retrieve:async()=>({email:'owner@example.com'})}}),aplicarEvento:mocks.stripe}));
vi.mock('@/lib/avisos/destinos',()=>({destinosDeAviso:async()=>['15555555555']}));
vi.mock('@/lib/admin/platform-whatsapp',()=>({sendPlatformAlert:mocks.wa}));
vi.mock('@/lib/admin/correo',()=>({enviarCorreo:mocks.email}));
vi.mock('@/lib/i18n/cuenta',()=>({localeDeCuenta:async()=> 'es'}));
import { billingNoticeMessage, billingNoticeSchedule, billingPhase, maintainBillingNotifications } from './notifications';
const now=Date.parse('2026-10-01T00:00:00Z');
const payment:PendingPayment={invoiceId:'in_test',invoiceUrl:'https://invoice.stripe.com/i/pay/test',graceUntil:new Date(now+24*3_600_000).toISOString(),blocked:false,hours:24};
function database(phases:string[]=['reminder6'], scheduleKey=payment.graceUntil) {
 const changes:Array<{table:string;values:Record<string,unknown>;filters:Record<string,unknown>}>=[];
 const db={
  auth:{admin:{getUserById:async()=>({data:{user:{email:'owner@example.com'}}})}},
  rpc:async(name:string)=>({data:name==='billing_notice_accounts'?[]:phases.flatMap((phase,i)=>[
   {id:'wa'+i,workspace_id:'w',invoice_id:'in_test',phase,channel:'whatsapp',recipient:'15555555555',lease_id:'lease',attempts:1,schedule_key:scheduleKey},
   {id:'email'+i,workspace_id:'w',invoice_id:'in_test',phase,channel:'email',recipient:'owner@example.com',lease_id:'lease',attempts:1,schedule_key:scheduleKey},
  ])}),
  from:(table:string)=>{
   const filters:Record<string,unknown>={};
   const value=table==='workspace_subscriptions'?{estado:'activa',stripe_customer_id:'cus_test'}:table==='workspaces'?{name:'Pilar',owner_id:'owner'}:table==='profiles'?{timezone:'America/New_York'}:null;
   const chain={select:()=>chain,eq:(key:string,val:unknown)=>{filters[key]=val;return chain;},update:(values:Record<string,unknown>)=>{changes.push({table,values,filters});return chain;},maybeSingle:async()=>({data:value}),single:async()=>({data:value}),then:(resolve:(r:unknown)=>unknown)=>Promise.resolve({data:null}).then(resolve)};
   return chain;
  },
 } as unknown as SupabaseClient;
 return {db,changes};
}
beforeEach(()=>{
 vi.useRealTimers();mocks.wa.mockReset().mockResolvedValue({ok:true,messageId:'wamid'});
 mocks.email.mockReset().mockResolvedValue(true);mocks.payment.mockReset();mocks.stripe.mockReset().mockResolvedValue('verified');
});
describe('monthly reminders',()=>{
 it('uses exact deadline boundaries, including partial unpaid invoices',()=>{
  expect(billingPhase(payment,now)).toBe('pending');
  const deadline=Date.parse(payment.graceUntil);
  expect(billingPhase(payment,deadline-6*3_600_000-1)).toBe('pending');
  expect(billingPhase(payment,deadline-6*3_600_000)).toBe('reminder6');
  expect(billingPhase(payment,deadline-3_600_000-1)).toBe('reminder6');
  expect(billingPhase(payment,deadline-3_600_000)).toBe('reminder1');
  expect(billingPhase(payment,deadline)).toBe('paused');
  expect(billingPhase(null,deadline)).toBe('active');
 });
 it.each(['es','en'] as const)('includes a friendly deadline, timezone and invoice in %s',locale=>{
  const message=billingNoticeMessage('reminder6',locale,{name:'Pilar',payment,timezone:'America/New_York'});
  expect(message.body).toContain('Pilar');expect(message.body).toContain(payment.invoiceUrl);expect(message.body).toContain('America/New_York');
  expect(message.body).not.toMatch(/\{(nombre|fecha|url)\}/);
 });
 it('cancels both channels when payment was confirmed before dispatch',async()=>{
  mocks.payment.mockResolvedValue(null);
  const {db,changes}=database();
  await maintainBillingNotifications(db);
  expect(mocks.stripe).toHaveBeenCalledTimes(2);
  expect(mocks.wa).not.toHaveBeenCalled();expect(mocks.email).not.toHaveBeenCalled();
  expect(changes.map(c=>c.values.status)).toEqual(['cancelled','cancelled']);
 });
 it('retries failed email independently without resending accepted WhatsApp',async()=>{
  const current={...payment,graceUntil:new Date(Date.now()+4*3_600_000).toISOString()};
  mocks.payment.mockResolvedValue(current);
  mocks.email.mockResolvedValue(false);
  const {db,changes}=database(['reminder6'],billingNoticeSchedule(current));
  const result=await maintainBillingNotifications(db);
  expect(result.sent).toBe(1);
  expect(changes.map(c=>c.values.status)).toEqual(['sent','pending']);
  expect(mocks.email.mock.calls[0][3]).toMatch(/^billing\/[a-f0-9]{64}$/);
  expect(changes.every(c=>c.filters.lease_id==='lease')).toBe(true);
 });
 it('does not send a delayed six-hour reminder inside the last hour',async()=>{
  mocks.payment.mockResolvedValue({...payment,graceUntil:new Date(Date.now()+30*60_000).toISOString()});
  const {db}=database();await maintainBillingNotifications(db);
  expect(mocks.wa).not.toHaveBeenCalled();expect(mocks.email).not.toHaveBeenCalled();
 });
 it('cancels a reminder from an earlier deadline after a grace extension',async()=>{
  const prior={...payment,graceUntil:new Date(Date.now()+2*3_600_000).toISOString()};
  mocks.payment.mockResolvedValue({...prior,graceUntil:new Date(Date.now()+5*3_600_000).toISOString()});
  const {db,changes}=database(['reminder6'],billingNoticeSchedule(prior));
  await maintainBillingNotifications(db);
  expect(mocks.wa).not.toHaveBeenCalled();expect(mocks.email).not.toHaveBeenCalled();
  expect(changes.map(c=>c.values.status)).toEqual(['cancelled','cancelled']);
 });
});
