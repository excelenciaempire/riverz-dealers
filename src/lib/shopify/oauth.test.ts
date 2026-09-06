import { afterEach, describe, expect, it, vi } from 'vitest'
import { exchangeCodeForToken, refreshShopifyToken } from './oauth'

afterEach(() => vi.unstubAllGlobals())

function successfulTokenResponse() {
  return new Response(
    JSON.stringify({
      access_token: 'access',
      scope: 'read_products',
      expires_in: 3600,
      refresh_token: 'refresh',
      refresh_token_expires_in: 7_776_000,
    }),
    { status: 200 },
  )
}

describe('Shopify OAuth token requests', () => {
  it('canjea el código con el formulario oficial y token offline que expira', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successfulTokenResponse())
    vi.stubGlobal('fetch', fetchMock)

    await exchangeCodeForToken({
      shop: 'pilar-test.myshopify.com',
      code: 'code',
      apiKey: 'client',
      apiSecret: 'secret',
    })

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.headers).toEqual({
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    })
    expect(init.body).toBeInstanceOf(URLSearchParams)
    expect(String(init.body)).toBe(
      'client_id=client&client_secret=secret&code=code&expiring=1',
    )
  })

  it('renueva el token con un formulario y no con JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successfulTokenResponse())
    vi.stubGlobal('fetch', fetchMock)

    await refreshShopifyToken({
      shop: 'pilar-test.myshopify.com',
      refreshToken: 'refresh',
      apiKey: 'client',
      apiSecret: 'secret',
    })

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.body).toBeInstanceOf(URLSearchParams)
    expect(String(init.body)).toBe(
      'client_id=client&client_secret=secret&grant_type=refresh_token&refresh_token=refresh',
    )
  })
})
