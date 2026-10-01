import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import type { httpFlowApprovalPayload } from '@/lib/approvals/http-flow';
import type { FlowNodeRow, FlowRunRow } from './types';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';

// PostgreSQL retains microseconds; Date alone would alias two visits within one millisecond.
function sameVisit(left: string, right: string) {
  const micros = (value: string) => (value.match(/\d{2}:\d{2}:\d{2}(?:\.(\d+))?(?:Z|[+-]\d{2}:\d{2})$/)?.[1] ?? '').padEnd(6, '0').slice(3);
  return Number.isFinite(Date.parse(left)) && Date.parse(left) === Date.parse(right) && micros(left) === micros(right);
}

/** Snapshot preflight narrows the callback. The HTTP node still owns the atomic advance CAS. */
export async function continueHttpApprovalFlow(db: SupabaseClient, workspaceId: string, payload: z.infer<typeof httpFlowApprovalPayload>) {
  if (!SHOW_RIVERZ_IMPROVEMENTS) return false;
  const flow = payload.http_flow;
  const selected = await db.from('flow_runs').select('*').eq('id', flow.run_id).eq('workspace_id', workspaceId).maybeSingle();
  if (selected.error) throw new Error('http_flow_resume_unavailable');
  const run = selected.data as FlowRunRow | null;
  if (!run || run.id !== flow.run_id || run.workspace_id !== workspaceId || run.status !== 'active' || run.current_node_key !== flow.node_key || run.contact_id !== payload.contact_id
    || run.conversation_id !== payload.conversation_id || !sameVisit(run.last_advanced_at, flow.visit_at)) return false;
  const stack = Array.isArray(run.call_stack) ? run.call_stack : [];
  if ((stack.length ? stack[stack.length - 1].flow_id : run.flow_id) !== flow.flow_id) return false;
  const selectedNodes = await db.from('flow_nodes').select('*').eq('flow_id', flow.flow_id);
  if (selectedNodes.error || !selectedNodes.data) throw new Error('http_flow_resume_unavailable');
  const nodes = new Map((selectedNodes.data as FlowNodeRow[]).map(node => [node.node_key, node]));
  if (nodes.get(flow.node_key)?.node_type !== 'http_action') return false;
  const engine = await import('./engine');
  await engine.__advanceFromNodeKeyForResume(db, run, flow.node_key, nodes);
  return true;
}
