import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * El 403 de los tokens que Shopify dio de baja tiene que matar la conexión.
 *
 * Shopify dejó de aceptar los tokens que no expiran. El mensaje llega con
 * **403**, no con 401, así que caía en el `throw` genérico: la conexión seguía
 * figurando activa —punto verde en Ajustes— mientras TODAS sus llamadas
 * fallaban. El comercio ve que su tienda "está conectada" y su agente contesta
 * que no encuentra ningún pedido.
 *
 * Medido el 2026-08-24 sobre dos tiendas, una reconectada por OAuth ese mismo
 * minuto: el flujo actual emite un token `shpat_`, que es justo el tipo que
 * Shopify ya no acepta. Por eso el motivo dice que reconectar no alcanza.
 */

const RESPUESTA_403 = JSON.stringify({
  errors:
    '[API] Non-expiring access tokens are no longer accepted for the Admin API. Start using expiring offline tokens.',
})

describe('token dado de baja por Shopify', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ejemplo.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'clave-de-prueba')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('se reconoce como credencial muerta, no como un error cualquiera', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(RESPUESTA_403, { status: 403, headers: { 'content-type': 'application/json' } }),
      ),
    )
    const { ShopifyAdminClient, ShopifyUnauthorizedError } = await import('./admin-client')
    const cliente = new ShopifyAdminClient('demo.myshopify.com', 'shpat_loquesea')

    await expect(cliente.rest('/shop.json')).rejects.toBeInstanceOf(ShopifyUnauthorizedError)
  })

  it('un 403 de permisos que faltan sigue siendo un error común', async () => {
    // Este otro 403 —"requires merchant approval for read_price_rules scope"—
    // NO es un token muerto: es un permiso que el comercio no dio. Marcar la
    // conexión como vencida ahí mandaría a reconectar una tienda que anda.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ errors: '[API] This action requires merchant approval for read_price_rules scope.' }),
          { status: 403 },
        ),
      ),
    )
    const { ShopifyAdminClient, ShopifyUnauthorizedError } = await import('./admin-client')
    const cliente = new ShopifyAdminClient('demo.myshopify.com', 'shpca_loquesea')

    await expect(cliente.rest('/price_rules.json')).rejects.not.toBeInstanceOf(
      ShopifyUnauthorizedError,
    )
  })
})
