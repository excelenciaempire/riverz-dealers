import { afterEach, describe, expect, it, vi } from 'vitest';
const { save, encrypt, decrypt } = vi.hoisted(() => ({
  save: vi.fn(), encrypt: vi.fn((s: string) => `encrypted:${s}`),
  decrypt: vi.fn((s: string) => s.replace('encrypted:', '')),
}));
vi.mock('../encryption', () => ({ encrypt, decrypt }));
vi.mock('../admin-client', () => ({ supabaseAdmin: () => ({
  from: () => ({ update: () => ({ eq: save }) }),
}) }));
import { getFreshTikTokToken } from './adapter';
import type { ChannelConnection } from '@/types';
const connection = { id: 'test', config: { token_expires_at: '2000-01-01' },
  secrets: { access_token: 'encrypted:old', refresh_token: 'encrypted:refresh' },
} as unknown as ChannelConnection;
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('TikTok token renewal', () => {
  it('shares a renewal across simultaneous poll and webhook requests', async () => {
    save.mockResolvedValue({ error: null });
    const fetcher = vi.fn(async () => Response.json({ code: 0,
      data: { access_token: 'fresh', refresh_token: 'rotated', expires_in: 86400 } }));
    vi.stubGlobal('fetch', fetcher);
    expect(await Promise.all([getFreshTikTokToken(connection), getFreshTikTokToken(connection)]))
      .toEqual(['fresh', 'fresh']);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(encrypt).toHaveBeenCalledWith('rotated');
  });
  it('does not claim success if rotated credentials could not be stored', async () => {
    save.mockResolvedValue({ error: { code: 'DB_UNAVAILABLE' } });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 0, data: { access_token: 'fresh' } })));
    await expect(getFreshTikTokToken(connection)).rejects.toThrow('cannot persist');
  });
  it('uses a still-valid token without calling the provider', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    expect(await getFreshTikTokToken({ ...connection,
      config: { token_expires_at: new Date(Date.now() + 3600000).toISOString() },
    })).toBe('old');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
