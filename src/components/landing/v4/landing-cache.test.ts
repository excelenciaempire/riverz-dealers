import { afterEach, describe, expect, it, vi } from 'vitest';
import config from '../../../../next.config';

afterEach(() => vi.unstubAllEnvs());

describe('landing development asset freshness', () => {
  it('does not cache development chunks as immutable', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const headers = await config.headers!();
    expect(headers.find(rule => rule.source === '/_next/static/:path*')).toBeUndefined();
  });
  it('preserves production hashed-asset caching', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const headers = await config.headers!();
    expect(headers.find(rule => rule.source === '/_next/static/:path*')?.headers)
      .toContainEqual({ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' });
  });
});
