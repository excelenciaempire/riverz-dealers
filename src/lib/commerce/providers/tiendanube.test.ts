import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  TiendanubeClient,
  buildTiendanubeAuthorizeUrl,
  missingTiendanubeScopes,
} from './tiendanube'

/**
 * El 422 de "ese webhook ya existe" es el resultado NORMAL de reconectar.
 * Antes iba al mismo `console.error` que un fallo de verdad y las dos cosas
 * terminaban en "listo": una tienda podía quedarse sin webhooks —entregando
 * cada pedido a la nada— y el alta figuraba como exitosa.
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

function respuestas(status: number) {
  return vi.fn(async () =>
    status === 201
      ? new Response(JSON.stringify({ id: 1 }), { status: 201 })
      : new Response('{"error":"ya existe"}', { status }),
  )
}

const client = () => new TiendanubeClient('9182', 'token', 'tienda.mitiendanube.com')

describe('registerWebhooks', () => {
  it('un 422 es "ya estaba", no un alta nueva ni un fallo', async () => {
    vi.stubGlobal('fetch', respuestas(422))

    const r = await client().registerWebhooks('https://riverz.co')

    expect(r.creados).toBe(0)
    expect(r.existentes).toBeGreaterThan(0)
    expect(r.fallidos).toEqual([])
  })

  it('un fallo de verdad queda contado', async () => {
    vi.stubGlobal('fetch', respuestas(500))

    const r = await client().registerWebhooks('https://riverz.co')

    expect(r.creados).toBe(0)
    expect(r.existentes).toBe(0)
    expect(r.fallidos.length).toBeGreaterThan(0)
  })

  it('el alta buena se cuenta como creada', async () => {
    vi.stubGlobal('fetch', respuestas(201))

    const r = await client().registerWebhooks('https://riverz.co')

    expect(r.creados).toBeGreaterThan(0)
    expect(r.fallidos).toEqual([])
  })
})

describe('missingTiendanubeScopes', () => {
  it('avisa del permiso que el portal dejó de otorgar', () => {
    expect(missingTiendanubeScopes('read_products,read_orders,read_customers')).toEqual([
      'write_orders',
    ])
  })

  it('con todos los permisos no falta nada', () => {
    expect(
      missingTiendanubeScopes('read_products read_orders write_orders read_customers'),
    ).toEqual([])
  })

  it('sin scope declarado no se inventa una conexión rota', () => {
    expect(missingTiendanubeScopes('')).toEqual([])
    expect(missingTiendanubeScopes(null)).toEqual([])
  })
})

describe('buildTiendanubeAuthorizeUrl', () => {
  // Tiendanube fija la URL de retorno y los permisos en la configuración de la
  // app: mandarlos por query rompe el enlace con el que se instala.
  it('sólo lleva el state', () => {
    const url = new URL(buildTiendanubeAuthorizeUrl('37693', 'abc.def'))
    expect(url.pathname).toBe('/apps/37693/authorize')
    expect([...url.searchParams.keys()]).toEqual(['state'])
    expect(url.searchParams.get('state')).toBe('abc.def')
  })
})
