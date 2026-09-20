import { describe, expect, it } from 'vitest';
import {
  evaluateCase,
  summarizeCases,
  type OutcomeConversation,
  type OutcomeMessage,
  type OutcomeVerification,
} from './outcomes';

const conversation: OutcomeConversation = {
  id: 'c',
  channel: 'whatsapp',
  status: 'open',
  needs_human_at: null,
  needs_human_reason: null,
  last_message_at: null,
  contacts: { name: 'Ana' },
};
const customer: OutcomeMessage = {
  id: '1',
  conversation_id: 'c',
  sender_type: 'customer',
  origin: null,
  status: 'received',
  created_at: '2026-09-01T10:00:00Z',
};
const ai: OutcomeMessage = {
  ...customer,
  id: '2',
  sender_type: 'bot',
  origin: 'ai_agent',
  status: 'sent',
  created_at: '2026-09-01T10:01:00Z',
};
const review: OutcomeVerification = {
  conversation_id: 'c',
  last_message_id: '2',
  category: 'tracking',
  verified_at: '2026-09-01T10:02:00Z',
};

describe('verified resolutions', () => {
  it('does not infer resolution from silence, closure, or absence of assignment', () => {
    for (const status of ['open', 'resolved', 'closed'])
      expect(
        evaluateCase({ ...conversation, status }, [customer, ai])?.state
      ).toBe('review');
  });
  it('requires explicit verification of the latest message', () => {
    expect(evaluateCase(conversation, [ai, customer], review)?.state).toBe(
      'verified'
    );
  });
  it('invalidates evidence when any new message arrives', () => {
    for (const sender_type of ['customer', 'bot', 'agent']) {
      const next = {
        ...customer,
        id: '3',
        sender_type,
        created_at: '2026-09-01T10:03:00Z',
      };
      expect(
        evaluateCase(conversation, [customer, ai, next], review)?.state
      ).not.toBe('verified');
    }
  });
  it('detects human replies before the reporting window, even with a later review', () => {
    const human = {
      ...ai,
      id: '0',
      sender_type: 'agent',
      created_at: '2026-08-01T10:00:00Z',
    };
    expect(
      evaluateCase(conversation, [human, customer, ai], review)?.state
    ).toBe('human');
  });
  it('does not count an escalated conversation even after verification', () => {
    expect(
      evaluateCase(
        { ...conversation, needs_human_at: '2026-09-01T10:04:00Z' },
        [customer, ai],
        review
      )?.state
    ).toBe('human');
  });
  it('does not mistake a campaign, failed AI response, or outbound-only contact for a handled case', () => {
    expect(
      evaluateCase(
        conversation,
        [customer, { ...ai, origin: 'broadcast' }],
        review
      )
    ).toBeNull();
    expect(
      evaluateCase(
        conversation,
        [customer, { ...ai, status: 'failed' }],
        review
      )
    ).toBeNull();
    expect(evaluateCase(conversation, [ai], review)).toBeNull();
  });
  it('uses a stable tie-breaker for simultaneous messages', () => {
    expect(
      evaluateCase(conversation, [customer, ai, { ...ai, id: '3' }], review)
        ?.state
    ).toBe('review');
  });
  it('counts each conversation once and exposes the denominator including unverified cases', () => {
    const verified = evaluateCase(conversation, [customer, ai], review)!;
    const pending = {
      ...verified,
      id: 'd',
      state: 'review' as const,
      category: null,
    };
    const human = { ...pending, id: 'e', state: 'human' as const };
    const result = summarizeCases([verified, pending, human]);
    expect(result).toMatchObject({
      attended: 3,
      verified: 1,
      rate: 1 / 3,
      toReview: 1,
      human: 1,
    });
    expect(result.breakdown.tracking).toBe(1);
    expect(summarizeCases([]).rate).toBeNull();
  });
});
