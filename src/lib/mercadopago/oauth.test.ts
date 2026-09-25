import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { refreshTokens } from './oauth'

/** Mercado Pago acepta el refresh sólo de la aplicación que lo emitió. */
function tokenEndpoint(owner: string) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const { client_id } = JSON.parse(String(init.body)) as { client_id: string }
    return client_id === owner
      ? new Response(JSON.stringify({ access_token: 'new', refresh_token: 'rotated', user_id: 9 }))
      : new Response('{"error":"invalid_grant"}', { status: 400 })
  })
}

function clientIds(fetchMock: ReturnType<typeof tokenEndpoint>): string[] {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body)).client_id)
}

describe('refreshTokens', () => {
  beforeEach(() => {
    vi.stubEnv('MERCADOPAGO_CLIENT_ID', '')
    vi.stubEnv('MERCADOPAGO_CLIENT_SECRET', '')
    vi.stubEnv('MERCADOLIBRE_CLIENT_ID', '111')
    vi.stubEnv('MERCADOLIBRE_CLIENT_SECRET', 'riverz-secret')
    vi.stubEnv('MERCADOLIBRE_LEGACY_CLIENT_ID', '222')
    vi.stubEnv('MERCADOLIBRE_LEGACY_CLIENT_SECRET', 'legacy-secret')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("uses Riverz's app first", async () => {
    const fetchMock = tokenEndpoint('111')
    vi.stubGlobal('fetch', fetchMock)
    await expect(refreshTokens('refresh')).resolves.toMatchObject({ accessToken: 'new' })
    expect(clientIds(fetchMock)).toEqual(['111'])
  })

  it('renews integrations authorized by the previous app', async () => {
    const fetchMock = tokenEndpoint('222')
    vi.stubGlobal('fetch', fetchMock)
    await expect(refreshTokens('refresh')).resolves.toMatchObject({ refreshToken: 'rotated' })
    expect(clientIds(fetchMock)).toEqual(['111', '222'])
  })

  it('fails when no app owns the token', async () => {
    vi.stubGlobal('fetch', tokenEndpoint('333'))
    await expect(refreshTokens('refresh')).rejects.toThrow(/400/)
  })
})
