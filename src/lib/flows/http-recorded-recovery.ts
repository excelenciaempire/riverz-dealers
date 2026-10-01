import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { httpFlowApprovalPayload } from '@/lib/approvals/http-flow';
import { continueHttpApprovalFlow } from './http-approval-resume';

const candidate = z.object({ workspace_id: z.string().uuid(), approval_id: z.string().uuid(), payload: httpFlowApprovalPayload }).strict();

/** Re-observe a recorded response; never invoke the approval dispatcher or lease a request. */
export async function recoverRecordedHttpFlows(db: SupabaseClient) {
  const result = { attempted: 0, skipped: 0, failed: 0 };
  if (!SHOW_RIVERZ_IMPROVEMENTS) return result;
  const selected = await db.rpc('list_http_flow_post_recoveries', { p_limit: 20 });
  if (selected.error || !Array.isArray(selected.data) || selected.data.length > 20) throw new Error('http_flow_recovery_unavailable');
  for (const value of selected.data) {
    const parsed = candidate.safeParse(value);
    if (!parsed.success) { result.failed++; continue; }
    try {
      const row = parsed.data;
      if (await continueHttpApprovalFlow(db, row.workspace_id, row.payload, row.approval_id)) result.attempted++;
      else result.skipped++;
    } catch { result.failed++; }
  }
  return result;
}
