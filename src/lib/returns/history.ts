import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { returnStatus } from './decision';
import { returnHistoryPage, type ReturnHistoryPage } from './history-contract';
export type { ReturnCaseEvent, ReturnHistoryPage } from './history-contract';

const date = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)));
const cursor = z.object({ event_sequence: z.number().int().positive().safe() }).strict();
const snapshot = z.object({ status: returnStatus, resolution: z.string().nullable(), photos: z.array(z.string()) });
const storedEvent = z.object({
  id: z.string().uuid(), event_sequence: z.number().int().positive().safe(), workspace_id: z.string().uuid(), case_id: z.string().uuid(),
  event_type: z.enum(['baseline', 'opened', 'state_changed', 'evidence_changed', 'updated']),
  occurred_at: date, actor_id: z.string().uuid().nullable(), snapshot,
  previous_snapshot: snapshot.nullable(),
});
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
export async function loadReturnHistory(db: SupabaseClient, workspaceId: string, caseId: string, rawCursor?: string): Promise<ReturnHistoryPage> {
  if (!z.string().uuid().safeParse(workspaceId).success || !z.string().uuid().safeParse(caseId).success) throw new ReturnHistoryError('invalid');
  const position = rawCursor ? parseReturnHistoryCursor(rawCursor) : null;
  const existing = await db.from('returns').select('id').eq('workspace_id', workspaceId).eq('id', caseId).maybeSingle();
  if (existing.error) throw new ReturnHistoryError('unavailable');
  if (!existing.data || existing.data.id !== caseId) throw new ReturnHistoryError('notFound');
  let query = db.from('return_case_events').select('id,event_sequence,workspace_id,case_id,event_type,occurred_at,actor_id,snapshot,previous_snapshot')
    .eq('workspace_id', workspaceId).eq('case_id', caseId)
    .order('event_sequence', { ascending: false });
  if (position) query = query.lt('event_sequence', position.event_sequence);
  const result = await query.limit(21);
  if (result.error || !Array.isArray(result.data)) throw new ReturnHistoryError('unavailable');
  const events = result.data.slice(0, 20).map(value => {
    const parsed = storedEvent.safeParse(value);
    if (!parsed.success || parsed.data.workspace_id !== workspaceId || parsed.data.case_id !== caseId) throw new ReturnHistoryError('unavailable');
    const row = parsed.data;
    return { id: row.id, event_sequence: row.event_sequence, event_type: row.event_type, occurred_at: row.occurred_at, actor_id: row.actor_id,
      status: row.snapshot.status, previous_status: row.previous_snapshot?.status ?? null,
      resolution: row.snapshot.resolution, previous_resolution: row.previous_snapshot?.resolution ?? null,
      photo_count: row.snapshot.photos.length };
  });
  const last = events[events.length - 1];
  return returnHistoryPage.parse({ events, next_cursor: result.data.length > 20 && last ? JSON.stringify({ event_sequence: last.event_sequence }) : null });
}
