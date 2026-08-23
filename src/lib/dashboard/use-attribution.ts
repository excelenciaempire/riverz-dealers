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
  /** Las que pasaron por Riverz, contando cada pedido una vez. */
  attributed?: { revenue: number; orders: number; currency: string }
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
