import { expect, it } from 'vitest';
import {
  anchoredWait,
  templatePastDeadline,
  paymentStartedAt,
} from './payment-deadline';
it('uses the actual order creation or payment rejection, not delayed webhook processing', () => {
  expect(
    paymentStartedAt(
      { order_created_at: '2026-09-26T12:00:00Z' },
      '2026-09-27T00:00:00Z'
    )
  ).toBe('2026-09-26T12:00:00Z');
  expect(
    paymentStartedAt(
      { rejected_at: '2026-09-26T12:00:00Z' },
      '2026-09-27T00:00:00Z'
    )
  ).toBe('2026-09-26T12:00:00Z');
  expect(paymentStartedAt({}, 'fallback')).toBe('fallback');
});
it('stops payment reminders at 24 hours, including a reminder deferred overnight', () => {
  const start = '2026-09-27T01:00:00Z';
  expect(
    templatePastDeadline(
      { expires_after_hours: 24 },
      start,
      Date.parse('2026-09-28T00:59:00Z')
    )
  ).toBe(false);
  expect(
    templatePastDeadline(
      { expires_after_hours: 24 },
      start,
      Date.parse('2026-09-28T12:00:00Z')
    )
  ).toBe(true);
  expect(
    templatePastDeadline({}, start, Date.parse('2026-09-28T12:00:00Z'))
  ).toBe(false);
  expect(
    templatePastDeadline({ expires_after_hours: 24 }, '', Date.now())
  ).toBe(true);
});
it('anchors the expired-payment transition to the original trigger, not the last deferred send', () => {
  expect(
    anchoredWait(
      { from_trigger_hours: 24 },
      '2026-09-27T15:00:00Z',
      new Date('2026-09-29T12:00:00Z')
    ).toISOString()
  ).toBe('2026-09-28T15:00:00.000Z');
});
