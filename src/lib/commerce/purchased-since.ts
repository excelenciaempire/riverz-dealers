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
  if (!args.email && !args.phone) return false

  const sinceMs = Date.parse(args.sinceIso)
  if (Number.isNaN(sinceMs)) return false

  let orders: Awaited<ReturnType<typeof fetchRecentOrders>>
  try {
    const conn = await getActiveShopifyConnection(db, args.workspaceId)
    if (!conn) return false
    const days = args.lookbackDays ?? 90
    const windowMs = Date.now() - days * 86_400_000
    // Se pide desde la fecha más vieja de las dos: si `sinceIso` es más
    // reciente que la ventana, igual alcanza; si es más viejo, la ventana
    // manda y el resultado puede quedar corto — por eso el default es 90d.
    const fromMs = Math.min(windowMs, sinceMs)
    orders = await fetchRecentOrders(conn, new Date(fromMs).toISOString())
  } catch {
    // Shopify caído o token vencido: se responde "no compró". El error
    // opuesto —frenar por una caída ajena— apagaría la recuperación entera
    // sin que nadie se entere.
    return false
  }

  const email = args.email?.toLowerCase() ?? null
  const last8 = args.phone ? (normPhone(args.phone)?.slice(-8) ?? null) : null

  return orders.some((o) => {
    if (!isAfter(o.created_at, args.sinceIso)) return false
    if (email && (o.email ?? '').toLowerCase() === email) return true
    if (last8) {
      const op = normPhone(o.phone)
      if (op && op.endsWith(last8)) return true
    }
    return false
  })
}
