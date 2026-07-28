import { describe, it, expect, vi, afterEach } from 'vitest'
import { probeWooStore } from './woocommerce'

/**
 * El diagnóstico existe para que el comercio no termine mirando un "404
 * Not Found" pelado en su propio sitio. Cada rama corresponde a un
 * problema con un arreglo distinto, así que confundirlas es tan malo como
 * no diagnosticar nada.
 */

function stubFetch(routes: Record<string, { status: number; body: string }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const hit = Object.entries(routes).find(([k]) => String(url).includes(k))
      if (!hit) throw new Error('network')
      return {
        status: hit[1].status,
        text: async () => hit[1].body,
      } as unknown as Response
    }),
  )
}

const restRoot = (namespaces: string[]) =>
  JSON.stringify({ name: 'Tienda', namespaces })

afterEach(() => vi.unstubAllGlobals())

describe('probeWooStore', () => {
  it('acepta un WordPress con WooCommerce activo', async () => {
    stubFetch({ '/wp-json/': { status: 200, body: restRoot(['wp/v2', 'wc/v3']) } })
    expect(await probeWooStore('mitienda.com')).toEqual({ ok: true })
  })

  it('distingue WordPress sin WooCommerce', async () => {
    stubFetch({ '/wp-json/': { status: 200, body: restRoot(['wp/v2', 'oembed/1.0']) } })
    expect(await probeWooStore('miblog.com')).toEqual({
      ok: false,
      reason: 'no_woocommerce',
    })
  })

  it('detecta enlaces permanentes en Simple', async () => {
    // Es el caso engañoso: está TODO instalado, pero las rutas no existen
    // y `/wc-auth/` daría 404 igual. La API por query string lo delata.
    stubFetch({
      '/wp-json/': { status: 404, body: 'Not Found' },
      '?rest_route=/': { status: 200, body: restRoot(['wp/v2', 'wc/v3']) },
    })
    expect(await probeWooStore('mitienda.com')).toEqual({
      ok: false,
      reason: 'plain_permalinks',
    })
  })

  it('detecta un sitio que no es WordPress', async () => {
    // Lo que pasó de verdad: un dominio que sirve su landing para todo,
    // incluido `?rest_route=`. Devolver HTML con 200 no lo vuelve WordPress.
    stubFetch({
      '/wp-json/': { status: 404, body: '404 Not Found' },
      '?rest_route=/': { status: 200, body: '<!DOCTYPE html><html>…</html>' },
    })
    expect(await probeWooStore('sitioamedida.com')).toEqual({
      ok: false,
      reason: 'not_wordpress',
    })
  })

  it('marca como inalcanzable lo que no contesta', async () => {
    stubFetch({})
    expect(await probeWooStore('noexiste.com')).toEqual({
      ok: false,
      reason: 'unreachable',
    })
  })

  it('no confunde un namespace ajeno que empiece parecido', async () => {
    // 'wcf/v1' es de un plugin de embudos, no de WooCommerce.
    stubFetch({ '/wp-json/': { status: 200, body: restRoot(['wp/v2', 'wcf/v1']) } })
    expect(await probeWooStore('miblog.com')).toEqual({
      ok: false,
      reason: 'no_woocommerce',
    })
  })
})
