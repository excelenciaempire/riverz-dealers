import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  exchangeClientCredentialsForToken,
  exchangeCodeForToken,
  motivoDelRechazo,
  refreshShopifyToken,
  ShopifyCredentialsError,
} from './oauth'

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

describe('credenciales de una app del Dev Dashboard', () => {
  it('distingue la app sin instalar en la página de error de Shopify', async () => {
    // Respuesta real, medida el 2026-09-25 al conectar una app recién creada.
    const pagina =
      '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <title>400 - Oauth error app_not_installed</title>\n'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(pagina, { status: 400 })))

    const error = await exchangeClientCredentialsForToken({
      shop: 'demo.myshopify.com',
      clientId: 'id',
      clientSecret: 'secreto',
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ShopifyCredentialsError)
    expect((error as ShopifyCredentialsError).motivo).toBe('app_not_installed')
    expect((error as ShopifyCredentialsError).status).toBe(400)
  })

  it('lee el código de un rechazo en JSON', () => {
    expect(motivoDelRechazo('{"error":"invalid_client","error_description":"x"}')).toBe(
      'invalid_client',
    )
  })

  it('sin código no inventa uno', () => {
    expect(motivoDelRechazo('Not Found')).toBeNull()
  })
})
