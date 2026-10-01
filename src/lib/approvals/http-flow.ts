import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { userAccess } from '@/lib/mcp/access';
import { httpFlowActionAllowed, httpFlowConfig } from '@/lib/flows/http-contract';
import { loadHttpAction } from '@/lib/integrations/http-action-store';
import { actionRequest } from '@/lib/integrations/http-action-contract';
import { executeClaimedHttpAction, httpActionBindingsForConversation, httpExecutionHash } from '@/lib/integrations/http-action-executor';
import { httpApprovalPanelMessage } from './protected-http';
import { translate } from '@/lib/i18n/translate';

const uuid = z.string().uuid();
const scalar = z.union([z.string().max(2000), z.number().finite().min(-1e12).max(1e12), z.boolean()]);
export const httpFlowApprovalPayload = z.object({
  tool: z.string().max(70), input: z.record(z.string().max(48), scalar).refine(v => Object.keys(v).length <= 12),
  contact_id: uuid, conversation_id: uuid, dedupe_key: z.string().min(1).max(100),
  http_action_context: z.object({ contact_id: uuid, conversation_id: uuid, phone: z.string().max(2000).nullable(), email: z.string().max(2000).nullable() }).strict(),
  http_flow: z.object({ run_id: uuid, flow_id: uuid, node_key: z.string().min(1).max(120),
    visit_at: z.string().datetime({ offset: true }), node_config: httpFlowConfig, grant_revision: z.number().int().positive() }).strict(),
}).strict().refine(p => p.tool === `http_flow_action_${p.http_flow.node_config.action_id.replaceAll('-', '')}_v${p.http_flow.node_config.action_revision}`
  && p.contact_id === p.http_action_context.contact_id && p.conversation_id === p.http_action_context.conversation_id);
export function isHttpFlowApproval(payload: unknown) {
  return !!payload && typeof payload === 'object' && !Array.isArray(payload)
    && typeof (payload as Record<string, unknown>).tool === 'string'
    && ((payload as Record<string, unknown>).tool as string).startsWith('http_flow_action_');
}

/** Check current pending snapshot before the generic decision consumes it. SQL checks again at claim. */
export async function canDecideHttpFlow(db: SupabaseClient, workspaceId: string, actorId: string | null | undefined,
  approvalId: string, payload: unknown, via: string) {
  if (!SHOW_RIVERZ_IMPROVEMENTS || via !== 'panel' || ![workspaceId, actorId, approvalId].every(id => uuid.safeParse(id).success)) return false;
  const parsed = httpFlowApprovalPayload.safeParse(payload);
  if (!parsed.success) return false;
  try {
    const access = await userAccess(db, actorId!, workspaceId);
    if (!access?.admin || (access.sections !== null && !['/aprobaciones', '/automatizaciones', '/bandeja'].every(s => access.sections!.includes(s)))) return false;
    const result = await db.rpc('review_http_flow_post', { p_workspace_id: workspaceId, p_approval_id: approvalId, p_actor_id: actorId, p_approved: null });
    const snapshot: Record<string, unknown> = { ...parsed.data }; delete snapshot.dedupe_key;
    return !result.error && result.data?.approval_id === approvalId && httpExecutionHash(result.data.payload) === httpExecutionHash(snapshot);
  } catch { return false; }
}

export async function rejectHttpFlow(db: SupabaseClient, workspaceId: string, approvalId: string, actorId: string, locale: 'es' | 'en') {
  try {
    if (!SHOW_RIVERZ_IMPROVEMENTS) throw new Error('hidden');
    const result = await db.rpc('reject_http_flow_post', { p_workspace_id: workspaceId, p_approval_id: approvalId, p_actor_id: actorId });
    if (result.error) throw new Error('failed');
    return { ok: true, message: translate(locale, 'approvals.httpFlowRejected') };
  } catch { return { ok: false, message: httpApprovalPanelMessage(locale) }; }
}

export async function executeApprovedHttpFlow(db: SupabaseClient, context: { workspaceId: string; approvalId: string; actorId: string },
  payload: unknown, locale: 'es' | 'en') {
  const failed = () => ({ ok: false, uncertain: true, message: translate(locale, 'approvals.httpFlowResultUnverified') });
  try {
    if (!SHOW_RIVERZ_IMPROVEMENTS) return { ok: false, message: httpApprovalPanelMessage(locale) };
    const ctx = z.object({ workspaceId: uuid, approvalId: uuid, actorId: uuid }).strict().parse(context);
    const p = httpFlowApprovalPayload.parse(payload), config = p.http_flow.node_config;
    const action = await loadHttpAction(db, ctx.workspaceId, config.action_id);
    if (action.state !== 'active' || action.revision !== config.action_revision || action.definition.method !== 'POST'
      || !httpFlowActionAllowed(action.definition)) throw new Error('changed');
    const trusted = await httpActionBindingsForConversation(db, { workspaceId: ctx.workspaceId, actorUserId: ctx.actorId, conversationId: p.conversation_id });
    if (!trusted || httpExecutionHash(trusted) !== httpExecutionHash(p.http_action_context)) throw new Error('changed');
    const request = actionRequest(action.definition, p.input, trusted);
    const claimed = await db.rpc('claim_http_flow_post', { p_workspace_id: ctx.workspaceId, p_approval_id: ctx.approvalId,
      p_actor_id: ctx.actorId, p_input_hash: httpExecutionHash({ request, conversation_id: p.conversation_id }) });
    if (claimed.error) throw new Error('claim');
    const claim = z.object({ invocation_key: z.string().regex(/^[0-9a-f]{64}$/), claim: z.unknown() }).strict().parse(claimed.data);
    const receipt = await executeClaimedHttpAction(db, { workspaceId: ctx.workspaceId, actionId: config.action_id,
      invocationKey: claim.invocation_key }, action, request, claim.claim);
    const execution = { receipt_id: receipt.id, state: receipt.state, status_code: receipt.status_code,
      cached: receipt.cached, business_completion_verified: false, flow_continuation_attempted: false };
    if (receipt.state !== 'acknowledged') {
      await stop();
      return { ...failed(), uncertain: ['claimed', 'uncertain'].includes(receipt.state), execution };
    }
    // Re-enter at the protected HTTP node, never jump directly to a caller-provided successor.
    // Only the node's transactional finish winner can advance the graph.
    try {
      const { continueHttpApprovalFlow } = await import('@/lib/flows/http-approval-resume');
      execution.flow_continuation_attempted = await continueHttpApprovalFlow(db, ctx.workspaceId, p, ctx.approvalId);
    } catch {
      return { ok: true, execution, message: translate(locale, 'approvals.httpFlowContinuationUnavailable') };
    }
    return { ok: true, execution, message: translate(locale, 'approvals.httpFlowResponseRecorded') };
  } catch { await stop(); return failed(); }
  async function stop() {
    if (!SHOW_RIVERZ_IMPROVEMENTS || ![context.workspaceId, context.approvalId, context.actorId].every(id => uuid.safeParse(id).success)) return;
    try { await db.rpc('stop_http_flow_post', { p_workspace_id: context.workspaceId, p_approval_id: context.approvalId, p_actor_id: context.actorId }); }
    catch { /* The receipt/approval remains available; never fall back to an unscoped run update. */ }
  }
}
