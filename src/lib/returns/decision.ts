import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

export const returnStatus = z.enum(['abierta', 'aprobada', 'rechazada', 'recibida', 'resuelta']);
const timestamp = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)));
export const returnDecisionInput = z.object({
  id: z.string().uuid(), status: returnStatus,
  resolution: z.string().trim().max(500).nullable().optional(),
  expected_updated_at: timestamp.optional(),
}).strict();
export type ReturnDecisionInput = z.infer<typeof returnDecisionInput>;
export type ReturnDecisionCode = 'invalidDecision' | 'unauthorized' | 'notFound' | 'platformManaged' | 'decisionChanged' | 'saveFailed';
export class ReturnDecisionError extends Error {
  constructor(public code: ReturnDecisionCode) { super(code); }
}

const storedReturn = z.object({
  id: z.string().uuid(), order_number: z.string().nullable(), kind: z.string(), reason: z.string().nullable(),
  status: returnStatus, resolution: z.string().nullable(), updated_at: timestamp, platform: z.string().nullable(),
});
export async function loadReturnDecision(db: SupabaseClient, workspaceId: string, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new ReturnDecisionError('invalidDecision');
  const result = await db.from('returns').select('id,order_number,kind,reason,status,resolution,updated_at,platform')
    .eq('workspace_id', workspaceId).eq('id', id).maybeSingle();
  if (result.error) throw new ReturnDecisionError('saveFailed');
  if (!result.data) throw new ReturnDecisionError('notFound');
  const row = storedReturn.safeParse(result.data);
  if (!row.success || row.data.id !== id) throw new ReturnDecisionError('saveFailed');
  return row.data;
}

/** One decision service for the existing screen and Operator/MCP. This updates
 * a case status only: it does not refund, cancel or notify a customer. */
export async function decideReturn(db: SupabaseClient, workspaceId: string, actorId: string, raw: ReturnDecisionInput) {
  const parsed = returnDecisionInput.safeParse(raw);
  if (!parsed.success) throw new ReturnDecisionError('invalidDecision');
  if (!z.string().uuid().safeParse(actorId).success) throw new ReturnDecisionError('unauthorized');
  const input = parsed.data;
  const membership = await db.from('workspace_members').select('user_id')
    .eq('workspace_id', workspaceId).eq('user_id', actorId).maybeSingle();
  if (membership.error) throw new ReturnDecisionError('saveFailed');
  if (!membership.data || membership.data.user_id !== actorId) throw new ReturnDecisionError('unauthorized');
  const before = await loadReturnDecision(db, workspaceId, input.id);
  if (before.platform !== null) throw new ReturnDecisionError('platformManaged');
  const resolution = input.resolution === undefined ? before.resolution : input.resolution || null;
  if (before.status === input.status && before.resolution === resolution) return { ...before, unchanged: true };
  if (input.expected_updated_at && input.expected_updated_at !== before.updated_at) throw new ReturnDecisionError('decisionChanged');
  const result = await db.from('returns').update({ status: input.status, resolution, decided_by: actorId, decided_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId).eq('id', input.id).is('platform', null)
    .eq('status', before.status).eq('updated_at', before.updated_at)
    .select('id,order_number,kind,reason,status,resolution,updated_at,platform').maybeSingle();
  if (result.error) throw new ReturnDecisionError('saveFailed');
  if (!result.data) throw new ReturnDecisionError('decisionChanged');
  const after = storedReturn.safeParse(result.data);
  if (!after.success || after.data.id !== before.id || after.data.status !== input.status || after.data.resolution !== resolution || after.data.platform !== null) throw new ReturnDecisionError('saveFailed');
  return { ...after.data, unchanged: false };
}
