export const OUTCOME_CATEGORIES = [
  'tracking',
  'product',
  'confirmation',
  'address',
  'return',
  'other',
] as const;
export type OutcomeCategory = (typeof OUTCOME_CATEGORIES)[number];
export const AI_ORIGINS = [
  'ai_agent',
  'ai_followup',
  'comment_ai',
  'voice_agent',
] as const;

export interface OutcomeMessage {
  id: string;
  conversation_id: string;
  sender_type: string | null;
  origin: string | null;
  status: string | null;
  created_at: string;
}
export interface OutcomeConversation {
  id: string;
  channel: string;
  status: string;
  needs_human_at: string | null;
  needs_human_reason: string | null;
  last_message_at: string | null;
  contacts: { name: string | null } | null;
}
export interface OutcomeVerification {
  conversation_id: string;
  last_message_id: string;
  category: OutcomeCategory;
  verified_at: string;
}
export interface OutcomeCase {
  id: string;
  name: string | null;
  channel: string;
  at: string;
  lastMessageId: string;
  state: 'verified' | 'review' | 'human';
  category: OutcomeCategory | null;
  verifiedAt: string | null;
}
export interface OutcomeReport {
  range: { start: string; end: string };
  attended: number;
  verified: number;
  rate: number | null;
  toReview: number;
  human: number;
  pending: Array<{
    id: string;
    name: string | null;
    channel: string;
    reason: string | null;
    at: string | null;
  }>;
  cases: OutcomeCase[];
  breakdown: Record<OutcomeCategory, number>;
  trial: { until: string | null } | null;
}

export function isAiMessage(m: OutcomeMessage) {
  return (
    m.sender_type === 'bot' &&
    AI_ORIGINS.some((origin) => origin === m.origin) &&
    ['sent', 'delivered', 'read'].includes(m.status ?? '')
  );
}

/** Conservative whole-thread evidence: a manual review isn't a customer reply.
 * Any new message invalidates the review. Human replies anywhere in the thread
 * disqualify it, including before the selected reporting window.
 */
export function evaluateCase(
  c: OutcomeConversation,
  messages: OutcomeMessage[],
  review?: OutcomeVerification
): OutcomeCase | null {
  const thread = messages
    .filter((m) => m.conversation_id === c.id)
    .sort(
      (a, b) =>
        a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
    );
  const last = thread.at(-1);
  if (
    !last ||
    !thread.some(isAiMessage) ||
    !thread.some((m) => m.sender_type === 'customer')
  )
    return null;
  const human =
    Boolean(c.needs_human_at) ||
    thread.some((m) => m.sender_type === 'agent' && m.status !== 'failed');
  const verified = !human && review?.last_message_id === last.id;
  return {
    id: c.id,
    name: c.contacts?.name ?? null,
    channel: c.channel,
    at: last.created_at,
    lastMessageId: last.id,
    state: human ? 'human' : verified ? 'verified' : 'review',
    category: verified ? review!.category : null,
    verifiedAt: verified ? review!.verified_at : null,
  };
}

export function summarizeCases(cases: OutcomeCase[]) {
  const breakdown = Object.fromEntries(
    OUTCOME_CATEGORIES.map((c) => [c, 0])
  ) as Record<OutcomeCategory, number>;
  for (const c of cases)
    if (c.state === 'verified' && c.category) breakdown[c.category]++;
  const verified = cases.filter((c) => c.state === 'verified').length;
  return {
    attended: cases.length,
    verified,
    rate: cases.length ? verified / cases.length : null,
    toReview: cases.filter((c) => c.state === 'review').length,
    human: cases.filter((c) => c.state === 'human').length,
    breakdown,
  };
}
