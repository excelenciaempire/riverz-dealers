import type { SupabaseClient } from '@supabase/supabase-js';
import { caseReasonCursor, caseReasonQuery, caseReasonReport, type CaseReasonQuery } from './case-reason-contract';
export async function loadCaseReasonReport(db: SupabaseClient, workspaceId: string, actorId: string, input: CaseReasonQuery) {
  const query = caseReasonQuery.parse(input), cursor = query.cursor ? caseReasonCursor.parse(JSON.parse(query.cursor)) : null;
  const result = await db.rpc('case_reason_report', { p_workspace_id: workspaceId,p_actor_id: actorId,
    p_start: query.start,p_end: query.end,p_previous_start: query.previous_start,p_previous_end: query.previous_end,
    p_reason: query.reason ?? null,p_cursor_at: cursor?.created_at ?? null,p_cursor_id: cursor?.id ?? null,
  });
  if (result.error) throw new Error('case_reason_unavailable');
  const report = caseReasonReport.parse(result.data);
  if (report.selected_reason !== (query.reason ?? null) || ['start','end','previous_start','previous_end'].some(key => Date.parse(report[key as 'start']) !== Date.parse(query[key as 'start']))) throw new Error('case_reason_unavailable');
  return report;
}
