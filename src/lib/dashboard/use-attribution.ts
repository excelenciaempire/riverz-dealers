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

export function useAtribucion(start: string | null, end: string | null) {
  const [data, setData] = useState<Atribucion | null>(null)

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
