import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { returnHistoryPage, type ReturnHistoryPage } from './history-contract';
export type { ReturnCaseEvent, ReturnHistoryPage } from './history-contract';

const cursor = z.object({ event_sequence: z.number().int().positive().safe() }).strict();
export class ReturnHistoryError extends Error {
  constructor(public code: 'invalid' | 'notFound' | 'unavailable') { super(code); }
}
export function parseReturnHistoryCursor(raw: string) {
  try { return cursor.parse(JSON.parse(raw)); }
  catch { throw new ReturnHistoryError('invalid'); }
}
export function parseReturnHistoryQuery(params: URLSearchParams) {
  const entries = [...params.entries()];
  if (entries.some(([key]) => key !== 'cursor') || entries.length > 1) throw new ReturnHistoryError('invalid');
  const parsed = z.object({ cursor: z.string().min(1).max(512).optional() }).safeParse(Object.fromEntries(entries));
  if (!parsed.success) throw new ReturnHistoryError('invalid');
  if (parsed.data.cursor) parseReturnHistoryCursor(parsed.data.cursor);
  return parsed.data;
}
/** Caller supplies an authenticated workspace. Never joins contact names or
 * attachment URLs into the event DTO, and does not claim financial execution. */
export async function loadReturnHistory(db: SupabaseClient, workspaceId: string, caseId: string, actorId: string, rawCursor?: string): Promise<ReturnHistoryPage> {
  if (![workspaceId,caseId,actorId].every(value=>z.string().uuid().safeParse(value).success)) throw new ReturnHistoryError('invalid');
  const position=rawCursor?parseReturnHistoryCursor(rawCursor):null;
  const result=await db.rpc('read_return_case_history',{p_workspace_id:workspaceId,p_actor_id:actorId,p_case_id:caseId,p_cursor_sequence:position?.event_sequence??null});
  if(result.error)throw new ReturnHistoryError(result.error.message==='return_not_found'?'notFound':'unavailable');
  const parsed=returnHistoryPage.safeParse(result.data);
  if(!parsed.success)throw new ReturnHistoryError('unavailable');
  if(parsed.data.next_cursor)parseReturnHistoryCursor(parsed.data.next_cursor);
  return parsed.data;
}
