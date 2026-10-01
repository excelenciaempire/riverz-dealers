import { z } from 'zod';
import { returnStatus } from './decision';
const date = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)));
export const returnCaseEvent = z.object({
  id: z.string().uuid(), event_sequence: z.number().int().positive().safe(), event_type: z.enum(['baseline', 'opened', 'state_changed', 'evidence_changed', 'updated']),
  occurred_at: date, actor_id: z.string().uuid().nullable(), status: returnStatus, previous_status: returnStatus.nullable(),
  resolution: z.string().nullable(), previous_resolution: z.string().nullable(), photo_count: z.number().int().nonnegative(),
}).strict();
export const returnHistoryPage = z.object({ events: z.array(returnCaseEvent).max(20), next_cursor: z.string().min(1).max(512).nullable() }).strict();
export type ReturnCaseEvent = z.infer<typeof returnCaseEvent>;
export type ReturnHistoryPage = z.infer<typeof returnHistoryPage>;
