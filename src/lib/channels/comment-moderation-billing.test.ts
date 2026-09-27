import { beforeEach, expect, it, vi } from 'vitest';
import type { ChannelConnection } from '@/types';
const mocks = vi.hoisted(() => ({
  allowed: vi.fn(),
  decrypt: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock('@/lib/wallet/puerta', () => ({ puedeUsarIa: mocks.allowed }));
vi.mock('./admin-client', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('./encryption', () => ({ decrypt: mocks.decrypt }));
vi.mock('./message-lookup', () => ({
  findMessageByExternalId: async () => null,
}));
import { setCommentHidden } from './comment-moderation';
const connection = {
  workspace_id: 'ws-unpaid',
  secrets: { access_token: 'encrypted' },
} as unknown as ChannelConnection;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
});
it.each(['ig_comment', 'fb_comment'] as const)(
  'never moderates %s when billing blocks AI',
  async (channel) => {
    mocks.allowed.mockResolvedValue(false);
    expect(
      await setCommentHidden(connection, channel, 'comment-1', true, 'spam')
    ).toBe(false);
    expect(mocks.allowed).toHaveBeenCalledWith({}, 'ws-unpaid');
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  }
);
it('keeps authorized moderation available after activation and funding', async () => {
  mocks.allowed.mockResolvedValue(true);
  mocks.decrypt.mockReturnValue('test-token');
  mocks.fetch.mockResolvedValue({ ok: true });
  expect(
    await setCommentHidden(connection, 'ig_comment', 'comment-1', true, 'spam')
  ).toBe(true);
  expect(mocks.fetch).toHaveBeenCalledOnce();
});
