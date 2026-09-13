import 'next/dist/server/node-environment'
import { describe, expect, it } from 'vitest'
import { unstable_getResponseFromNextConfig } from 'next/experimental/testing/server'
import nextConfig from '../../next.config'

describe('HTTP cache isolation', () => {
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

  it.each([
    ['/api/auth/login', 'no-store'],
    ['/_next/static/chunks/example.js', 'public, max-age=31536000, immutable'],
  ])('preserves the specific policy for %s', async (path, policy) => {
    const response = await unstable_getResponseFromNextConfig({
      url: `https://riverz.co${path}`,
      nextConfig,
    })
    expect(response.headers.get('cache-control')).toBe(policy)
  })
})
