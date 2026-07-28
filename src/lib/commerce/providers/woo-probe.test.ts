import { describe, it, expect, vi, afterEach } from 'vitest'
import { probeWooStore } from './woocommerce'

/**
 * El diagnóstico existe para que el comercio no termine mirando un "404
 * Not Found" pelado en su propio sitio.
 *
 * La señal que manda es `/wc-auth/v1/authorize`, la URL exacta a la que
 * lo vamos a mandar: si ahí hay 404, en su navegador también lo habrá.
 * Todo lo demás solo sirve para explicar POR QUÉ, y cada motivo tiene un
 * arreglo distinto — confundirlos es tan inútil como no diagnosticar.
 */

const AUTH = '/wc-auth/v1/authorize'
const REST = '/wp-json/'
const ALT = '?rest_route=/'

function stubFetch(routes: Record<string, { status: number; body: string }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url)
      // Las claves absolutas (la portada) se comparan por igualdad: como
      // son prefijo de todas las demás URLs, con `includes` capturarían
      // cualquier petición y la prueba mediría otra cosa.
      const key =
        Object.keys(routes).find((k) => k.startsWith('http') && u === k) ??
        Object.keys(routes).find((k) => !k.startsWith('http') && u.includes(k))
      if (!key) throw new Error('network')
      return {
        status: routes[key].status,
        text: async () => routes[key].body,
      } as unknown as Response
    }),
  )
}

const restRoot = (namespaces: string[]) =>
  JSON.stringify({ name: 'Tienda', namespaces })

afterEach(() => vi.unstubAllGlobals())

describe('probeWooStore', () => {
  it('acepta cuando la ruta de aprobación existe', async () => {
    // Sin parámetros WooCommerce responde con su propio error, no 404.
    stubFetch({ [AUTH]: { status: 401, body: 'Missing parameters' } })
    expect(await probeWooStore('mitienda.com')).toEqual({ ok: true })
  })

  it('deja pasar aunque un cortafuegos nos bloquee', async () => {
    // 403 significa "hay algo y no me habla", no "no existe". Bloquear
    // acá sería un falso positivo caro: el 404 se sortea, un "tu sitio no
    // sirve" de nuestra parte no.
    stubFetch({ [AUTH]: { status: 403, body: 'Forbidden' } })
    expect(await probeWooStore('tiendaprotegida.com')).toEqual({ ok: true })
  })

  it('detecta WordPress sin WooCommerce', async () => {
    stubFetch({
      [AUTH]: { status: 404, body: 'Not Found' },
      [REST]: { status: 200, body: restRoot(['wp/v2', 'yoast/v1']) },
    })
    expect(await probeWooStore('miblog.com')).toEqual({
      ok: false,
      reason: 'no_woocommerce',
    })
  })

  it('detecta WordPress sin WooCommerce aunque el REST esté cerrado', async () => {
    // Caso real: un sitio con Wordfence que nos bloquea la API pero cuya
    // portada delata WordPress. Sin este último chequeo pasaría y el
    // comercio volvería a chocar con el 404.
    stubFetch({
      [AUTH]: { status: 404, body: 'Not Found' },
      [REST]: { status: 403, body: 'Blocked' },
      [ALT]: { status: 403, body: 'Blocked' },
      'https://protegida.com/': {
        status: 200,
        body: '<html><link href="/wp-content/themes/x/style.css"></html>',
      },
    })
    expect(await probeWooStore('protegida.com')).toEqual({
      ok: false,
      reason: 'no_woocommerce',
    })
  })

  it('detecta enlaces permanentes en Simple', async () => {
    // El caso engañoso: está TODO instalado, pero sin rutas amigables
    // /wc-auth/ y /wp-json/ no existen. La API por query string lo delata.
    stubFetch({
      [AUTH]: { status: 404, body: 'Not Found' },
      [REST]: { status: 404, body: 'Not Found' },
      [ALT]: { status: 200, body: restRoot(['wp/v2', 'wc/v3']) },
    })
    expect(await probeWooStore('mitienda.com')).toEqual({
      ok: false,
      reason: 'plain_permalinks',
    })
  })

  it('detecta un sitio que no es WordPress', async () => {
    // Lo que pasó de verdad: un dominio que sirve su landing para todo.
    // Devolver HTML con 200 no lo vuelve WordPress.
    stubFetch({
      [AUTH]: { status: 404, body: '404 Not Found' },
      [REST]: { status: 404, body: '404 Not Found' },
      [ALT]: { status: 200, body: '<!DOCTYPE html><html>…</html>' },
      'https://sitioamedida.com/': {
        status: 200,
        body: '<!DOCTYPE html><html><body>landing a medida</body></html>',
      },
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
})
