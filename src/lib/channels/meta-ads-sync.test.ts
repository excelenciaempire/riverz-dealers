import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('./encryption', () => ({ decrypt: (value: string) => value }));

import {
  isAdSyncFailure,
  isStoryForPage,
  syncAdPostsForConnection,
} from './meta-ads-sync';

describe('isStoryForPage', () => {
  it('acepta únicamente creatividades de la página conectada', () => {
    expect(isStoryForPage('461369457740375_123', '461369457740375')).toBe(true);
    expect(isStoryForPage('otra_pagina_123', '461369457740375')).toBe(false);
    expect(isStoryForPage('4613694577403750_123', '461369457740375')).toBe(
      false
    );
  });
});

describe('isAdSyncFailure', () => {
  it('does not fail when a comments-only connection has no ad account', () => {
    expect(isAdSyncFailure({ status: 'not_configured' })).toBe(false);
    expect(isAdSyncFailure({ status: 'ok' })).toBe(false);
    expect(isAdSyncFailure({ status: 'partial' })).toBe(true);
    expect(isAdSyncFailure({ status: 'failed' })).toBe(true);
    expect(isAdSyncFailure({ error: 'network' })).toBe(true);
  });
});

describe('syncAdPostsForConnection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('descubre anuncios de la cuenta elegida y descarta historias de otra página', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const db = {
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        const fluent = () => chain;
        chain.select = fluent;
        chain.eq = fluent;
        chain.in = fluent;
        chain.update = fluent;
        chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
        chain.insert = (row: Record<string, unknown>) => {
          inserted.push(row);
          return Promise.resolve({ error: null });
        };
        chain.then = (resolve: (value: unknown) => unknown) =>
          Promise.resolve({
            data:
              table === 'ad_posts'
                ? inserted.map((row) => ({ post_id: row.post_id }))
                : [],
            error: null,
          }).then(resolve);
        return chain;
      },
    } as unknown as SupabaseClient;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () => ({
          data: url.includes('act_1')
            ? [
                {
                  id: 'ad-ok',
                  creative: { effective_object_story_id: 'page-1_post-1' },
                },
              ]
            : [
                {
                  id: 'ad-other',
                  creative: { effective_object_story_id: 'page-2_post-2' },
                },
              ],
        }),
      }))
    );

    const result = await syncAdPostsForConnection(db, {
      id: 'connection-1',
      workspace_id: 'workspace-1',
      channel: 'fb_comment',
      external_account_id: 'page-1',
      config: { page_id: 'page-1', ad_account_ids: ['act_1', 'act_2'] },
      secrets: { user_access_token: 'token' },
    } as never);

    expect(result.status).toBe('ok');
    expect(result.discoveredPosts).toBe(1);
    expect(inserted.map((row) => row.post_id)).toEqual(['page-1_post-1']);
  });
});
