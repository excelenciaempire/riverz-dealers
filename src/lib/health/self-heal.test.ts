import { describe, expect, it } from 'vitest';
import { isStalledRunning, RUNNING_GRACE_MS } from './self-heal';

describe('isStalledRunning', () => {
  const now = Date.parse('2026-09-04T16:00:00.000Z');

  it('only recovers a claim older than the safe grace period', () => {
    expect(isStalledRunning(new Date(now - RUNNING_GRACE_MS).toISOString(), now)).toBe(true);
    expect(isStalledRunning(new Date(now - RUNNING_GRACE_MS + 1).toISOString(), now)).toBe(false);
  });

  it('does not guess when the timestamp is absent or invalid', () => {
    expect(isStalledRunning(null, now)).toBe(false);
    expect(isStalledRunning('not-a-date', now)).toBe(false);
  });
});
