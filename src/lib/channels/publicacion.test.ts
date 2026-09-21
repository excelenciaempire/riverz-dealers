import { afterEach, describe, expect, it, vi } from 'vitest';
import { briefDePublicacionPorOrigen } from './publicacion';
import { briefDeVideo } from './tiktok_comment/videos';
vi.mock('./tiktok_comment/videos', () => ({ briefDeVideo: vi.fn(async () => 'Video actual: Puma'), videoDelHilo: vi.fn() }));
vi.mock('./publicacion-media', () => ({ briefDeMedio: async () => null }));
vi.mock('./encryption', () => ({ decrypt: () => 'test-token' }));
vi.mock('./meta-graph', () => ({ withAppsecretProof: (url: string) => url }));

function database() {
  return { from: (table: string) => {
    const q = { select: () => q, eq: () => q, update: () => q,
      upsert: async () => ({ error: null }),
      maybeSingle: async () => ({ data: table === 'channel_connections' ? { secrets: { access_token: 'encrypted' } } : null }),
    }; return q;
  } } as never;
}
afterEach(() => vi.unstubAllGlobals());
describe('publication context across Meta channels', () => {
  it('uses the current TikTok video instead of an older conversation source', async () => {
    const db = database();
    expect(await briefDePublicacionPorOrigen(db, { workspaceId: 'workspace', channel: 'tiktok_comment', postId: 'current-video' })).toBe('Video actual: Puma');
    expect(briefDeVideo).toHaveBeenCalledWith(db, 'workspace', 'current-video');
  });
  for (const [channel, field] of [['fb_comment', 'message'], ['ig_comment', 'caption']] as const) {
    it(`reads ${channel} without asking Graph for an unsupported field`, async () => {
      const fetchMock = vi.fn(async (url: string) => {
        const fields = new URL(url).searchParams.get('fields');
        return fields === field
          ? new Response(JSON.stringify({ [field]: 'Puma Suede XL: segundo par gratis' }))
          : new Response(JSON.stringify({ error: 'Nonexisting field' }), { status: 400 });
      });
      vi.stubGlobal('fetch', fetchMock);
      const result = await briefDePublicacionPorOrigen(database(), { workspaceId: 'workspace', channel, postId: 'post', connectionId: 'connection' });
      expect(result).toContain('Puma Suede XL: segundo par gratis');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  }
  it('does not invent context when the post cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
    expect(await briefDePublicacionPorOrigen(database(), { workspaceId: 'workspace', channel: 'fb_comment', postId: 'post', connectionId: 'connection' })).toBeNull();
  });
});
