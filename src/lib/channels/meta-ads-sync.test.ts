import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('./encryption', () => ({ decrypt: (value: string) => value }));

import {
  adPostIdForChannel,
  isAdSyncFailure,
  isStoryForPage,
  resolveAdAccountIds,
  syncAdPostsForConnection,
} from './meta-ads-sync';

/** Supabase de mentira: `channel_connections` devuelve las hermanas dadas y
 *  `ad_posts` lo que se fue insertando. */
function fakeDb(siblings: Array<Record<string, unknown>> = []) {
  const inserted: Array<Record<string, unknown>> = [];
  const db = {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const fluent = () => chain;
      for (const m of ['select', 'eq', 'in', 'update', 'limit']) chain[m] = fluent;
      chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
      chain.insert = (row: Record<string, unknown>) => {
        inserted.push(row);
        return Promise.resolve({ error: null });
      };
      chain.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          data:
            table === 'channel_connections'
              ? siblings
              : table === 'ad_posts'
                ? inserted.map((row) => ({ post_id: row.post_id }))
                : [],
          error: null,
        }).then(resolve);
      return chain;
    },
  } as unknown as SupabaseClient;
  return { db, inserted };
}

describe('adPostIdForChannel', () => {
  const ad = {
    creative: {
      effective_object_story_id: 'page-1_post-1',
      effective_instagram_media_id: 'ig-media-1',
    },
  };

  it('Facebook usa la historia de la página e Instagram su media', () => {
    expect(adPostIdForChannel(ad, 'fb_comment', 'page-1')).toBe('page-1_post-1');
    expect(adPostIdForChannel(ad, 'ig_comment', 'page-1')).toBe('ig-media-1');
  });

  it('nunca acepta el anuncio de otra página, tampoco en Instagram', () => {
    expect(adPostIdForChannel(ad, 'ig_comment', 'page-2')).toBeNull();
    expect(adPostIdForChannel(ad, 'fb_comment', 'page-2')).toBeNull();
  });

  it('un anuncio sin media de Instagram no se mapea en esa conexión', () => {
    const soloFacebook = { creative: { effective_object_story_id: 'page-1_post-1' } };
    expect(adPostIdForChannel(soloFacebook, 'ig_comment', 'page-1')).toBeNull();
  });
});

describe('resolveAdAccountIds', () => {
  const ig = {
    id: 'ig-conn',
    workspace_id: 'ws-1',
    channel: 'ig_comment',
    config: { page_id: 'page-1', ig_user_id: 'ig-1' },
  } as never;

  it('usa las cuentas elegidas en la propia conexión', async () => {
    const { db } = fakeDb();
    expect(
      await resolveAdAccountIds(db, {
        ...(ig as object),
        config: { page_id: 'page-1', ad_account_ids: ['act_9', 'basura'] },
      } as never)
    ).toEqual(['act_9']);
  });

  it('Instagram hereda las cuentas elegidas para su página de Facebook', async () => {
    const { db } = fakeDb([
      { config: { page_id: 'page-1', ad_account_ids: ['act_1'] } },
      { config: { page_id: 'page-2', ad_account_ids: ['act_2'] } },
    ]);
    expect(await resolveAdAccountIds(db, ig)).toEqual(['act_1']);
  });

  it('sin elección no se inventan cuentas', async () => {
    const { db } = fakeDb([{ config: { page_id: 'page-1' } }]);
    expect(await resolveAdAccountIds(db, ig)).toEqual([]);
  });
});

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

  it('en Instagram guarda el media del anuncio con las cuentas de su página', async () => {
    const { db, inserted } = fakeDb([
      { config: { page_id: 'page-1', ad_account_ids: ['act_1'] } },
    ]);
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'ad-ig',
                creative: {
                  effective_object_story_id: 'page-1_post-1',
                  effective_instagram_media_id: 'ig-media-1',
                },
              },
            ],
          }),
        };
      })
    );

    const result = await syncAdPostsForConnection(db, {
      id: 'ig-conn',
      workspace_id: 'workspace-1',
      channel: 'ig_comment',
      external_account_id: 'ig-1',
      config: { page_id: 'page-1', ig_user_id: 'ig-1' },
      secrets: { user_access_token: 'token' },
    } as never);

    expect(result.status).toBe('ok');
    expect(urls[0]).toContain('effective_instagram_media_id');
    expect(inserted.map((row) => row.post_id)).toEqual(['ig-media-1']);
  });

  it('sin cuenta publicitaria elegida lo deja dicho sin marcarlo como fallo', async () => {
    const { db } = fakeDb();
    const result = await syncAdPostsForConnection(db, {
      id: 'ig-conn',
      workspace_id: 'workspace-1',
      channel: 'ig_comment',
      config: { page_id: 'page-1' },
      secrets: { user_access_token: 'token' },
    } as never);
    expect(result).toMatchObject({ status: 'not_configured', errors: ['ad_account_missing'] });
    expect(isAdSyncFailure(result)).toBe(false);
  });
});
