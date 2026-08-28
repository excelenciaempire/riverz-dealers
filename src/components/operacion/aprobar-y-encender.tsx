'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, Power } from 'lucide-react'
import Link from '@/components/i18n/locale-link'
import { useT } from '@/hooks/use-locale'
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf'
import { Button } from '@/components/ui/button'

/**
 * El paso 4 de la instalación, en una tarjeta.
 *
 * Cuando se monta una cuenta, todo nace apagado: los agentes, las
 * automatizaciones y —desde el motor— la cuenta entera. Sin esta pantalla, el
 * comercio tendría que ir encendiendo de a uno, que es justo el trabajo que la
 * instalación venía a sacarle.
 *
 * Aparece sólo cuando hay algo que aprobar. Con el motor andando no se muestra
 * nada: una tarjeta permanente que dice "todo bien" es ruido en la pantalla que
 * el comercio abre todos los días.
 *
 * Si la cuenta está suspendida por cobro, el botón no aparece: encender lo que
 * el comercio aprobó no puede saltear el otro freno, y prometerle un botón que
 * no va a hacer nada es peor que no mostrarlo.
 */

interface Estado {
  apagado: boolean
  suspendida: boolean
  esperandoAprobacion: boolean
  hechos: { que: string; ok: boolean }[]
  instalado: boolean
}

export function AprobarYEncender() {
  const t = useT()
  const fetchWithCsrf = useFetchWithCsrf()
  const [estado, setEstado] = useState<Estado | null>(null)
  const [encendiendo, setEncendiendo] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelado = false
    void (async () => {
      try {
        const res = await fetch('/api/operacion/motor', { cache: 'no-store' })
        if (!res.ok) return
        const json = (await res.json()) as Estado
        if (!cancelado) setEstado(json)
      } catch {
        /* sin respuesta no se muestra nada: es una tarjeta, no la pantalla */
      }
    })()
    return () => {
      cancelado = true
    }
  }, [])

  const encender = useCallback(async () => {
    setEncendiendo(true)
    setError(false)
    try {
      const res = await fetchWithCsrf('/api/operacion/motor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ encendido: true }),
      })
      if (!res.ok) throw new Error('failed')
      setEstado((prev) =>
        prev ? { ...prev, apagado: false, esperandoAprobacion: false } : prev,
      )
    } catch {
      setError(true)
    } finally {
      setEncendiendo(false)
    }
  }, [fetchWithCsrf])

  if (!estado?.apagado) return null

  const suspendida = estado.suspendida
  const instalado = estado.instalado && estado.hechos.length > 0

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
      <div className="flex items-start gap-3">
        <Power className="mt-0.5 size-4 shrink-0 text-accent-ink" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {t(instalado ? 'operation.motorTitulo' : 'operation.motorApagadoTitulo')}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {suspendida
              ? t('operation.motorSuspendida')
              : t(instalado ? 'operation.motorBajada' : 'operation.motorApagadoBajada')}
          </p>

          {instalado && (
            <ul className="mt-3 space-y-1">
              {estado.hechos.map((h, i) => (
                <li
                  key={`${h.que}-${i}`}
                  className="flex items-center gap-2 text-sm text-foreground"
                >
                  <Check className="size-3 shrink-0 text-accent-ink" />
                  {h.que}
                </li>
              ))}
            </ul>
          )}

          {!suspendida && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={() => void encender()} disabled={encendiendo}>
                {encendiendo ? (
                  <>
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    {t('operation.motorEncendiendo')}
                  </>
                ) : (
                  t('operation.motorEncender')
                )}
              </Button>
              <Link
                href="/operacion/pliego"
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {t('operation.motorRevisarReglas')}
              </Link>
            </div>
          )}

          {error && (
            <p className="mt-2 text-sm text-destructive">{t('operation.motorError')}</p>
          )}
        </div>
      </div>
    </div>
  )
}
