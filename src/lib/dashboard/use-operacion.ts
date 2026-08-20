'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * El único número de la operación que el panel no puede sacar solo.
 *
 * Cuántos mensajes escribió la IA vive en `ai_replies`, que el navegador no
 * lee: las métricas del panel salen de Supabase con la sesión del comercio y
 * esa tabla se consulta del lado del servidor. Por eso hay un endpoint para una
 * cifra.
 *
 * `dias` sigue al filtro de fechas del panel: si el comercio pide 30 días y
 * esta cifra siguiera en 7, dos tarjetas de la misma pantalla estarían midiendo
 * períodos distintos sin decirlo.
 */

export interface Overview {
  metricas: {
    periodo: { dias: number }
    ia: { respondio: number; se_abstuvo: number; fallo: number }
  } | null
}

export function useOperacion(dias = 7) {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState(false)

  const load = useCallback(async (d: number) => {
    setError(false)
    try {
      const res = await fetch(`/api/operacion/overview?dias=${d}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('failed')
      setData((await res.json()) as Overview)
    } catch {
      setError(true)
    }
  }, [])

  useEffect(() => {
    void load(dias)
  }, [load, dias])

  return { data, error, reload: () => load(dias) }
}
