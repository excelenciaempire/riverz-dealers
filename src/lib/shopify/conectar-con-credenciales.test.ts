import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * La app que el comercio crea en su organización no avisa cuando la instalan:
 * su URL puede ser cualquiera. La tienda queda "esperando" y Riverz reintenta
 * con las credenciales guardadas hasta que el grant funciona.
 */

const mocks = vi.hoisted(() => ({
  persistir: vi.fn(),
  conectada: null as unknown,
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: (valor: string) => `cifrado:${valor}`,
  decrypt: (valor: string) => valor.replace(/^cifrado:/, ''),
}))
vi.mock('next/server', () => ({ after: () => undefined }))
vi.mock('./connection', () => ({
  getConnectionByShop: async () => mocks.conectada,
  persistShopifyConnection: mocks.persistir,
}))
vi.mock('./admin-client', () => ({
  ShopifyAdminClient: class {
    async getShopInfo() {
      return { name: 'Revitaly' }
    }
    async registerWebhooks() {}
  },
}))
vi.mock('./product-sync', () => ({ syncShopifyProducts: async () => undefined }))
vi.mock('@/lib/products/scrape-catalog-sources', () => ({
  scrapeShopifyCatalogSources: async () => undefined,
}))

import { conectarPendientes } from './conectar-con-credenciales'

const db = {
  from: () => {
    const chain = {
      select: () => chain,
      order: () => chain,
      eq: () => chain,
      limit: () => chain,
      then: (listo: (r: unknown) => void) =>
        listo({
          data: [
            {
              workspace_id: 'ws-revitaly',
              user_id: 'equipo-riverz',
              shop_domain: 'tkjiax-hc.myshopify.com',
              client_id: 'app-revitaly',
              client_secret_encrypted: 'cifrado:secreto-revitaly',
            },
          ],
          error: null,
        }),
    }
    return chain
  },
}

beforeEach(() => {
  mocks.persistir.mockReset()
  mocks.conectada = null
})
afterEach(() => vi.unstubAllGlobals())

describe('la tienda que espera que instalen su app', () => {
  it('se conecta sola cuando ya está instalada', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ access_token: 'token', scope: 'read_orders', expires_in: 86399 }), {
          status: 200,
        }),
      ),
    )

    const conectadas = await conectarPendientes(db as never, { callbackBase: 'https://riverz.co' })

    expect(conectadas).toBe(1)
    expect(mocks.persistir).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        workspaceId: 'ws-revitaly',
        userId: 'equipo-riverz',
        shopDomain: 'tkjiax-hc.myshopify.com',
        clientId: 'app-revitaly',
        webhookSecret: 'secreto-revitaly',
        connectionMethod: 'client_credentials',
      }),
    )
  })

  it('mientras no la instalen, sigue esperando sin tocar nada', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('<title>400 - Oauth error app_not_installed</title>', { status: 400 }),
      ),
    )

    expect(await conectarPendientes(db as never, { callbackBase: 'https://riverz.co' })).toBe(0)
    expect(mocks.persistir).not.toHaveBeenCalled()
  })

  it('una tienda que ya quedó conectada no se vuelve a intentar', async () => {
    mocks.conectada = { row: {}, accessToken: 'x' }
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(await conectarPendientes(db as never, { callbackBase: 'https://riverz.co' })).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
