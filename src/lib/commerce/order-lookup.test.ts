import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * De qué tienda se contesta "¿dónde está mi pedido?".
 *
 * La función tomaba la conexión activa más reciente del workspace, fuera de la
 * plataforma que fuera. Un comercio con Shopify y Tiendanube conectadas
 * quedaba mudo: ganaba Shopify —que estos caminos resuelven aparte y
 * descartan— y tapaba la única tienda que sí se podía consultar.
 */

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v }))

import { resolveStoreForLookup } from './order-lookup'

const WS = 'ws-1'

interface Fila {
  platform: string
  workspace_id: string
  status: string
  shop_domain: string
  access_token: string
  api_secret?: string | null
  external_store_id?: string | null
  store_url?: string | null
  installed_at: string
}

function conexion(over: Partial<Fila> & Pick<Fila, 'platform' | 'installed_at'>): Fila {
  return {
    workspace_id: WS,
    status: 'active',
    shop_domain: `${over.platform}.example.com`,
    access_token: 'token',
    api_secret: null,
    external_store_id: null,
    store_url: null,
    ...over,
  }
}

/** Supabase de mentira: aplica los `.eq()` y ordena por installed_at desc. */
function fakeDb(filas: Fila[]): SupabaseClient {
  const api = {
    from() {
      const filtros: Array<[string, unknown]> = []
      let tope = Infinity
      const resolver = () =>
        filas
          .filter((f) =>
            filtros.every(([col, val]) => (f as unknown as Record<string, unknown>)[col] === val),
          )
          .sort((a, b) => (a.installed_at < b.installed_at ? 1 : -1))
          .slice(0, tope)
      const chain: Record<string, unknown> = {
        select: () => chain,
        order: () => chain,
        limit: (n: number) => {
          tope = n
          return chain
        },
        eq: (col: string, val: unknown) => {
          filtros.push([col, val])
          return chain
        },
        then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
          Promise.resolve({ data: resolver(), error: null }).then(ok, fail),
      }
      return chain
    },
  }
  return api as unknown as SupabaseClient
}

describe('resolveStoreForLookup', () => {
  it('no devuelve Shopify cuando el comercio tiene además otra tienda', async () => {
    const db = fakeDb([
      conexion({ platform: 'shopify', installed_at: '2026-08-10T00:00:00Z' }),
      conexion({ platform: 'tiendanube', installed_at: '2026-01-05T00:00:00Z' }),
    ])

    const tienda = await resolveStoreForLookup(db, WS)

    expect(tienda?.platform).toBe('tiendanube')
    expect(tienda?.shopDomain).toBe('tiendanube.example.com')
  })

  it('con la plataforma pedida devuelve esa, aunque sea la más vieja', async () => {
    const db = fakeDb([
      conexion({ platform: 'tiendanube', installed_at: '2026-08-10T00:00:00Z' }),
      conexion({ platform: 'shopify', installed_at: '2026-01-05T00:00:00Z' }),
    ])

    expect((await resolveStoreForLookup(db, WS, 'shopify'))?.platform).toBe('shopify')
    expect((await resolveStoreForLookup(db, WS, 'tiendanube'))?.platform).toBe('tiendanube')
  })

  it('la plataforma que no está conectada devuelve null', async () => {
    const db = fakeDb([conexion({ platform: 'tiendanube', installed_at: '2026-08-10T00:00:00Z' })])

    expect(await resolveStoreForLookup(db, WS, 'woocommerce')).toBeNull()
  })

  it('una conexión caída no cuenta como tienda', async () => {
    const db = fakeDb([
      conexion({ platform: 'woocommerce', installed_at: '2026-08-10T00:00:00Z', status: 'expired' }),
      conexion({ platform: 'tiendanube', installed_at: '2026-01-05T00:00:00Z' }),
    ])

    expect((await resolveStoreForLookup(db, WS))?.platform).toBe('tiendanube')
    expect(await resolveStoreForLookup(db, WS, 'woocommerce')).toBeNull()
  })

  it('la tienda de otra cuenta nunca se devuelve', async () => {
    const db = fakeDb([
      conexion({
        platform: 'tiendanube',
        installed_at: '2026-08-10T00:00:00Z',
        workspace_id: 'otra',
      }),
    ])

    expect(await resolveStoreForLookup(db, WS)).toBeNull()
  })
})
