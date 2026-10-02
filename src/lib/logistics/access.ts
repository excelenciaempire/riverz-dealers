import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { userAccess } from '@/lib/mcp/access';
import { canAccessConversation } from '@/lib/inbox/access';
import { CHANNELS } from '@/types';

export class LogisticsAccessError extends Error {
  constructor() { super('logistics_access_forbidden'); }
}
/** The current actor comes from the authenticated request, never from an order. */
export async function logisticsAccess(db: SupabaseClient, workspaceId: string, actorId: string, write = false) {
  if (!z.string().uuid().safeParse(workspaceId).success || !z.string().uuid().safeParse(actorId).success) throw new LogisticsAccessError();
  const access = await userAccess(db, actorId, workspaceId);
  if (!access || (write && !access.admin) || (access.sections !== null && !access.sections.includes('/pedidos'))) throw new LogisticsAccessError();
  return { inbox: access.sections === null || access.sections.includes('/bandeja'),
    voice: access.sections === null || access.sections.includes('/voz') };
}

/** IDs only. Body reads must use this allowlist and repeat this check before returning. */
export async function visibleLogisticsConversations(db: SupabaseClient, workspaceId: string, actorId: string, ids: string[], contactId?: string) {
  const access = await logisticsAccess(db, workspaceId, actorId);
  const parsed = z.array(z.string().uuid()).max(100).safeParse(ids);
  if (!parsed.success) throw new Error('logistics_case_context_invalid');
  if (!access.inbox || !ids.length) return new Set<string>();
  let query = db.from('conversations').select('id,workspace_id,contact_id,channel,connection_id')
    .eq('workspace_id', workspaceId).in('id', ids).is('deleted_at', null).limit(100);
  if (contactId) query = query.eq('contact_id', contactId);
  const result = await query;
  if (result.error) throw new Error('logistics_case_access_unavailable');
  const contacts = [...new Set((result.data ?? []).map(row => row.contact_id).filter((id): id is string => typeof id === 'string'))];
  const currentContacts = contacts.length ? await db.from('contacts').select('id').eq('workspace_id', workspaceId).in('id', contacts).limit(100) : null;
  if (currentContacts?.error) throw new Error('logistics_case_access_unavailable');
  const contactIds = new Set((currentContacts?.data ?? []).map(row => row.id));
  const visible = new Set<string>();
  for (const row of result.data ?? []) {
    if (!ids.includes(row.id) || row.workspace_id !== workspaceId || (contactId && row.contact_id !== contactId)) throw new Error('logistics_case_context_invalid');
    if (!(CHANNELS as readonly string[]).includes(row.channel)) continue;
    if (row.contact_id && !contactIds.has(row.contact_id)) continue;
    if (await canAccessConversation(db, actorId, row, workspaceId)) visible.add(row.id);
  }
  return visible;
}

const callContext = z.object({ id: z.string().uuid(), contact_id: z.string().uuid().nullable(),
  conversation_id: z.string().uuid().nullable(), order_id: z.string(),
  origin_context: z.object({ conversation_id: z.string().uuid().optional() }).passthrough().nullable() });
/** Only projected identity metadata is loaded before reading any call summary. */
export async function visibleLogisticsCalls(db: SupabaseClient, workspaceId: string, actorId: string, orderId: string, ids?: string[]) {
  const access = await logisticsAccess(db, workspaceId, actorId);
  if (!access.voice || ids?.length === 0) return new Set<string>();
  if (ids && !z.array(z.string().uuid()).max(10).safeParse(ids).success) throw new Error('logistics_call_context_invalid');
  let query = db.from('voice_calls').select('id,contact_id,conversation_id,origin_context:context->__riverz,order_id:context->order_id')
    .eq('workspace_id', workspaceId).contains('context', { order_id: orderId }).order('created_at', { ascending: false }).limit(10);
  if (ids) query = query.in('id', ids);
  const result = await query;
  if (result.error) throw new Error('logistics_calls_read_failed');
  const visible = new Set<string>();
  for (const value of result.data ?? []) {
    const parsed = callContext.safeParse(value);
    if (!parsed.success || parsed.data.order_id !== orderId || (ids && !ids.includes(parsed.data.id))) throw new Error('logistics_call_context_invalid');
    const call = parsed.data;
    const caseIds = [...new Set([call.conversation_id, call.origin_context?.conversation_id].filter((id): id is string => typeof id === 'string'))];
    if (caseIds.length) {
      const current = await visibleLogisticsConversations(db, workspaceId, actorId, caseIds, call.contact_id ?? undefined);
      if (current.size !== caseIds.length) continue;
    } else {
      if (!call.contact_id) continue;
      const contact = await db.from('contacts').select('id').eq('workspace_id', workspaceId).eq('id', call.contact_id).maybeSingle();
      if (contact.error) throw new Error('logistics_contact_read_failed');
      if (!contact.data || contact.data.id !== call.contact_id) continue;
    }
    visible.add(call.id);
  }
  return visible;
}
