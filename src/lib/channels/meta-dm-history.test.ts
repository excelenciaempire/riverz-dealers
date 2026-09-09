import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./admin-client', () => ({ supabaseAdmin: () => ({}) }));

import { syncThreadMessages } from './meta-dm-history';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('syncThreadMessages', () => {
  it('persists the opaque cursor and reports unfinished history at the page cap', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [], paging: { next: 'https://graph.facebook.com/v22.0/thread/messages?after=next-page&access_token=secret' },
    }))));
    const checkpoint = vi.fn();
    await expect(syncThreadMessages({
      token: 'page-token', selfId: 'page', connection: {} as never,
      threadId: 'thread', externalId: 'customer', createIfMissing: false,
      maxPages: 1, onCheckpoint: checkpoint,
    })).rejects.toThrow('meta_thread_sync_pending');
    expect(checkpoint).toHaveBeenCalledWith('next-page');
    expect(checkpoint).not.toHaveBeenCalledWith(null);
  });
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
