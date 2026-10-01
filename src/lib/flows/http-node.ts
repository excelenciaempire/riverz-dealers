import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { userAccess } from '@/lib/mcp/access';
import { actionRequest } from '@/lib/integrations/http-action-contract';
import { loadHttpAction } from '@/lib/integrations/http-action-store';
import { executeClaimedHttpAction, httpActionBindingsForConversation, httpExecutionHash } from '@/lib/integrations/http-action-executor';
import { httpFlowConfig, httpFlowInputs, httpFlowOutput } from './http-contract';
import type { FlowNodeRow, FlowRunRow } from './types';
import { localeDeCuenta } from '@/lib/i18n/cuenta';

const uuid = z.string().uuid();
const grantSchema = z.object({ workspace_id: uuid, flow_id: uuid, node_key: z.string(),
  action_id: uuid, action_revision: z.number().int().positive(), node_config: httpFlowConfig,
  revision: z.number().int().positive(), state: z.literal('active'), granted_by: uuid });
export type HttpFlowResult = { state: 'advanced'; next: string; vars: Record<string, unknown>; receiptId: string; visitAt: string; replayed: boolean }
  | { state: 'pending' | 'superseded' };

type HttpFlowObservation = { current_node_key: string | null; last_advanced_at: string; vars: Record<string, unknown> };
class HttpFlowFailure extends Error {
  constructor(readonly observation: HttpFlowObservation, cause: unknown) {
    super('http_flow_review_required', { cause });
  }
}

/** A failure may stop only the visit it observed, never a newer worker's execution. */
export async function failHttpFlowNode(db: SupabaseClient, run: FlowRunRow, node: FlowNodeRow, error: unknown): Promise<boolean> {
  if (!(error instanceof HttpFlowFailure)) return false;
  const result = await db.rpc('fail_http_action_flow', {
    p_workspace_id: run.workspace_id, p_run_id: run.id, p_flow_id: node.flow_id, p_node_key: node.node_key,
    p_expected_node: error.observation.current_node_key, p_expected_advanced_at: error.observation.last_advanced_at,
    p_expected_vars: error.observation.vars,
  });
  if (result.error) throw new Error('http_flow_stop_failed');
  return result.data === true;
}

