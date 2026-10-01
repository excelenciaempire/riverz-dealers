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
export type ReturnDecisionCode = 'invalidDecision' | 'unauthorized' | 'notFound' | 'platformManaged' | 'decisionChanged' | 'saveFailed' | 'readOnly';
export class ReturnDecisionError extends Error {
  constructor(public code: ReturnDecisionCode) { super(code); }
}

const storedReturn = z.object({
  id: z.string().uuid(), order_number: z.string().nullable(), kind: z.string(), reason: z.string().nullable(),
  status: returnStatus, resolution: z.string().nullable(), updated_at: timestamp, platform: z.string().nullable(),
});
function databaseFailure(message:string):never{
  const errors:Record<string,ReturnDecisionCode>={invalid_return_context:'invalidDecision',invalid_return_transition:'invalidDecision',return_access_forbidden:'unauthorized',return_not_found:'notFound',return_platform_managed:'platformManaged',return_decision_changed:'decisionChanged',return_subscription_read_only:'readOnly'};
  throw new ReturnDecisionError(errors[message]??'saveFailed');
}
export async function loadReturnDecision(db: SupabaseClient, workspaceId: string, id: string,actorId:string) {
  if (!z.string().uuid().safeParse(id).success) throw new ReturnDecisionError('invalidDecision');
  const result = await db.rpc('read_return_case_decision',{p_workspace_id:workspaceId,p_actor_id:actorId,p_case_id:id});
  if (result.error) databaseFailure(result.error.message);
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
  const result=await db.rpc('decide_return_case',{p_workspace_id:workspaceId,p_actor_id:actorId,p_case_id:input.id,p_status:input.status,
    p_resolution:input.resolution??null,p_replace_resolution:input.resolution!==undefined,p_expected_updated_at:input.expected_updated_at??null});
  if(result.error)databaseFailure(result.error.message);
  const after=storedReturn.extend({unchanged:z.boolean()}).strict().safeParse(result.data);
  if(!after.success||after.data.id!==input.id||after.data.status!==input.status||after.data.platform!==null
    ||(input.resolution!==undefined&&after.data.resolution!==(input.resolution||null)))throw new ReturnDecisionError('saveFailed');
  return after.data;
}
