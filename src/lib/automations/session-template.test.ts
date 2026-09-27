import {describe,it,expect,vi} from 'vitest';
import {usesSessionTemplates,isNewSessionEvent,serviceWindowOpen,templateDeliveryMode,sessionTemplateText,sessionRunId,deliveryId,claimTemplateDelivery} from './session-template';
const pending={status:'Pending',meta_status:'PENDING',body_text:'Hola {{1}}',header_type:null};
describe('one automation, two transports',()=>{
 it('requires explicit opt-in',()=>{expect(usesSessionTemplates({})).toBe(false);expect(usesSessionTemplates({session_template_fallback:true})).toBe(true);});
 it('uses text only inside the verified service window',()=>{expect(templateDeliveryMode(pending,true,false)).toBe('session');expect(templateDeliveryMode(pending,false,false)).toBe('wait');});
 it('switches only pending deliveries to approved templates',()=>{expect(templateDeliveryMode({...pending,status:'Approved',meta_status:'APPROVED'},false,false)).toBe('template');});
 it('a payment blocker does not permit templates outside the window',()=>{const approved={...pending,status:'Approved',meta_status:'APPROVED'};expect(templateDeliveryMode(approved,false,true)).toBe('wait');expect(templateDeliveryMode(approved,true,true)).toBe('session');});
 it.each(['REJECTED','PAUSED','DISABLED','FLAGGED','PENDING_DELETION'])('never bypasses Meta status %s',meta_status=>{expect(templateDeliveryMode({...pending,meta_status},true,false)).toBe('blocked');});
 it('does not silently discard media headers',()=>{expect(templateDeliveryMode({...pending,header_type:'image'},true,false)).toBe('blocked');});
 it('fails closed for absent/future/boundary timestamps',()=>{const now=Date.parse('2026-09-27T20:00:00Z');expect(serviceWindowOpen(null,now)).toBe(false);expect(serviceWindowOpen('2026-09-27T21:00:00Z',now)).toBe(false);expect(serviceWindowOpen('2026-09-26T20:00:00Z',now)).toBe(false);expect(serviceWindowOpen('2026-09-27T19:00:00Z',now)).toBe(true);});
 it('renders exact copy, links and reply choices without an LLM',()=>{expect(sessionTemplateText({...pending,buttons:[{type:'URL',text:'Comprar',url:'https://riverz.co/r/{{1}}'},{type:'QUICK_REPLY',text:'Necesito ayuda'}]},['Ana'],{buttonUrlParam:'abc',buttonUrlIndex:0})).toBe('Hola Ana\n\nComprar: https://riverz.co/r/abc\n\nNecesito ayuda');});
 it('rejects unresolved variables',()=>{expect(()=>sessionTemplateText(pending,[],{})).toThrow();});
 it('deduplicates an event independently of transport or approval',()=>{const run=sessionRunId('ws','a','order','c',{order_id:'123'});expect(sessionRunId('ws','a','order','c',{order_id:'123',status:'approved'})).toBe(run);expect(sessionRunId('ws','a','order','c',{order_id:'124'})).not.toBe(run);expect(deliveryId('ws',run,'step1')).not.toBe(deliveryId('ws',run,'step2'));expect(()=>sessionRunId('ws','a','order','c',{})).toThrow();});
 it('concurrent workers cannot claim the same outgoing message twice',async()=>{
   let claimed=false;const insert=vi.fn(async()=>{if(claimed)return {error:{code:'23505'}};claimed=true;return {error:null};});
   const q={insert,select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue({data:{status:'sending',message_id:null},error:null})};
   const db={from:()=>q} as never;const args={workspaceId:'ws',conversationId:'c',logId:'run',stepId:'step',templateName:'t',automationName:'Flow'};
   const results=await Promise.allSettled([claimTemplateDelivery(db,args),claimTemplateDelivery(db,args)]);
   expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
 });
 it('an already sent text is reused after approval, not resent',async()=>{
   const q={insert:vi.fn().mockResolvedValue({error:{code:'23505'}}),select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue({data:{status:'delivered',message_id:'wamid.original'},error:null})};
   const args={workspaceId:'ws',conversationId:'c',logId:'run',stepId:'step',templateName:'t',automationName:'Flow'};
   expect((await claimTemplateDelivery({from:()=>q} as never,args)).existingMessageId).toBe('wamid.original');
   q.maybeSingle.mockResolvedValueOnce({data:{status:'failed',message_id:'wamid.original'},error:null});
   await expect(claimTemplateDelivery({from:()=>q} as never,args)).rejects.toThrow('manual review');
 });
 it('never enrolls historical recovery events when activated',()=>{
   const cfg={session_template_fallback:true,session_templates_started_at:'2026-09-27T20:00:00Z'};
   expect(isNewSessionEvent(cfg,'payment_rejected',{rejected_at:'2026-09-26T20:00:00Z'})).toBe(false);
   expect(isNewSessionEvent(cfg,'shopify_abandoned_checkout',{})).toBe(false);
   expect(isNewSessionEvent(cfg,'shopify_abandoned_checkout',{checkout_created_at:'2026-09-27T21:00:00Z'})).toBe(true);
   expect(isNewSessionEvent(cfg,'shopify_order_fulfilled',{})).toBe(true);
   expect(sessionRunId('ws','a','payment_rejected','c',{payment_id:'123'})).toBeTruthy();
 });
});
