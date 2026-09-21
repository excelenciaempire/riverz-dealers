import { describe, expect, it } from 'vitest';
import { metaHumanReplyExpired, replyWindowHours } from './meta-window';

describe('Meta manual reply window', () => {
  const now = Date.parse('2026-09-21T12:00:00Z');

  it('keeps Instagram and Messenger open for a human reply for seven days', () => {
    expect(
      metaHumanReplyExpired('instagram', '2026-09-19T19:07:54Z', now)
    ).toBe(false);
    expect(
      metaHumanReplyExpired('messenger', '2026-09-15T12:00:01Z', now)
    ).toBe(false);
    expect(replyWindowHours('instagram')).toBe(168);
  });

  it('closes the human reply window after seven days', () => {
    expect(
      metaHumanReplyExpired('instagram', '2026-09-14T11:59:59Z', now)
    ).toBe(true);
  });

  it('does not apply the human-agent rule to WhatsApp', () => {
    expect(metaHumanReplyExpired('whatsapp', '2020-01-01T00:00:00Z', now)).toBe(
      false
    );
    expect(replyWindowHours('whatsapp')).toBe(24);
  });
});