/** No owner impersonation, credentials in graphs, automatic retries or provider calls in simulation. */
export async function runHttpFlowNode(db: SupabaseClient, run: FlowRunRow, node: FlowNodeRow, recordedApprovalId?: string): Promise<HttpFlowResult> {
  if (!SHOW_RIVERZ_IMPROVEMENTS) throw new Error('http_flow_hidden');
  if (!uuid.safeParse(run.id).success || !uuid.safeParse(run.workspace_id).success
    || !run.conversation_id || !run.contact_id || run.status !== 'active') throw new Error('http_flow_context_invalid');
  // Observe the persisted visit before any fallible authorization or transport work.
  const observed = await db.from('flow_runs').select('id, workspace_id, contact_id, conversation_id, status, current_node_key, last_advanced_at, vars')
    .eq('id', run.id).eq('workspace_id', run.workspace_id).maybeSingle();
  if (observed.error) throw new Error('http_flow_observation_failed');
  const version = z.object({ id: uuid, workspace_id: uuid, contact_id: uuid, conversation_id: uuid,
    status: z.literal('active'), current_node_key: z.string().nullable(), last_advanced_at: z.string(),
    vars: z.record(z.string(), z.unknown()) }).safeParse(observed.data);
  if (!version.success || version.data.id !== run.id || version.data.workspace_id !== run.workspace_id
    || version.data.contact_id !== run.contact_id || version.data.conversation_id !== run.conversation_id
    || ![run.current_node_key, node.node_key].includes(version.data.current_node_key)
    || httpExecutionHash(version.data.vars) !== httpExecutionHash(run.vars)) return { state: 'superseded' };
  try {
    const config = httpFlowConfig.parse(node.config);
    const selected = await db.from('http_action_flow_grants')
      .select('workspace_id, flow_id, node_key, action_id, action_revision, node_config, revision, state, granted_by')
      .eq('workspace_id', run.workspace_id).eq('flow_id', node.flow_id).eq('node_key', node.node_key).maybeSingle();
    const parsed = grantSchema.safeParse(selected.data);
    if (selected.error || !parsed.success) throw new Error('http_flow_grant_required');
    const grant = parsed.data;
    if (grant.workspace_id !== run.workspace_id || grant.flow_id !== node.flow_id || grant.node_key !== node.node_key
      || grant.action_id !== config.action_id || grant.action_revision !== config.action_revision
      || httpExecutionHash(grant.node_config) !== httpExecutionHash(config)) throw new Error('http_flow_changed');
    const access = await userAccess(db, grant.granted_by, run.workspace_id);
    if (!access?.admin || (access.sections !== null
      && !['/automatizaciones', '/bandeja'].every(section => access.sections!.includes(section)))) throw new Error('http_flow_grant_required');
    const action = await loadHttpAction(db, run.workspace_id, config.action_id);
    if (action.state !== 'active' || action.revision !== config.action_revision) throw new Error('http_flow_changed');
    const trusted = await httpActionBindingsForConversation(db, { workspaceId: run.workspace_id,
      actorUserId: grant.granted_by, conversationId: run.conversation_id });
    if (!trusted || trusted.contact_id !== run.contact_id) throw new Error('http_flow_context_invalid');
    // Existing input/resume paths move the durable cursor without refreshing in-memory timestamps.
    const visitAt = version.data.last_advanced_at;
    const input = httpFlowInputs(config, action.definition, run.vars);
    const request = actionRequest(action.definition, input, trusted);
    if (recordedApprovalId && (action.definition.method !== 'POST' || !uuid.safeParse(recordedApprovalId).success)) throw new Error('http_flow_review_required');
    if (action.definition.method === 'POST') {
      const proposed = recordedApprovalId
        ? await db.rpc('observe_http_flow_post', { p_workspace_id: run.workspace_id, p_approval_id: recordedApprovalId,
          p_run_id: run.id, p_flow_id: node.flow_id, p_node_key: node.node_key, p_visit_at: visitAt,
          p_vars: run.vars, p_config: config, p_grant_revision: grant.revision })
        : await db.rpc('prepare_http_flow_post', { p_workspace_id: run.workspace_id, p_run_id: run.id,
        p_flow_id: node.flow_id, p_node_key: node.node_key, p_config: config, p_grant_revision: grant.revision,
        p_expected_node: version.data.current_node_key, p_visit_at: visitAt, p_vars: run.vars,
        p_input_hash: httpExecutionHash({ request, conversation_id: run.conversation_id }),
        p_locale: await localeDeCuenta(db, run.workspace_id) });
      if (proposed.error) throw new Error('http_flow_review_required');
      const proposal = z.object({ approval_id: uuid, status: z.enum(['pendiente', 'aprobada', 'rechazada', 'vencida', 'fallida']),
        invocation_key: z.string().regex(/^[0-9a-f]{64}$/), receipt: z.record(z.string(), z.unknown()).nullable() }).strict().parse(proposed.data);
      if (recordedApprovalId && (proposal.approval_id !== recordedApprovalId || proposal.status !== 'aprobada' || proposal.receipt?.state !== 'acknowledged')) throw new Error('http_flow_review_required');
      if (proposal.status === 'pendiente' || (proposal.status === 'aprobada' && (!proposal.receipt || proposal.receipt.state === 'claimed'))) return { state: 'pending' };
      if (proposal.status !== 'aprobada' || !proposal.receipt) throw new Error('http_flow_review_required');
      // Validate an already recorded receipt; this branch never receives a dispatch lease.
      const receipt = await executeClaimedHttpAction(db, { workspaceId: run.workspace_id, actionId: config.action_id,
        invocationKey: proposal.invocation_key }, action, request, { claimed: false, ...proposal.receipt });
      if (receipt.state !== 'acknowledged' || !receipt.result) throw new Error('http_flow_review_required');
      const vars = httpFlowOutput(config, action.definition, run.vars, receipt.result);
      const finished = await db.rpc('finish_http_flow_post', { p_workspace_id: run.workspace_id, p_approval_id: proposal.approval_id, p_vars: vars });
      if (finished.error) throw new Error('http_flow_finish_failed');
      return finished.data === true ? { state: 'advanced', next: config.next_node_key, vars, receiptId: receipt.id, visitAt, replayed: true } : { state: 'superseded' };
    }
    const invocationKey = createHash('sha256').update(JSON.stringify(['flow', run.id, node.flow_id,
      node.node_key, visitAt])).digest('hex');
    const claim = await db.rpc('claim_http_action_flow', { p_workspace_id: run.workspace_id, p_run_id: run.id,
      p_flow_id: node.flow_id, p_node_key: node.node_key, p_config: config, p_grant_revision: grant.revision,
      p_expected_node: version.data.current_node_key, p_expected_advanced_at: visitAt,
      p_expected_vars: run.vars, p_invocation_key: invocationKey,
      p_input_hash: httpExecutionHash({ request, conversation_id: run.conversation_id }), p_context: trusted });
    if (claim.error) throw new Error('http_flow_claim_failed');
    const receipt = await executeClaimedHttpAction(db, { workspaceId: run.workspace_id,
      actionId: config.action_id, invocationKey }, action, request, claim.data);
    if (receipt.state === 'claimed') return { state: 'pending' };
    if (receipt.state !== 'acknowledged' || !receipt.result) throw new Error('http_flow_review_required');
    const vars = httpFlowOutput(config, action.definition, run.vars, receipt.result);
    const finished = await db.rpc('finish_http_action_flow', { p_workspace_id: run.workspace_id, p_run_id: run.id,
      p_flow_id: node.flow_id, p_node_key: node.node_key, p_config: config, p_grant_revision: grant.revision,
      p_receipt_id: receipt.id, p_expected_advanced_at: visitAt, p_expected_vars: run.vars, p_vars: vars });
    if (finished.error) throw new Error('http_flow_finish_failed');
    if (finished.data !== true) return { state: 'superseded' };
    return { state: 'advanced', next: config.next_node_key, vars, receiptId: receipt.id, visitAt,
      replayed: (claim.data as { claimed?: boolean } | null)?.claimed !== true };
  } catch (error) {
    throw new HttpFlowFailure(version.data, error);
  }
}
