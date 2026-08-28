'use client'

import { useT } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import type { Cortes } from '@/lib/dashboard/cortes'
import { cn } from '@/lib/utils'

/**
 * A cuánta gente atendió que, si no, habría esperado.
 *
 * La tarjeta de arriba contesta cuánta plata generó Riverz. Ésta contesta la
 * otra mitad, que es la que decide si el comercio saca a alguien de la bandeja:
 * cuántas conversaciones se cerraron sin que interviniera una persona, cuántas
 * de ésas nadie habría contestado igual —era domingo, era la madrugada— y
 * cuánto tarda cada uno en dar la primera respuesta.
 *
 * Las tres juntas y no sueltas a propósito. «Resolvió el 87%» impresiona hasta
 * que alguien pregunta "¿y una persona no lo hubiera hecho igual?": la línea de
 * fuera de horario es la respuesta a esa pregunta, y la de tiempos es la
 * respuesta a "¿pero lo hizo mejor?".
 *
 * Y abajo, dónde se planta y qué agente lo hizo. Un 87% sin el 13% al lado se
 * lee como marketing: mostrar cuándo devuelve el hilo es lo que hace creíble
 * todo lo demás.
 *
 * Antes esto eran DOS tarjetas pegadas —ésta y «Quién atendió»— alimentadas por
 * el mismo endpoint, y el porcentaje de resolución salía en las dos. El corte
 * por canal se fue a «Volumen por canal», que ya listaba los mismos canales:
 * dos listas de canales en la misma pantalla no son dos lecturas, son la misma
 * leída dos veces.
 */

export function ResolvioSola({ data }: { data: Cortes | null }) {
  const t = useT()
  const fmt = useFormat()

  // Sin nada que contar la tarjeta no aparece. Un panel de cuenta nueva lleno
  // de ceros dice "esto no sirve" justo el día en que hay que engancharlo; lo
  // que ese usuario necesita es el checklist, que ya está arriba.
  if (!data || data.ia.atendidas === 0) return null

  // `tasa` ya viene en null cuando no hay muestras suficientes: el umbral vive
  // en el servidor para que todas las pantallas usen el mismo.
  const { ia, fueraDeHorario, respuesta, escalaciones, agentes } = data

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t('health.soloTitle')}
        </h2>
        {ia.tasa !== null && (
          <p className="text-xs text-muted-foreground">
            {t('health.soloShare', { share: ia.tasa, total: fmt.number(ia.atendidas) })}
            {/* De dónde venía. Un porcentaje solo no dice si mejoró. */}
            {ia.tasaPrevia !== null && (
              <span className="ml-2 tabular-nums">
                {ia.tasa >= ia.tasaPrevia ? '+' : ''}
                {ia.tasa - ia.tasaPrevia} pts
              </span>
            )}
          </p>
        )}
      </div>

      <ul className="mt-3 space-y-2 text-sm">
        <Linea
          valor={fmt.number(ia.resueltas)}
          texto={t('health.soloResolved')}
        />

        {/* Lo que un humano no habría contestado. Es la línea que no admite
            discusión, así que va antes que la de tiempos. */}
        {fueraDeHorario.sinHorario ? (
          <li className="text-xs text-muted-foreground">
            {t('health.soloNoSchedule')}
          </li>
        ) : (
          fueraDeHorario.atendidas > 0 && (
            <Linea
              valor={fmt.number(fueraDeHorario.atendidas)}
              texto={t('health.soloAfterHours')}
            />
          )
        )}

        {/* Satisfacción sobre quienes calificaron. Venía de «Quién atendió» y
            es la única lectura que dice si además de resolver, sirvió. */}
        {ia.calificaron > 0 && ia.satisfaccion !== null && (
          <Linea
            valor={`${ia.satisfaccion}%`}
            texto={t('dashboard.iaSatisfaction', { n: ia.calificaron })}
          />
        )}

        {respuesta.ia !== null && (
          <li className="text-muted-foreground">
            {t('health.soloFirstReply')}{' '}
            <span className="font-medium text-foreground">
              {duracion(respuesta.ia, t)}
            </span>
            {respuesta.humano !== null && (
              <>
                {' · '}
                {t('health.soloHuman')}{' '}
                <span className="font-medium text-foreground">
                  {duracion(respuesta.humano, t)}
                </span>
              </>
            )}
          </li>
        )}
      </ul>

      {escalaciones.total > 0 && (
        <p className="mt-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          {t('health.soloEscalated', { n: escalaciones.total })}{' '}
          {escalaciones.motivos
            .slice(0, 3)
            .map((m) => `${m.n} ${t(`health.reason_${m.motivo}`)}`)
            .join(' · ')}
        </p>
      )}

      {/* Qué agente lo hizo, y en cuántas se abstuvo. Es lo que explica un
          agente que parece apagado y no lo está: el motivo dice por qué. */}
      {agentes.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
          {agentes.map((a) => (
            <li key={a.agenteId} className="flex flex-wrap items-baseline gap-x-2 text-xs">
              <span
                className={cn(
                  'font-medium',
                  a.activo ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {a.nombre}
              </span>
              {!a.activo && (
                <span className="text-muted-foreground">{t('dashboard.whoPaused')}</span>
              )}
              <span className="tabular-nums text-muted-foreground">
                {t('dashboard.whoAnswered', { n: a.respondio })}
              </span>
              {a.seAbstuvo > 0 && (
                <span className="tabular-nums text-muted-foreground">
                  · {t('dashboard.whoSkipped', { n: a.seAbstuvo })}
                  {a.motivo ? ` (${a.motivo})` : ''}
                </span>
              )}
              {a.fallo > 0 && (
                <span className="tabular-nums text-amber-600 dark:text-amber-400">
                  · {t('dashboard.whoFailed', { n: a.fallo })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Linea({ valor, texto }: { valor: string; texto: string }) {
  return (
    <li className="flex items-baseline gap-2">
      <span className="font-semibold tabular-nums text-foreground">{valor}</span>
      <span className="text-muted-foreground">{texto}</span>
    </li>
  )
}

type TFn = ReturnType<typeof useT>

/**
 * Segundos en algo que se lee de un vistazo.
 *
 * Nadie compara "8" con "15600". La gracia de esta línea es que la diferencia
 * se entienda sin hacer cuentas, así que se pasa a la unidad que corresponda.
 */
function duracion(segundos: number, t: TFn): string {
  if (segundos < 60) return t('health.durSeconds', { n: segundos })
  if (segundos < 3600) return t('health.durMinutes', { n: Math.round(segundos / 60) })
  const h = Math.floor(segundos / 3600)
  const m = Math.round((segundos % 3600) / 60)
  return m > 0
    ? t('health.durHoursMinutes', { h, m })
    : t('health.durHours', { h })
}
