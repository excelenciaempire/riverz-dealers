import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { markShopifyConnectionExpired } from './admin-client'
import { espejarPedidoDeShopify } from './espejo-de-pedido'
import { selectAll } from '@/lib/db/paginate'
import { shopifyApiVersion } from './oauth'
import { mapWithConcurrency } from '@/lib/async/concurrency'

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
 *      vuelve nunca. La recuperación incremental la incorpora sin enviar avisos.
 *
 * Se pide por `updated_at_min` y no por fecha de creación: así una venta
 * vieja que cambió de estado (se pagó, se despachó, se devolvió) también
 * entra, que es justo lo que el webhook perdido se llevó.
 */

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
  'tags',
].join(',')

export interface ResumenDeSincronizacion {
  shopDomain: string
  leidos: number
  creados: number
  actualizados: number
  error?: string
  complete?: boolean
  nextPage?: string | null
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
    pageSize?: number
    since?: string
    nextPage?: string | null
  },
): Promise<ResumenDeSincronizacion> {
  const { workspaceId, shopDomain, accessToken } = args
  const dias = args.dias ?? 60
  const maxPaginas = args.maxPaginas ?? 20
  const pageSize = Math.max(1, Math.min(250, args.pageSize ?? 250))
  const desde = args.since ?? new Date(Date.now() - dias * 86_400_000).toISOString()

  const resumen: ResumenDeSincronizacion = {
    shopDomain,
    leidos: 0,
    creados: 0,
    actualizados: 0,
  }

  let url =
    `https://${shopDomain}/admin/api/${shopifyApiVersion()}/orders.json` +
    `?status=any&limit=${pageSize}&updated_at_min=${encodeURIComponent(desde)}` +
    `&fields=${encodeURIComponent(CAMPOS)}`
  if (args.nextPage) {
    const next = new URL(args.nextPage);
    if (next.protocol !== 'https:' || next.host !== shopDomain || !next.pathname.endsWith('/orders.json')) {
      throw new Error('invalid_shopify_sync_cursor');
    }
    if (args.pageSize) next.searchParams.set('limit', String(pageSize));
    url = next.toString();
  }

  for (let pagina = 0; pagina < maxPaginas && url; pagina += 1) {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
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
      resumen.nextPage = url
      resumen.complete = false
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
        resumen.error = 'order_mirror_failed'
      }
    }

    if (resumen.error) {
      resumen.nextPage = url;
      resumen.complete = false;
      return resumen;
    }
    url = siguientePagina(res.headers.get('link')) ?? ''
  }

  resumen.nextPage = url || null
  resumen.complete = !url
  return resumen
}

/** Fila mínima de conexión que hace falta acá. */
interface ConexionDeTienda {
  id: string
  workspace_id: string | null
  shop_domain: string
  access_token: string
  sync_state: { mark?: string; since?: string; nextPage?: string | null; objective?: string; attempted_at?: string }
}

/** Tiendas efímeras creadas por Shopify para revisar la app, sin pedidos del comercio. */
export function esTiendaDeRevisionDeShopify(shopDomain: string): boolean {
  return /^app-review-[a-z0-9-]+\.myshopify\.com$/i.test(shopDomain);
}

/**
 * Lo mismo para todas las tiendas conectadas. Cada una en su propio try: una
 * tienda con el token vencido no puede dejar sin sincronizar a las demás.
 */
export async function sincronizarPedidosDeShopify(
  db: SupabaseClient,
  opciones: { dias?: number } = {},
): Promise<ResumenDeSincronizacion[]> {
  const conexiones = await selectAll<ConexionDeTienda>(db, 'shopify_connections',
    q => q.eq('platform', 'shopify').in('status', ['active', 'error', 'expired']),
    { select: 'id, workspace_id, shop_domain, access_token, sync_state', strict: true });
  const vistas = new Set<string>()
  const salida: ResumenDeSincronizacion[] = []

  const unique = conexiones.filter(c => {
    if (!c.workspace_id || !c.shop_domain || esTiendaDeRevisionDeShopify(c.shop_domain)) return false
    // Una tienda puede tener más de una fila activa (dos instalaciones del
    // mismo comercio). Sincronizarla dos veces sería el mismo trabajo hecho
    // al pedo y el doble de llamadas contra el límite de Shopify.
    const clave = `${c.workspace_id}|${c.shop_domain}`
    if (vistas.has(clave)) return false
    vistas.add(clave)
    return true;
  }).sort((a, b) => String(a.sync_state?.attempted_at ?? '').localeCompare(String(b.sync_state?.attempted_at ?? '')));
  const deadline = Date.now() + 90_000;
  await mapWithConcurrency(unique, 3, async c => {
    if (Date.now() >= deadline) return;
    const state = c.sync_state ?? {};
    const objective = state.objective ?? new Date().toISOString();
    const since = state.since ?? new Date(state.mark ? Date.parse(state.mark) - 15 * 60_000 : Date.now() - (opciones.dias ?? 60) * 86_400_000).toISOString();
    try {
      const result = await sincronizarPedidosDeUnaTienda(db, {
          workspaceId: c.workspace_id!,
          shopDomain: c.shop_domain,
          accessToken: decrypt(c.access_token),
          dias: opciones.dias,
          since,
          nextPage: state.nextPage,
          maxPaginas: 1,
          pageSize: 25,
        });
      const { error } = await db.from('shopify_connections').update({ sync_state: {
        mark: result.complete ? objective : state.mark,
        since: result.complete ? null : since,
        objective: result.complete ? null : objective,
        nextPage: result.nextPage ?? null,
        attempted_at: new Date().toISOString(),
        complete: result.complete === true,
        error: result.error ?? null,
      } }).eq('id', c.id).in('status', ['active', 'error', 'expired']);
      if (error) throw new Error(error.message);
      salida.push(result);
    } catch (err) {
      await db.from('shopify_connections').update({ sync_state: {
        ...state, since, objective, complete: false,
        attempted_at: new Date().toISOString(), error: err instanceof Error ? err.message : 'sync_failed',
      } }).eq('id', c.id).in('status', ['active', 'error', 'expired']);
      console.error('[shopify] sincronización de pedidos falló:', c.shop_domain, err)
      salida.push({
        shopDomain: c.shop_domain,
        leidos: 0,
        creados: 0,
        actualizados: 0,
        error: err instanceof Error ? err.message : 'error',
      })
    }
  });

  return salida
}
