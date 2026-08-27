'use client'

import { useEffect, useState } from 'react'

/**
 * La atribución, pedida una sola vez.
 *
 * Vive acá y no dentro de la tarjeta de detalle porque ahora la miran dos
 * piezas: la cifra de arriba ("ventas por Riverz") y el desglose de abajo (por
 * cuál automatización, campaña o flujo entró). El endpoint hace una consulta
 * POR PEDIDO del rango, así que pedirlo dos veces se nota.
 */

export interface AttrRow {
  id: string
  name: string
  orders_count: number
  revenue: number
  currency: string
}

/** Qué clase de cosa tocó el pedido. Viaja como código; la UI lo traduce. */
export type SourceKind = 'automation' | 'broadcast' | 'flow' | 'agent'

/** Qué marca de Riverz trae el pedido. Ver `lib/attribution/prueba.ts`. */
export type ProofKind =
  | 'order_created'
  | 'checkout_link'
  | 'webchat_cart'
  | 'coupon'
  | 'cart_recovery'
  | 'payment_recovered'

/**
 * Un pedido atribuido, con lo que lo tocó. Es el renglón que sostiene la cifra
 * de arriba: pedido, comprador, monto y qué mensaje de Riverz llegó antes.
 */
export interface AttributedOrder {
  id: string
  /** Cómo lo nombra la tienda: "#1042". */
  reference: string
  created_at: string
  revenue: number
  currency: string
  contact: string | null
  contact_id: string | null
  sources: Array<{ kind: SourceKind; name: string; at: string }>
  /** `proven` = trae marca de Riverz. `assisted` = sólo hubo charla antes. */
  evidence: 'proven' | 'assisted'
  proofs: Array<{ kind: ProofKind; detail?: string }>
  /** A esta persona la trajo un anuncio. Se dice, no se esconde. */
  from_ad: boolean
}

export interface Atribucion {
  by_broadcast: AttrRow[]
  by_flow: AttrRow[]
  by_automation: AttrRow[]
  /** El asistente que contesta: la lente que faltaba. */
  by_agent: AttrRow[]
  by_instagram_agent: AttrRow[]
  /** Todas las ventas del rango, atribuidas o no. */
  totals?: {
    revenue: { current: number; previous: number }
    orders: { current: number; previous: number }
    currency: string
  }
  /** Las PROBADAS: el pedido trae una marca de Riverz. Es la cifra grande. */
  attributed?: { revenue: number; orders: number; currency: string }
  /** Las influidas: hubo charla antes de la compra, pero nada lo prueba. */
  assisted?: { revenue: number; orders: number; currency: string }
  /** Los pedidos de esa cifra, uno por uno. Los más caros primero. */
  attributed_orders?: AttributedOrder[]
  /** Hubo más pedidos que los que viajaron en la lista. */
  attributed_orders_truncated?: boolean
  not_connected?: boolean
}

/**
 * Cada cuánto puede moverse el fin del rango.
 *
 * El panel es en vivo: cada mensaje que entra dispara un refresco, y ese
 * refresco recalcula el rango con `new Date()`. Con el fin al milisegundo, el
 * rango era distinto CADA VEZ y esto se volvía a pedir en cada tick — un
 * endpoint que hace una consulta por pedido del período, disparado por cada
 * cliente que escribe. En una cuenta con movimiento eso es un martilleo, y de
 * paso deja la cifra de arriba y el desglose de abajo mostrando dos respuestas
 * distintas mientras una de las dos vuelve.
 *
 * Redondeando el fin a bloques de cinco minutos —hacia arriba, para no perder
 * los pedidos de recién— el rango se repite y el pedido se hace una sola vez.
 * La contrapartida es que una venta tarda a lo sumo cinco minutos en contarse,
 * que para atribución de ingresos no cambia ninguna decisión.
 */
const BLOQUE_MS = 5 * 60_000

export function estabilizar(iso: string, haciaArriba: boolean): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const n = haciaArriba
    ? Math.ceil(t / BLOQUE_MS) * BLOQUE_MS
    : Math.floor(t / BLOQUE_MS) * BLOQUE_MS
  return new Date(n).toISOString()
}

export function useAtribucion(startBruto: string | null, endBruto: string | null) {
  const [data, setData] = useState<Atribucion | null>(null)

  // El inicio siempre cae en un límite de día, así que redondear hacia abajo no
  // lo mueve; se hace igual para que el par sea estable de las dos puntas.
  const start = startBruto ? estabilizar(startBruto, false) : null
  const end = endBruto ? estabilizar(endBruto, true) : null

  useEffect(() => {
    if (!start || !end) return
    let cancelado = false
    void (async () => {
      try {
        // 72 h y no 24: una recuperación de pago rechazado se cobra a los dos o
        // tres días —la persona tiene que hablar con el banco— y con 24 h esas
        // ventas quedaban sin contar.
        const qs = new URLSearchParams({ start, end, attr_hours: '72' })
        const res = await fetch(`/api/analytics/attribution?${qs}`, { cache: 'no-store' })
        const json = (await res.json()) as Atribucion
        if (!cancelado && res.ok) setData(json)
      } catch {
        // Silencioso: son tarjetas de más, no pueden dejar el panel en blanco.
      }
    })()
    return () => {
      cancelado = true
    }
  }, [start, end])

  return data
}
