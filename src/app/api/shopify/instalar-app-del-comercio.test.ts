import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * El dueño instala la app que Riverz creó para su tienda y la tienda queda
 * conectada al workspace desde el que se guardó esa app, sin que el dueño
 * tenga cuenta en Riverz. La firma de Shopify es lo único que dice qué app es.
 */

const mocks = vi.hoisted(() => ({
  cookies: {} as Record<string, string>,
  completar: vi.fn(),
  registradas: [] as Record<string, string>[],
  guardadas: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: (valor: string) => `cifrado:${valor}`,
  decrypt: (valor: string) => valor.replace(/^cifrado:/, ''),
}))
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'es' }))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nombre: string) =>
      mocks.cookies[nombre] ? { value: mocks.cookies[nombre] } : undefined,
  }),
}))
vi.mock('@/lib/shopify/complete-connection', () => ({
  completeShopifyConnection: mocks.completar,
}))
vi.mock('@/lib/csrf', () => ({ csrfGuard: async () => null }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'equipo-riverz' } } }) },
  }),
}))
vi.mock('@/lib/workspaces/resolve', () => ({
  resolveWorkspaceIdForUser: async () => 'ws-revitaly',
}))
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: async () => ({
          data: tabla === 'shopify_custom_apps' ? mocks.registradas : [],
          error: null,
        }),
        maybeSingle: async () => ({ data: null, error: null }),
        upsert: async (fila: Record<string, unknown>) => {
          mocks.guardadas.push({ tabla, ...fila })
          return { error: null }
        },
      }
      return chain
    },
  }),
}))

import { GET as iniciar } from './oauth/start/route'
import { GET as cerrar } from './callback/route'
import { POST as conectar } from './connect-client-credentials/route'

const TIENDA = 'tkjiax-hc.myshopify.com'

function firmada(params: Record<string, string>, secreto: string): string {
  const q = new URLSearchParams(params)
  const mensaje = [...q.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('&')
  q.set('hmac', createHmac('sha256', secreto).update(mensaje).digest('hex'))
  return q.toString()
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://riverz.co')
  vi.stubEnv('SHOPIFY_API_KEY', 'publica')
  vi.stubEnv('SHOPIFY_API_SECRET', 'secreto-publico')
  mocks.cookies = {}
  mocks.completar.mockReset()
  mocks.guardadas = []
  mocks.registradas = [
    {
      client_id: 'app-revitaly',
      client_secret_encrypted: 'cifrado:secreto-revitaly',
      workspace_id: 'ws-revitaly',
      user_id: 'equipo-riverz',
    },
  ]
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('al abrir la app recién instalada', () => {
  it('pide la autorización con el client id de la app del comercio', async () => {
    const q = firmada({ shop: TIENDA, timestamp: '1', host: 'abc' }, 'secreto-revitaly')
    const res = await iniciar(new Request(`https://riverz.co/api/shopify/oauth/start?${q}`))

    const destino = new URL(res.headers.get('location') ?? '')
    expect(destino.host).toBe(TIENDA)
    expect(destino.pathname).toBe('/admin/oauth/authorize')
    expect(destino.searchParams.get('client_id')).toBe('app-revitaly')
  })

  it('sin credenciales guardadas, el dueño ve el aviso y no arranca nada', async () => {
    mocks.registradas = []
    const q = firmada({ shop: TIENDA, timestamp: '1', host: 'abc' }, 'secreto-revitaly')
    const res = await iniciar(new Request(`https://riverz.co/api/shopify/oauth/start?${q}`))

    expect(res.headers.get('location')).toBe('https://riverz.co/shopify/instalada?estado=error')
  })
})

describe('al volver de la autorización', () => {
  it('conecta la tienda al workspace que guardó la app, con su secreto', async () => {
    mocks.cookies = { shopify_oauth_state: 'estado', shopify_oauth_shop: TIENDA }
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            access_token: 'token',
            scope: 'read_orders',
            expires_in: 3600,
            refresh_token: 'refresh',
            refresh_token_expires_in: 7776000,
          }),
          { status: 200 },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const q = firmada(
      { shop: TIENDA, code: 'codigo', state: 'estado', timestamp: '1', host: 'abc' },
      'secreto-revitaly',
    )
    const res = await cerrar(new Request(`https://riverz.co/api/shopify/callback?${q}`))

    // El canje, con las credenciales de ESA app.
    const cuerpo = String(fetchMock.mock.calls[0][1]?.body)
    expect(cuerpo).toContain('client_id=app-revitaly')
    expect(cuerpo).toContain('client_secret=secreto-revitaly')

    expect(mocks.completar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: 'ws-revitaly',
        userId: 'equipo-riverz',
        shopDomain: TIENDA,
        clientId: 'app-revitaly',
        connectionMethod: 'custom_app',
        webhookSecret: 'secreto-revitaly',
      }),
    )
    // El dueño no tiene sesión en Riverz: ve la confirmación, no el login.
    expect(res.headers.get('location')).toBe('https://riverz.co/shopify/instalada')
  })

  it('una firma que no es de ninguna app no conecta nada', async () => {
    mocks.cookies = { shopify_oauth_state: 'estado', shopify_oauth_shop: TIENDA }
    const q = firmada(
      { shop: TIENDA, code: 'codigo', state: 'estado', timestamp: '1', host: 'abc' },
      'secreto-ajeno',
    )
    const res = await cerrar(new Request(`https://riverz.co/api/shopify/callback?${q}`))

    expect(mocks.completar).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toContain('reason=hmac')
  })
})

describe('al pegar las credenciales de una app que todavía no se instaló', () => {
  it('las guarda para ese workspace y avisa que se conecta sola', async () => {
    const pagina = '<!DOCTYPE html><title>400 - Oauth error app_not_installed</title>'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(pagina, { status: 400 })))

    const res = await conectar(
      new Request('https://riverz.co/api/shopify/connect-client-credentials', {
        method: 'POST',
        body: JSON.stringify({
          shop: TIENDA,
          clientId: 'app-revitaly',
          clientSecret: 'secreto-revitaly',
        }),
      }),
    )

    expect(await res.json()).toEqual({ ok: true, pendiente: true, shop_domain: TIENDA })
    expect(mocks.guardadas).toEqual([
      expect.objectContaining({
        tabla: 'shopify_custom_apps',
        workspace_id: 'ws-revitaly',
        user_id: 'equipo-riverz',
        shop_domain: TIENDA,
        client_id: 'app-revitaly',
        client_secret_encrypted: 'cifrado:secreto-revitaly',
      }),
    ])
  })
})
