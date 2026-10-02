import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { limitByKey } from '@/lib/rate-limit';
import { ruleReviewWrite, ruleReviewView, ruleReviewReceipt, ruleReviewMetrics } from './rule-review-contract';

export class RuleReviewError extends Error {
  constructor(readonly code: 'invalid' | 'notFound' | 'changed' | 'forbidden' | 'readOnly' | 'limited' | 'unavailable') { super(code); }
}
function failure(message: string): never {
  const codes: Record<string, RuleReviewError['code']> = { invalid_rule_review: 'invalid', rule_review_not_found: 'notFound', rule_review_changed: 'changed',
    rule_review_forbidden: 'forbidden', subscription_read_only: 'readOnly', rule_review_limit: 'limited' };
  throw new RuleReviewError(codes[message] ?? 'unavailable');
}
function args(workspaceId: string, actorId: string, conversationId: string, turnId: string, ruleId: string) {
  if (![workspaceId, actorId, conversationId, turnId, ruleId].every(value => z.string().uuid().safeParse(value).success)) throw new RuleReviewError('invalid');
  return { p_workspace_id: workspaceId, p_actor_id: actorId, p_conversation_id: conversationId, p_turn_id: turnId, p_rule_id: ruleId };
}
export async function readRuleReview(db: SupabaseClient, workspaceId: string, actorId: string, conversationId: string, turnId: string, ruleId: string) {
  const result = await db.rpc('read_ai_rule_review', args(workspaceId, actorId, conversationId, turnId, ruleId));
  if (result.error) failure(result.error.message);
  const view = ruleReviewView.safeParse(result.data);
  if (!view.success || view.data.turn_id !== turnId || view.data.rule_id !== ruleId) throw new RuleReviewError('unavailable');
  return view.data;
}
export async function writeRuleReview(db: SupabaseClient, workspaceId: string, actorId: string, conversationId: string, turnId: string, ruleId: string, raw: unknown) {
  const parsed = ruleReviewWrite.safeParse(raw);
  if (!parsed.success) throw new RuleReviewError('invalid');
  const context = args(workspaceId, actorId, conversationId, turnId, ruleId);
  if (!(await limitByKey(`rule-review:${workspaceId}:${actorId}`, { limit: 30, windowMs: 60_000 })).success) throw new RuleReviewError('limited');
  const result = await db.rpc('write_ai_rule_review', { ...context, p_id: parsed.data.id, p_expected_revision: parsed.data.expected_revision, p_decision: parsed.data.decision });
  if (result.error) failure(result.error.message);
  const receipt = ruleReviewReceipt.safeParse(result.data);
  if (!receipt.success || receipt.data.id !== parsed.data.id || receipt.data.turn_id !== turnId || receipt.data.rule_id !== ruleId || receipt.data.review.revision !== parsed.data.expected_revision + 1
    || receipt.data.review.actor_id !== actorId || receipt.data.review.application !== parsed.data.decision.application || receipt.data.review.transfer !== parsed.data.decision.transfer || receipt.data.review.note !== parsed.data.decision.note) throw new RuleReviewError('unavailable');
  return receipt.data;
}
export async function readRuleReviewMetrics(db: SupabaseClient, workspaceId: string, actorId: string, ruleId: string) {
  if (![workspaceId, actorId, ruleId].every(value => z.string().uuid().safeParse(value).success)) throw new RuleReviewError('invalid');
  const result = await db.rpc('ai_rule_review_metrics', { p_workspace_id: workspaceId, p_actor_id: actorId, p_rule_id: ruleId });
  if (result.error) failure(result.error.message);
  const parsed = ruleReviewMetrics.safeParse(result.data);
  if (!parsed.success) throw new RuleReviewError('unavailable');
  return parsed.data;
}
