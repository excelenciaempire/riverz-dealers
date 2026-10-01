import { z } from 'zod';
/** Platform audit gets identifiers only, never nested provider parameters or selected personal data. */
export function httpActionAuditArguments(args: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const key of ['workspace_id', 'action_id', 'conversation_id']) {
    const id = z.string().uuid().safeParse(args[key]); if (id.success) out[key] = id.data.toLowerCase();
  }
  const revision = z.number().int().positive().safeParse(args.expected_revision);
  if (revision.success) out.expected_revision = revision.data;
  return out;
}
export function httpActionAuditSummary(result: unknown): string {
  if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
    const row = result as Record<string, unknown>, id = z.string().uuid().safeParse(row.receipt_id);
    if (id.success && row.state === 'acknowledged') return `http_acknowledged:${id.data}`;
  }
  return 'http_result_metadata';
}
