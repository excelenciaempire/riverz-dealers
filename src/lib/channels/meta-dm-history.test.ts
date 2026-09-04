import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./admin-client', () => ({ supabaseAdmin: () => ({}) }));

import { syncThreadMessages } from './meta-dm-history';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('syncThreadMessages', () => {
  it('fails loudly when Graph cannot read a thread, so its checkpoint is not advanced', async () => {
    const request = vi
      .fn()
      // Rich fields can be unsupported; the implementation tries the basic
      // field set once before declaring the thread unrecoverable.
      .mockResolvedValueOnce(new Response('bad rich fields', { status: 400 }))
      .mockResolvedValueOnce(
        new Response('thread unavailable', { status: 400 })
      );
    vi.stubGlobal('fetch', request);

    await expect(
      syncThreadMessages({
        token: 'page-token',
        selfId: 'page-id',
        connection: {
          id: 'connection-id',
          workspace_id: 'workspace-id',
          channel: 'instagram',
        } as never,
        threadId: 'thread-id',
        externalId: 'customer-id',
        createIfMissing: false,
      })
    ).rejects.toThrow('thread messages failed (400)');
    expect(request).toHaveBeenCalledTimes(2);
  });
});
