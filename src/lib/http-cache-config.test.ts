import 'next/dist/server/node-environment'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { unstable_getResponseFromNextConfig } from 'next/experimental/testing/server'
import nextConfig from '../../next.config'

describe('HTTP cache isolation', () => {
  afterEach(() => vi.unstubAllEnvs())

  it.each(['/', '/panel', '/dashboard', '/ingresar', '/login']) (
    'does not cache HTML or RSC responses for %s', async (path) => {
      for (const headers of [{ accept: 'text/html' }, { rsc: '1' }]) {
        const response = await unstable_getResponseFromNextConfig({
          url: `https://riverz.co${path}`,
          nextConfig,
          headers,
        })
        const policy = response.headers.get('cache-control')
        expect(policy).toContain('private')
        expect(policy).toContain('no-store')
        expect(policy).not.toContain('s-maxage')
      }
    },
  )

  // Only production builds hash chunk names, so only there are they immutable.
  it.each([
    ['/api/auth/login', 'no-store'],
    ['/_next/static/chunks/example.js', 'public, max-age=31536000, immutable'],
  ])('preserves the specific policy for %s in production', async (path, policy) => {
    vi.stubEnv('NODE_ENV', 'production')
    const response = await unstable_getResponseFromNextConfig({
      url: `https://riverz.co${path}`,
      nextConfig,
    })
    expect(response.headers.get('cache-control')).toBe(policy)
  })

  it('does not cache dev chunks, whose URLs are reused between builds', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const response = await unstable_getResponseFromNextConfig({
      url: 'https://riverz.co/_next/static/chunks/example.js',
      nextConfig,
    })
    expect(response.headers.get('cache-control')).not.toContain('immutable')
  })
})
