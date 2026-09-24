import { afterEach, describe, expect, it, vi } from 'vitest'

import { clientIp, detectLocaleWithIp } from './detect'

afterEach(() => vi.unstubAllGlobals())

describe('first-visit locale detection', () => {
  it('prefers the edge client IP over an X-Forwarded-For chain', () => {
    const headers = new Headers({
      'cf-connecting-ip': '203.0.113.42',
      'x-forwarded-for': '8.8.8.8, 203.0.113.42',
    })
    expect(clientIp(headers)).toBe('203.0.113.42')
  })

  it('prefers the country header over the browser language', async () => {
    const headers = new Headers({ 'cf-ipcountry': 'CO', 'accept-language': 'en-US' })
    expect(await detectLocaleWithIp(headers)).toBe('es')
  })

  it('uses the client IP when the host provides no country header', async () => {
    const lookup = vi.fn().mockResolvedValue(new Response('US'))
    vi.stubGlobal('fetch', lookup)
    const headers = new Headers({
      'x-forwarded-for': '8.8.8.8, 10.0.0.1',
      'accept-language': 'es-ES',
      'user-agent': 'Mozilla/5.0',
    })

    expect(await detectLocaleWithIp(headers)).toBe('en')
    expect(lookup).toHaveBeenCalledOnce()
    expect(lookup.mock.calls[0][0]).toContain('/8.8.8.8/country/')
  })

  it('falls back to the browser language when IP lookup fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('lookup unavailable')))
    const headers = new Headers({
      'x-forwarded-for': '8.8.8.8',
      'accept-language': 'en-US,en;q=0.9',
      'user-agent': 'Mozilla/5.0',
    })

    expect(await detectLocaleWithIp(headers)).toBe('en')
  })
})
