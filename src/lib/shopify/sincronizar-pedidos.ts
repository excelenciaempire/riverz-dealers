import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { markShopifyConnectionExpired } from './admin-client'
import { espejarPedidoDeShopify } from './espejo-de-pedido'

/**
 * RELLENO DE PEDIDOS DE SHOPIFY.
 *
 * El webhook ya deja cada pedido nuevo en `orders` (ver `espejo-de-pedido`).
 * Esto es lo otro que hace falta:
 *
 *   1. Los pedidos que ya estaban antes de que el espejo existiera. Sin esto
 *      la tabla arranca vacía y el historial del comercio empieza hoy.
 *   2. Los que el webhook se perdió. Shopify reintenta 19 veces en 48 h y
 *      después abandona; si el servicio estuvo caído esa noche, esa venta no
 *      vuelve nunca. Una pasada por hora la recupera sin que nadie mire.
 *
 * Se pide por `updated_at_min` y no por fecha de creación: así una venta
 * vieja que cambió de estado (se pagó, se despachó, se devolvió) también
 * entra, que es justo lo que el webhook perdido se llevó.
 */

const API = '2024-10'
/** Los campos que necesita el espejo. Pedir el pedido entero es varias veces
 *  más tráfico por nada. */
const CAMPOS = [
  'id',
  'name',
  'order_number',
  'created_at',
  'updated_at',
  'cancelled_at',
  'financial_status',
  'fulfillment_status',
  'total_price',
  'currency',
  'line_items',
  'customer',
  'email',
  'phone',
  'shipping_address',
  'order_status_url',
  'checkout_token',
  'cart_token',
  'fulfillments',
].join(',')

export interface ResumenDeSincronizacion {
  shopDomain: string
  leidos: number
  creados: number
  actualizados: number
  error?: string
}

/**
 * El link de la página siguiente que manda Shopify en la cabecera `Link`.
 * Es paginación por cursor: no se puede pedir "la página 3", hay que seguir
 * el `page_info` que vino en la respuesta anterior.
 */
function siguientePagina(link: string | null): string | null {
  if (!link) return null
  for (const parte of link.split(',')) {
    const [url, rel] = parte.split(';')
    if (rel?.includes('rel="next"')) {
      return url.trim().replace(/^<|>$/g, '')
    }
  }
  return null
}

/**
 * Trae los pedidos de una tienda y los deja en el espejo.
 *
 * `dias` acota la ventana. Sin el permiso `read_all_orders` Shopify sólo
 * devuelve los últimos 60 días, así que pedir más no trae más — pero
 * tampoco falla, y el día que ese permiso esté aprobado el mismo código
 * trae todo el historial.
 */
export async function sincronizarPedidosDeUnaTienda(
  db: SupabaseClient,
  args: {
    workspaceId: string
    shopDomain: string
    accessToken: string
    dias?: number
    /** Tope de páginas, para que una tienda grande no se coma la corrida. */
    maxPaginas?: number
  },
): Promise<ResumenDeSincronizacion> {
  const { workspaceId, shopDomain, accessToken } = args
  const dias = args.dias ?? 60
  const maxPaginas = args.maxPaginas ?? 20
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString()

  const resumen: ResumenDeSincronizacion = {
    shopDomain,
    leidos: 0,
    creados: 0,
    actualizados: 0,
  }

  let url =
    `https://${shopDomain}/admin/api/${API}/orders.json` +
    `?status=any&limit=250&updated_at_min=${encodeURIComponent(desde)}` +
    `&fields=${encodeURIComponent(CAMPOS)}`

  for (let pagina = 0; pagina < maxPaginas && url; pagina += 1) {
    const res = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    })
    if (!res.ok) {
      // 401 es la conexión caída, no un error de esta corrida: se marca para
      // que el comercio vea que tiene que reconectar en vez de preguntarse
      // por qué faltan pedidos.
      if (res.status === 401) void markShopifyConnectionExpired(shopDomain)
      resumen.error = `HTTP ${res.status}`
      return resumen
    }
    const cuerpo = (await res.json()) as { orders?: Array<Record<string, unknown>> }
    const pedidos = cuerpo.orders ?? []
    resumen.leidos += pedidos.length

    for (const order of pedidos) {
      try {
        const r = await espejarPedidoDeShopify(db, { workspaceId, shopDomain, order })
        if (r === 'creado') resumen.creados += 1
        else if (r === 'actualizado') resumen.actualizados += 1
      } catch (err) {
        // Un pedido raro no puede cortar el resto de la página.
        console.error('[shopify] no se pudo espejar el pedido', order.id, err)
      }
    }

    url = siguientePagina(res.headers.get('link')) ?? ''
  }

  return resumen
}

/** Fila mínima de conexión que hace falta acá. */
interface ConexionDeTienda {
  workspace_id: string | null
  shop_domain: string
  access_token: string
}

/**
 * Lo mismo para todas las tiendas conectadas. Cada una en su propio try: una
 * tienda con el token vencido no puede dejar sin sincronizar a las demás.
 */
export async function sincronizarPedidosDeShopify(
  db: SupabaseClient,
  opciones: { dias?: number } = {},
): Promise<ResumenDeSincronizacion[]> {
  const { data } = await db
    .from('shopify_connections')
    .select('workspace_id, shop_domain, access_token')
    .eq('platform', 'shopify')
    .eq('status', 'active')

  const conexiones = (data ?? []) as ConexionDeTienda[]
  const vistas = new Set<string>()
  const salida: ResumenDeSincronizacion[] = []

  for (const c of conexiones) {
    if (!c.workspace_id || !c.shop_domain) continue
    // Una tienda puede tener más de una fila activa (dos instalaciones del
    // mismo comercio). Sincronizarla dos veces sería el mismo trabajo hecho
    // al pedo y el doble de llamadas contra el límite de Shopify.
    const clave = `${c.workspace_id}|${c.shop_domain}`
    if (vistas.has(clave)) continue
    vistas.add(clave)

    try {
      salida.push(
        await sincronizarPedidosDeUnaTienda(db, {
          workspaceId: c.workspace_id,
          shopDomain: c.shop_domain,
          accessToken: decrypt(c.access_token),
          dias: opciones.dias,
        }),
      )
    } catch (err) {
      console.error('[shopify] sincronización de pedidos falló:', c.shop_domain, err)
      salida.push({
        shopDomain: c.shop_domain,
        leidos: 0,
        creados: 0,
        actualizados: 0,
        error: err instanceof Error ? err.message : 'error',
      })
    }
  }

  return salida
}
