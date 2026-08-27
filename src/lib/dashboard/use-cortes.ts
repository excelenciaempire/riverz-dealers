'use client'

import { useEffect, useState } from 'react'
import type { Cortes } from './cortes'
import { estabilizar } from './use-attribution'

/**
 * Los cortes de atención, pedidos una sola vez.
 *
 * Vive acá y no dentro de una tarjeta porque ahora lo miran dos: «Lo que
 * resolvió sola» y «Quién atendió». El endpoint lee conversaciones, respuestas
 * y mensajes del rango entero, así que pedirlo dos veces se nota — y de paso
 * las dos tarjetas mostrarían números distintos mientras una de las dos vuelve.
 *
 * El rango se redondea a bloques de cinco minutos igual que en atribución: el
 * panel es en vivo y cada mensaje que entra dispara un refresco que recalcula
 * el fin con `new Date()`. Sin redondear, el par de fechas cambiaba en cada
 * tick y esto se volvía a pedir cada vez.
 */
export function useCortes(startBruto: string | null, endBruto: string | null) {
  const [data, setData] = useState<Cortes | null>(null)

  const start = startBruto ? estabilizar(startBruto, false) : null
  const end = endBruto ? estabilizar(endBruto, true) : null

  useEffect(() => {
    if (!start || !end) return
    let cancelado = false
    void (async () => {
      try {
        const qs = new URLSearchParams({ start, end })
        const res = await fetch(`/api/analytics/cortes?${qs}`, { cache: 'no-store' })
        if (!cancelado) setData(res.ok ? ((await res.json()) as Cortes) : null)
      } catch {
        // Silencioso: son tarjetas de más, no pueden dejar el panel en blanco.
        if (!cancelado) setData(null)
      }
    })()
    return () => {
      cancelado = true
    }
  }, [start, end])

  return data
}
