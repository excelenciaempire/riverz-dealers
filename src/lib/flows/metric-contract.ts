import { z } from 'zod';
const date = z.string().datetime({ offset: true }).max(40).refine(value => Number.isFinite(Date.parse(value)));
const count = z.number().int().nonnegative();
export const flowMetricCursor = z.object({ id: z.string().uuid(), started_at: date }).strict();
export const flowMetricBase = z.object({
  flow_id: z.string().uuid(), from_at: date, through_at: date, attribution: z.literal('recorded_execution'),
  total_runs: count, node_entries: count, by_node: z.record(z.string().min(1).max(120), count), by_status: z.record(z.string().min(1).max(80), count),
  evidence_filter: z.object({ node_key: z.string().min(1).max(120).nullable(), status: z.string().min(1).max(80).nullable() }).strict(), matched_runs: count,
  records: z.array(z.object({ id: z.string().uuid(), conversation_id: z.string().uuid(), status: z.string().min(1).max(80), started_at: date, ended_at: date.nullable() }).strict()).max(20),
  next_cursor: flowMetricCursor.nullable(),
}).strict();
export const flowMetricView = flowMetricBase.refine(value => Object.values(value.by_node).reduce((a,b) => a+b,0) === value.node_entries)
  .refine(value => Object.values(value.by_status).reduce((a,b) => a+b,0) === value.total_runs)
  .refine(value => value.records.length <= value.matched_runs && value.matched_runs <= value.total_runs)
  .refine(value => new Set(value.records.map(row => row.id)).size === value.records.length)
  .refine(value => value.records.every(row => Date.parse(row.started_at) >= Date.parse(value.from_at) && Date.parse(row.started_at) < Date.parse(value.through_at)))
  .refine(value => value.next_cursor === null || value.records.length === 20 && value.next_cursor.id === value.records[19].id && value.next_cursor.started_at === value.records[19].started_at);
export type FlowMetricView = z.infer<typeof flowMetricView>;
export const flowMetricResponse = flowMetricBase.extend({ days: z.number().int().min(1).max(90).nullable(), next_cursor: z.string().regex(/^[A-Za-z0-9_-]+$/).max(500).nullable() })
  .refine(value => value.days === null || Date.parse(value.through_at) - Date.parse(value.from_at) === value.days * 86400000)
  .refine(value => Object.values(value.by_node).reduce((a,b) => a+b,0) === value.node_entries)
  .refine(value => Object.values(value.by_status).reduce((a,b) => a+b,0) === value.total_runs)
  .refine(value => value.records.length <= value.matched_runs && value.matched_runs <= value.total_runs)
  .refine(value => new Set(value.records.map(row => row.id)).size === value.records.length)
  .refine(value => value.next_cursor === null || value.records.length === 20)
  .refine(value => value.records.every(row => Date.parse(row.started_at) >= Date.parse(value.from_at) && Date.parse(row.started_at) < Date.parse(value.through_at)));
export type FlowMetricQuery = { from: string; through: string; days: number | null; node: string | null; status: string | null; cursor: z.infer<typeof flowMetricCursor> | null };
export function parseFlowMetricQuery(params: URLSearchParams, now = Date.now()): FlowMetricQuery {
  const entries = [...params];
  if (new Set(entries.map(([key])=>key)).size !== entries.length || entries.some(([key])=>!['days','from','through','node_key','status','cursor'].includes(key))) throw new Error('invalid_flow_metrics');
  const daysRaw = params.get('days'), fromRaw = params.get('from'), throughRaw = params.get('through');
  if ((fromRaw === null) !== (throughRaw === null) || daysRaw !== null && fromRaw !== null) throw new Error('invalid_flow_metrics');
  const days = fromRaw === null ? daysRaw === null ? 7 : /^\d{1,2}$/.test(daysRaw) ? Number(daysRaw) : NaN : null;
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 90)) throw new Error('invalid_flow_metrics');
  const from = fromRaw ?? new Date(now - days! * 86400000).toISOString(), through = throughRaw ?? new Date(now).toISOString();
  if (!date.safeParse(from).success || !date.safeParse(through).success || Date.parse(through) <= Date.parse(from) || Date.parse(through) - Date.parse(from) > 90 * 86400000) throw new Error('invalid_flow_metrics');
  const node = params.get('node_key'), status = params.get('status');
  if (node !== null && !z.string().min(1).max(120).safeParse(node).success || status !== null && !z.string().min(1).max(80).safeParse(status).success) throw new Error('invalid_flow_metrics');
  let cursor: FlowMetricQuery['cursor'] = null;
  const rawCursor = params.get('cursor');
  if (rawCursor !== null) {
    if (rawCursor.length > 500 || !/^[A-Za-z0-9_-]+$/.test(rawCursor)) throw new Error('invalid_flow_metrics');
    try { cursor = flowMetricCursor.parse(JSON.parse(Buffer.from(rawCursor,'base64url').toString('utf8'))); } catch { throw new Error('invalid_flow_metrics'); }
    if (Date.parse(cursor.started_at) < Date.parse(from) || Date.parse(cursor.started_at) >= Date.parse(through)) throw new Error('invalid_flow_metrics');
  }
  return { from, through, days, node, status, cursor };
}
