import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { renderTemplateBody } from '@/lib/whatsapp/template-render';
import { resolveTemplateButtons } from '@/lib/whatsapp/template-buttons';

/** Explicit opt-in; existing merchants retain their approved-template policy. */
export const usesSessionTemplates = (config: unknown): boolean =>
  !!config && typeof config === 'object' && (config as Record<string, unknown>).session_template_fallback === true;

export function deliveryId(...parts: string[]): string {
  const h = createHash('sha256').update(JSON.stringify(['automation-delivery-v1', ...parts])).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function sessionRunId(workspace: string, automation: string, trigger: string, contact: string, vars: Record<string, unknown>): string {
  const entity = String(vars.order_id || vars.checkout_id || vars.checkout_token || vars.abandoned_checkout_id || vars.payment_id || vars.event_id || '').trim();
  if (!entity) throw new Error('session automation requires a stable order or checkout identity');
  return deliveryId(workspace, automation, trigger, contact, entity);
}

export function serviceWindowOpen(lastInbound: string | null | undefined, now = Date.now()): boolean {
  const at = Date.parse(lastInbound ?? '');
  // Margin protects against the window closing during the network request.
  return Number.isFinite(at) && at <= now && now - at < (24 * 60 - 1) * 60_000;
}

export type TemplateAvailability = { status?: unknown; meta_status?: unknown; body_text?: string | null; header_type?: string | null };
export function canUseSessionTemplate(t: TemplateAvailability): boolean {
  const raw = String(t.meta_status ?? '').toUpperCase();
  return ['Pending', 'Approved'].includes(String(t.status)) &&
    (!raw || ['PENDING', 'APPROVED'].includes(raw)) && !!t.body_text?.trim() &&
    (!t.header_type || t.header_type.toLowerCase() === 'none');
}

export function templateDeliveryMode(t: TemplateAvailability, open: boolean, templateBlocked: boolean): 'template' | 'session' | 'wait' | 'blocked' {
  const raw = String(t.meta_status ?? '').toUpperCase();
  if (t.status === 'Approved' && (!raw || raw === 'APPROVED') && !templateBlocked) return 'template';
  if (!canUseSessionTemplate(t)) return 'blocked';
  return open ? 'session' : 'wait';
}

export function sessionTemplateText(t: { body_text: string; buttons?: Array<Record<string, unknown>> | null }, params: string[], dynamic: {buttonUrlParam?: string; buttonUrlIndex?: number}): string {
  const body = renderTemplateBody(t.body_text, params);
  const buttons = resolveTemplateButtons(t.buttons, dynamic) ?? [];
  const lines = buttons.map(b => b.type === 'URL' ? `${b.text}: ${b.url}` : b.type === 'PHONE_NUMBER' ? `${b.text}: ${b.phone_number}` : b.text);
  const text = [body, ...lines].filter(Boolean).join('\n\n');
  if (!text.trim() || /\{\{[^}]+\}\}/.test(text) || text.length > 4096) throw new Error('invalid rendered session template');
  return text;
}

export class AwaitTemplateAvailability extends Error {}
export class StopSessionSequence extends Error {}

/** Turning the feature on must not enroll historical abandoned checkouts/payments. */
export function isNewSessionEvent(config: Record<string, unknown>, trigger: string, vars: Record<string, unknown>): boolean {
  if (!usesSessionTemplates(config) || !config.session_templates_started_at) return true;
  if (!['shopify_abandoned_checkout', 'payment_rejected'].includes(trigger)) return true;
  const created = Date.parse(String(trigger === 'payment_rejected' ? vars.rejected_at : vars.checkout_created_at));
  const started = Date.parse(String(config.session_templates_started_at));
  return Number.isFinite(created) && Number.isFinite(started) && created >= started;
}

export async function sessionSendPlan(db: SupabaseClient, args: {
  workspaceId: string; conversationId: string; contactId: string; templateName: string; language: string; stopAfterInboundAt?: string;
}): Promise<{mode: 'template' | 'session'; template: {body_text: string; buttons?: Array<Record<string, unknown>> | null}}> {
  const [tpl, conversation, inbound, connection] = await Promise.all([
    db.from('message_templates').select('status,meta_status,body_text,header_type,buttons').eq('workspace_id',args.workspaceId).eq('name',args.templateName).eq('language',args.language).maybeSingle(),
    db.from('conversations').select('id,channel,contact_id,assigned_agent_id,needs_human_reason,status').eq('workspace_id',args.workspaceId).eq('id',args.conversationId).is('deleted_at',null).maybeSingle(),
    db.from('messages').select('created_at').eq('conversation_id',args.conversationId).eq('sender_type','customer').is('deleted_at',null).order('created_at',{ascending:false}).limit(1).maybeSingle(),
    db.from('channel_connections').select('health_can_send,health_blockers').eq('workspace_id',args.workspaceId).eq('channel','whatsapp').eq('status','connected').order('updated_at',{ascending:false}).limit(1).maybeSingle(),
  ]);
  for (const r of [tpl,conversation,inbound,connection]) if(r.error) throw r.error;
  const c=conversation.data;
  if(!c || c.channel!=='whatsapp' || c.contact_id!==args.contactId) throw new Error('invalid WhatsApp conversation scope');
  if(c.assigned_agent_id || c.needs_human_reason || c.status==='closed') throw new StopSessionSequence('conversation is closed or reserved for human attention');
  if(args.stopAfterInboundAt && Date.parse(inbound.data?.created_at ?? '') > Date.parse(args.stopAfterInboundAt)) throw new StopSessionSequence('customer replied; assistant owns the conversation');
  if(!tpl.data || !connection.data) throw new Error('template or WhatsApp connection unavailable');
  const blockers = (connection.data.health_blockers ?? []) as Array<{code?:number}>;
  const paymentBlocked=blockers.some(b=>b.code===141006);
  if(String(connection.data.health_can_send).toUpperCase()==='BLOCKED'&&(!paymentBlocked||blockers.some(b=>b.code!==141006))) throw new Error('WhatsApp is blocked');
  const mode=templateDeliveryMode(tpl.data,serviceWindowOpen(inbound.data?.created_at),paymentBlocked);
  if(mode==='blocked') throw new StopSessionSequence('template rejected, paused, disabled or not eligible for session delivery');
  if(mode==='wait') throw new AwaitTemplateAvailability('waiting for an approved template or an open WhatsApp service window');
  return {mode,template:tpl.data as {body_text:string;buttons?:Array<Record<string,unknown>>|null}};
}

/** One durable claim covers both transports. Uncertain deliveries never auto-retry. */
export async function claimTemplateDelivery(db: SupabaseClient, args: {
  workspaceId:string; conversationId:string; logId:string; stepId:string; templateName:string; automationName:string;
}): Promise<{id:string; existingMessageId?:string}> {
  const id=deliveryId(args.workspaceId,args.logId,args.stepId);
  const r=await db.from('messages').insert({id,conversation_id:args.conversationId,sender_type:'bot',content_type:'text',content_text:null,
    template_name:args.templateName,origin:'automation',origin_name:args.automationName,status:'sending'});
  if(r.error?.code!=='23505'){if(r.error)throw r.error;return {id};}
  const old=await db.from('messages').select('message_id,status').eq('id',id).eq('conversation_id',args.conversationId).maybeSingle();
  if(old.error)throw old.error;
  if(old.data?.message_id&&['sent','delivered','read'].includes(old.data.status))return {id,existingMessageId:old.data.message_id};
  throw new Error('delivery already claimed; manual review required before any retry');
}
