import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { idColumn } from '@/lib/short-id';
import { flowMetricView, type FlowMetricQuery } from './metric-contract';
export async function readFlowMetricEvidence(db: SupabaseClient, workspaceId: string, actorId: string, rawId: string, query: FlowMetricQuery) {
  if (![workspaceId,actorId].every(value => z.string().uuid().safeParse(value).success) || !/^(?:[0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(rawId)) throw new Error('invalid_flow_metrics');
  const source = await db.from('flows').select('id').eq('workspace_id',workspaceId).eq(idColumn(rawId),rawId).is('deleted_at',null).limit(2);
  if (source.error) throw new Error('flow_metrics_unavailable');
  if (source.data?.length !== 1 || !z.string().uuid().safeParse(source.data[0].id).success) throw new Error('flow_metrics_not_found');
  const flowId = source.data[0].id as string;
  const result = await db.rpc('read_flow_metric_evidence',{p_workspace_id:workspaceId,p_actor_id:actorId,p_flow_id:flowId,p_from:query.from,p_through:query.through,p_node_key:query.node,p_status:query.status,p_cursor:query.cursor});
  if (result.error) throw new Error(['flow_metrics_not_found','invalid_flow_metrics'].includes(result.error.message) ? result.error.message : 'flow_metrics_unavailable');
  const parsed = flowMetricView.safeParse(result.data);
  if (!parsed.success || parsed.data.flow_id !== flowId || Date.parse(parsed.data.from_at) !== Date.parse(query.from) || Date.parse(parsed.data.through_at) !== Date.parse(query.through)
    || parsed.data.evidence_filter.node_key !== query.node || parsed.data.evidence_filter.status !== query.status) throw new Error('flow_metrics_unavailable');
  return { ...parsed.data, days:query.days, next_cursor:parsed.data.next_cursor ? Buffer.from(JSON.stringify(parsed.data.next_cursor)).toString('base64url') : null };
}
