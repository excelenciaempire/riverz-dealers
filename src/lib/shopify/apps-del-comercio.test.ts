import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: (valor: string) => `cifrado:${valor}`,
  decrypt: (valor: string) => valor.replace(/^cifrado:/, ''),
}))

import { appQueFirmo, type AppDeShopify } from './apps-del-comercio'
import { resolveShopWebhookSecret } from './connection'
import { tokenVivo } from './token-vivo'

/** Firma una consulta como lo hace Shopify: hex HMAC-SHA256 de los pares ordenados. */
function firmada(params: Record<string, string>, secreto: string): URLSearchParams {
  const q = new URLSearchParams(params)
  const mensaje = [...q.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('&')
  q.set('hmac', createHmac('sha256', secreto).update(mensaje).digest('hex'))
  return q
}

const PUBLICA: AppDeShopify = { apiKey: 'publica', apiSecret: 'secreto-publico', destino: null }
const DEL_COMERCIO: AppDeShopify = {
  apiKey: 'app-revitaly',
  apiSecret: 'secreto-revitaly',
  destino: { workspaceId: 'ws-revitaly', userId: 'equipo-riverz' },
}

describe('qué app firmó la instalación', () => {
  const params = { shop: 'tkjiax-hc.myshopify.com', timestamp: '1', host: 'x' }

  it('la firma elige la app del comercio y trae su workspace', () => {
    const app = appQueFirmo([PUBLICA, DEL_COMERCIO], firmada(params, 'secreto-revitaly'))
    expect(app?.apiKey).toBe('app-revitaly')
    expect(app?.destino?.workspaceId).toBe('ws-revitaly')
  })

  it('la pública sigue siendo la pública', () => {
    expect(appQueFirmo([PUBLICA, DEL_COMERCIO], firmada(params, 'secreto-publico'))).toBe(PUBLICA)
  })

  it('una firma que no valida con ningún secreto no elige ninguna', () => {
    expect(appQueFirmo([PUBLICA, DEL_COMERCIO], firmada(params, 'otro'))).toBeNull()
  })
})

describe('una tienda conectada por la app del comercio', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('verifica sus webhooks con el secreto de esa app, no con el global', async () => {
    const db = {
      from: () => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({
            data: { connection_method: 'custom_app', webhook_secret: 'cifrado:secreto-revitaly' },
          }),
        }
        return chain
      },
    }
    expect(await resolveShopWebhookSecret(db as never, 'tkjiax-hc.myshopify.com')).toEqual({
      mode: 'per_store',
      secret: 'secreto-revitaly',
    })
  })

  describe('renueva su token', () => {
    beforeEach(() => {
      vi.stubEnv('SHOPIFY_API_KEY', 'publica')
      vi.stubEnv('SHOPIFY_API_SECRET', 'secreto-publico')
    })
    afterEach(() => vi.unstubAllEnvs())

    it('con las credenciales de su app', async () => {
      const fetchMock = vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({ access_token: 'nuevo', scope: 'read_orders', expires_in: 3600 }),
            { status: 200 },
          ),
      )
      vi.stubGlobal('fetch', fetchMock)
      const db = {
        from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
      }

      const r = await tokenVivo(db as never, {
        id: 'c1',
        shop_domain: 'tkjiax-hc.myshopify.com',
        access_token: 'cifrado:viejo',
        token_expires_at: new Date(Date.now() - 1000).toISOString(),
        refresh_token_encrypted: 'cifrado:refresh',
        refresh_token_expires_at: null,
        connection_method: 'custom_app',
        client_id_encrypted: 'cifrado:app-revitaly',
        webhook_secret: 'cifrado:secreto-revitaly',
      })

      expect(r).toEqual({ accessToken: 'nuevo', renovado: true })
      const cuerpo = String(fetchMock.mock.calls[0][1]?.body)
      expect(cuerpo).toContain('client_id=app-revitaly')
      expect(cuerpo).toContain('client_secret=secreto-revitaly')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })
})
