import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getActiveShopifyConnection,
  fetchRecentOrders,
  normPhone,
} from '@/lib/attribution/shopify'

/**
 * ¿Esta persona compró después de un momento dado?
 *
 * Nace de la recuperación de pagos rechazados, donde es la pregunta que
 * decide todo: un rechazo no genera pedido, así que cualquier pedido
 * posterior de esa misma persona es la compra que sí prosperó, y escribirle
 * "no pudimos procesar tu pago" a alguien que ya tiene el pedido confirmado
 * es peor que no escribirle nada.
 *
 * Vive acá y no dentro del cron porque el motor de automatizaciones también
 * lo necesita: el paso de condición lo evalúa DESPUÉS de la espera, que es
 * el único momento en que la respuesta significa algo.
 *
 * Empareja por correo (la señal fuerte: sale del mismo checkout) y por los
 * últimos 8 dígitos del teléfono, que cubre a quien volvió a comprar como
 * invitado con otro correo.
 */

/**
 * ¿`when` cae después de `sinceIso`? En milisegundos, nunca comparando texto.
 *
 * Las dos fechas llegan en formatos distintos: Shopify las manda en la zona
 * de la tienda ("2026-08-14T16:44:28-04:00") y Postgres con espacio y otro
 * huso ("2026-08-14 19:10:01.33+00"). Comparadas como cadenas, un pedido de
 * las 16:44 hora local parece anterior a un rechazo de las 19:10 UTC aunque
 * haya pasado una hora y media después.
 *
 * Se comió el caso que más importa: la persona que compraba durante la espera
 * quedaba marcada como "no compró" y recibía igual el mensaje de carrito
 * abandonado o de pago rechazado.
 */
export function isAfter(when: string | null | undefined, sinceIso: string): boolean {
  const a = Date.parse(when ?? '')
  const b = Date.parse(sinceIso)
  if (Number.isNaN(a) || Number.isNaN(b)) return false
  return a > b
}

/**
 * "No compró" y "no pude preguntar" no son lo mismo.
 *
 * Cuando la respuesta decide si se MANDA un mensaje, confundirlas es barato:
 * ante una caída de Shopify se manda igual, que es lo prudente. Cuando decide
 * si se ETIQUETA una venta recuperada, el mismo `false` borra la venta de la
 * medición para siempre, sin log y sin reintento. Por eso el resultado dice
 * cuál de las dos cosas pasó y cada llamador elige.
 */
export type ResultadoCompra =
  | { estado: 'compro' }
  | { estado: 'no_compro' }
  | { estado: 'sin_respuesta'; motivo: string }

/** Los teléfonos donde Shopify puede tener el número del comprador. */
function telefonosDe(o: {
  phone?: string
  customer?: { phone?: string | null } | null
  shipping_address?: { phone?: string | null } | null
  billing_address?: { phone?: string | null } | null
}): (string | null | undefined)[] {
  return [o.phone, o.customer?.phone, o.shipping_address?.phone, o.billing_address?.phone]
}

/** Y los correos. `contact_email` es el que Shopify usa para el comprador. */
function correosDe(o: {
  email?: string
  contact_email?: string | null
  customer?: { email?: string | null } | null
}): (string | null | undefined)[] {
  return [o.email, o.contact_email, o.customer?.email]
}

export async function purchasedSince(
  db: SupabaseClient,
  args: {
    workspaceId: string
    sinceIso: string
    email?: string | null
    phone?: string | null
    /** Días hacia atrás que se le piden a Shopify. Cubre `sinceIso`. */
    lookbackDays?: number
  },
): Promise<boolean> {
  const r = await consultarCompra(db, args)
  // El contrato viejo: cualquier cosa que no sea una compra confirmada es un
  // "no". Lo usan las barreras que deciden si mandar un mensaje.
  return r.estado === 'compro'
}

export async function consultarCompra(
  db: SupabaseClient,
  args: {
    workspaceId: string
    sinceIso: string
    email?: string | null
    phone?: string | null
    lookbackDays?: number
  },
): Promise<ResultadoCompra> {
  if (!args.email && !args.phone) return { estado: 'no_compro' }

  const sinceMs = Date.parse(args.sinceIso)
  if (Number.isNaN(sinceMs)) return { estado: 'no_compro' }

  let orders: Awaited<ReturnType<typeof fetchRecentOrders>>
  try {
    const conn = await getActiveShopifyConnection(db, args.workspaceId)
    if (!conn) return { estado: 'no_compro' }
    // Sólo desde el momento que se pregunta. Antes pedía 90 días siempre
    // —`Math.min` se quedaba con la fecha más vieja— y como Shopify devuelve
    // una sola página de 250, una tienda con más de 250 pedidos en 90 días
    // gastaba toda la página en historia vieja. `lookbackDays` sigue estando
    // para quien de verdad quiera mirar hacia atrás.
    const fromMs = args.lookbackDays
      ? Math.min(Date.now() - args.lookbackDays * 86_400_000, sinceMs)
      : sinceMs
    orders = await fetchRecentOrders(conn, new Date(fromMs).toISOString())
  } catch (err) {
    return { estado: 'sin_respuesta', motivo: err instanceof Error ? err.message : String(err) }
  }

  const email = args.email?.toLowerCase() ?? null
  const last8 = args.phone ? (normPhone(args.phone)?.slice(-8) ?? null) : null

  const compro = orders.some((o) => {
    if (!isAfter(o.created_at, args.sinceIso)) return false
    // Un pedido cancelado o anulado existe pero no es una venta: contarlo
    // infla justo el número que esta pregunta sirve para medir.
    if (o.cancelled_at) return false
    if (o.financial_status === 'voided') return false
    // `pending` SÍ cuenta: es el pedido por transferencia, que acá es una
    // compra hecha esperando el comprobante, no una compra que no ocurrió.
    if (email && correosDe(o).some((e) => (e ?? '').toLowerCase() === email)) return true
    if (last8) {
      return telefonosDe(o).some((t) => {
        const op = normPhone(t)
        return Boolean(op && op.endsWith(last8))
      })
    }
    return false
  })
  return compro ? { estado: 'compro' } : { estado: 'no_compro' }
}
