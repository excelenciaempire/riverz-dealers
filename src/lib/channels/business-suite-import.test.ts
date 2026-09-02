import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection } from '@/types';

const ingested: Array<Record<string, unknown>> = [];
const existingIds = new Set<string>();

vi.mock('./inbox-writer', () => ({
  ingestInboundEvent: vi.fn(async (_db: unknown, event: Record<string, unknown>) => {
    ingested.push(event);
    return { id: 'message-1' };
  }),
}));
vi.mock('./message-lookup', () => ({
  findMessageByExternalId: vi.fn(async (_db: unknown, args: { externalMessageId: string }) =>
    existingIds.has(args.externalMessageId) ? { id: 'already-there' } : null
  ),
}));

import { importBusinessSuiteComments } from './business-suite-import';

const connection = {
  id: 'conn-fb',
  workspace_id: 'workspace-1',
  channel: 'fb_comment',
  config: { page_id: 'page-1' },
} as unknown as ChannelConnection;

describe('importBusinessSuiteComments', () => {
  beforeEach(() => {
    ingested.length = 0;
    existingIds.clear();
  });

  it('importa los comentarios de Business Suite como historia pasiva', async () => {
    const result = await importBusinessSuiteComments(
      {} as SupabaseClient,
      connection,
      [
        {
          commentId: 'comment-1',
          postId: 'reel-1',
          authorName: 'Ana',
          text: '¿Cuál es el precio?',
          createdAt: '2026-08-30T21:49:00.000Z',
          permalink: 'https://business.facebook.com/reel/reel-1/?comment_id=comment-1',
        },
      ]
    );

    expect(result).toEqual({ imported: 1, alreadyPresent: 0, skipped: 0 });
    expect(ingested[0]).toMatchObject({
      channel: 'fb_comment',
      externalContactId: 'business-suite-comment:comment-1',
      externalMessageId: 'comment-1',
      contactName: 'Ana',
      text: '¿Cuál es el precio?',
      suppressAutoReply: true,
      comment: {
        postId: 'reel-1',
        permalink: 'https://business.facebook.com/reel/reel-1/?comment_id=comment-1',
      },
    });
  });

  it('no duplica un comentario que ya estaba en el mismo comercio', async () => {
    existingIds.add('comment-1');
    const result = await importBusinessSuiteComments(
      {} as SupabaseClient,
      connection,
      [
        {
          commentId: 'comment-1',
          postId: 'reel-1',
          text: 'Ya estaba',
          createdAt: '2026-08-30T21:49:00.000Z',
        },
      ]
    );

    expect(result).toEqual({ imported: 0, alreadyPresent: 1, skipped: 0 });
    expect(ingested).toHaveLength(0);
  });

  it('rechaza una conexión que no es de comentarios de Facebook', async () => {
    await expect(
      importBusinessSuiteComments({} as SupabaseClient, {
        ...connection,
        channel: 'ig_comment',
      } as ChannelConnection, [])
    ).rejects.toThrow('business_suite_requires_facebook_comments_connection');
  });
});
