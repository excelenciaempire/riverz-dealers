import { describe, expect, it } from 'vitest';
import { commentSendContext } from './send-context';

describe('comment delivery case', () => {
  it.each(['fb_comment', 'ig_comment'] as const)('preserves the source case for public and private replies on %s', channel => {
    expect(commentSendContext({ id: 'live-comment-case' }, channel, 'external-comment', 'post'))
      .toEqual({ id: 'live-comment-case', thread_external_id: 'external-comment' });
  });
  it('keeps the TikTok video target without losing the case guard', () => {
    expect(commentSendContext({ id: 'case' }, 'tiktok_comment', 'comment', 'video'))
      .toEqual({ id: 'case', thread_external_id: 'video:video|comment:comment' });
  });
  it('refuses to dispatch with a missing source case or comment', () => {
    for (const thread of [null, { id: '' }, { id: ' ' }]) {
      expect(() => commentSendContext(thread, 'fb_comment', 'comment')).toThrow('comment_send_context_unavailable');
    }
    expect(() => commentSendContext({ id: 'case' }, 'fb_comment', '')).toThrow('comment_send_context_unavailable');
  });
});
