import { z } from 'zod';
const at = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)));
export const ruleReviewDecision = z.object({
  application: z.enum(['applied', 'missed', 'not_applicable', 'unverified']),
  transfer: z.enum(['related', 'unrelated', 'not_assessed']),
  note: z.string().trim().max(600), confirmed: z.literal(true),
}).strict().refine(value => !(value.application === 'not_applicable' && value.transfer === 'related'))
  .refine(value => !(value.application === 'missed' || value.transfer === 'related') || value.note.length >= 10);
export const ruleReviewWrite = z.object({ id: z.string().uuid(), expected_revision: z.number().int().min(0).max(2147483646), decision: ruleReviewDecision }).strict();
export const ruleReviewRecord = z.object({
  revision: z.number().int().positive(), application: z.enum(['applied', 'missed', 'not_applicable', 'unverified']),
  transfer: z.enum(['related', 'unrelated', 'not_assessed']), note: z.string().max(600),
  actor_id: z.string().uuid().nullable(), actor_name: z.string().max(120).nullable(), changed_at: at,
}).strict();
export const ruleReviewView = z.object({
  turn_id: z.string().uuid(), rule_id: z.string().uuid(), rule_revision: z.number().int().positive(),
  rule: z.object({ titulo: z.string().max(1000), cuando: z.string().nullable(), hacer: z.string().max(10000) }).strict(),
  review: ruleReviewRecord.nullable(), history: z.array(ruleReviewRecord.extend({ id: z.string().uuid() })).max(20), history_truncated: z.boolean(),
  can_edit: z.boolean(), attribution: z.literal('team_assessment'),
}).strict();
export const ruleReviewReceipt = z.object({ id: z.string().uuid(), turn_id: z.string().uuid(), rule_id: z.string().uuid(), review: ruleReviewRecord, attribution: z.literal('team_assessment') }).strict();
export type RuleReviewView = z.infer<typeof ruleReviewView>;
export const ruleReviewMetrics = z.object({
  attribution: z.literal('team_assessment'), reviewed_turns: z.number().int().min(0), applied_turns: z.number().int().min(0), missed_turns: z.number().int().min(0),
  not_applicable_turns: z.number().int().min(0), unverified_turns: z.number().int().min(0), eligible_turns: z.number().int().min(0),
  related_transfer_turns: z.number().int().min(0), assessed_transfer_turns: z.number().int().min(0), distinct_reviewed_cases: z.number().int().min(0),
  application_rate: z.number().min(0).max(100).nullable(),
}).strict().refine(value => value.reviewed_turns === value.applied_turns + value.missed_turns + value.not_applicable_turns + value.unverified_turns)
  .refine(value => value.eligible_turns === value.applied_turns + value.missed_turns)
  .refine(value => value.related_transfer_turns <= value.assessed_transfer_turns && value.assessed_transfer_turns <= value.reviewed_turns)
  .refine(value => value.distinct_reviewed_cases <= value.reviewed_turns)
  .refine(value => (value.eligible_turns === 0) === (value.application_rate === null))
  .refine(value => value.application_rate === null || Math.abs(value.application_rate - 100 * value.applied_turns / value.eligible_turns) <= 0.051);
