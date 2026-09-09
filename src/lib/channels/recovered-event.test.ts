import { describe, expect, it } from 'vitest';
import { recoveredEvent } from './recovered-event';
import type { InboundEvent } from './types';

describe('passive recovery', () => {
  const now = Date.parse('2026-09-09T18:00:00Z');
  const event = (at: string, requested = '2026-09-08T00:00:00Z') => ({
    receivedAt: at, connection: { config: { sync_requested_at: requested } },
  }) as unknown as InboundEvent;
  it('does not wake automations for a pre-connection message', () => {
    expect(recoveredEvent(event('2026-09-09T17:59:00Z', '2026-09-09T18:00:00Z'), now))
      .toMatchObject({ historical: true, suppressAutoReply: true });
  });
  it('recovers old or malformed timestamps passively', () => {
    for (const at of ['2026-09-09T15:00:00Z', 'invalid']) {
      expect(recoveredEvent(event(at), now)).toMatchObject({ historical: true, suppressAutoReply: true });
    }
  });
  it('preserves live polling for newly received messages', () => {
    const fresh = event('2026-09-09T17:59:00Z');
    expect(recoveredEvent(fresh, now)).toBe(fresh);
  });
});
