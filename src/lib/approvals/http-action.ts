import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { userAccess } from '@/lib/mcp/access';
import { executeHttpAssistantAction } from '@/lib/integrations/http-action-executor';
import { isProtectedHttpApproval, httpApprovalPanelMessage } from './protected-http';
export { httpApprovalPanelMessage } from './protected-http';

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const payloadSchema = z.object({ tool: z.string().max(64),
  input: z.record(z.string().max(48), z.union([z.string().max(2000), z.number().finite().min(-1e12).max(1e12), z.boolean()]))
    .refine(value => Object.keys(value).length <= 12),
  contact_id: uuid, conversation_id: uuid, agent_id: uuid, dedupe_key: z.string().max(100).optional(),
  http_action_context: z.object({ contact_id: uuid, conversation_id: uuid, phone: z.string().max(2000).nullable(), email: z.string().max(2000).nullable() }).strict(),
  http_action: z.object({ action_id: uuid, action_revision: z.number().int().positive(), grant_revision: z.number().int().positive(),
    channel: z.enum(['whatsapp', 'instagram', 'messenger', 'gmail', 'outlook', 'zoho', 'webchat', 'voice', 'ig_comment', 'fb_comment']) }).strict(),
}).strict().refine(value => value.tool === `http_action_${value.http_action.action_id.replaceAll('-', '')}_v${value.http_action.action_revision}`
  && value.contact_id === value.http_action_context.contact_id && value.conversation_id === value.http_action_context.conversation_id);
export function isHttpActionApproval(payload: unknown): boolean {
  return isProtectedHttpApproval(payload);
}

/** New HTTP decisions require an authenticated panel principal before consuming the pending request.
 * Phone suffixes from legacy WhatsApp approvals cannot establish that human identity.
 */
export async function canDecideHttpAction(db: SupabaseClient, workspaceId: string, actorId: string | null | undefined,
  payload: unknown, via: string): Promise<boolean> {
  if (!SHOW_RIVERZ_IMPROVEMENTS || via !== 'panel' || !uuid.safeParse(workspaceId).success || !uuid.safeParse(actorId).success
    || !payloadSchema.safeParse(payload).success) return false;
  try {
    const access = await userAccess(db, actorId!, workspaceId);
    return !!access?.admin && (access.sections === null || ['/aprobaciones', '/automatizaciones', '/bandeja'].every(section => access.sections!.includes(section)));
  } catch { return false; }
}

export async function executeApprovedHttpAction(db: SupabaseClient,
  protectedContext: { workspaceId: string; approvalId: string; actorId: string }, payload: unknown, locale: 'es' | 'en') {
  const failed = () => ({ ok: false, uncertain: true, message: locale === 'en'
    ? 'The system action result could not be verified. Review its receipt before trying again.'
    : 'No se pudo verificar el resultado de la acción. Revisa su comprobante antes de volver a intentarlo.' });
  if (!SHOW_RIVERZ_IMPROVEMENTS) return { ok: false, message: httpApprovalPanelMessage(locale) };
  try {
    const ctx = z.object({ workspaceId: uuid, approvalId: uuid, actorId: uuid }).strict().safeParse(protectedContext);
    const parsed = payloadSchema.safeParse(payload);
    if (!ctx.success || !parsed.success) return { ok: false, message: httpApprovalPanelMessage(locale) };
    const p = parsed.data, action = p.http_action;
    const receipt = await executeHttpAssistantAction(db, { workspaceId: ctx.data.workspaceId, agentId: p.agent_id,
      actionId: action.action_id, expectedRevision: action.action_revision, grantRevision: action.grant_revision,
      channel: action.channel, conversationId: p.conversation_id,
      invocationKey: createHash('sha256').update(`${ctx.data.workspaceId}:${ctx.data.approvalId}`).digest('hex'),
      approvalId: ctx.data.approvalId, approvalActorId: ctx.data.actorId }, p.input);
    const execution = { receipt_id: receipt.id, state: receipt.state, status_code: receipt.status_code,
      cached: receipt.cached, business_completion_verified: false };
    if (receipt.state !== 'acknowledged') return { ...failed(), uncertain: ['claimed', 'uncertain'].includes(receipt.state), execution };
    return { ok: true, execution, message: locale === 'en'
      ? 'Provider response received and receipt recorded. Verify the business outcome in your system.'
      : 'Respuesta del proveedor recibida y comprobante registrado. Verifica el resultado comercial en tu sistema.' };
  } catch { return failed(); }
}
