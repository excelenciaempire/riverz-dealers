'use client'

import { useT } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import type { Cortes } from '@/lib/dashboard/cortes'

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
 * respuesta a "¿pero lo hizo mejor?". Separadas, cada una se puede discutir;
 * juntas, no.
 *
 * Y abajo, dónde se planta. Un 87% sin el 13% al lado se lee como marketing:
 * mostrar cuándo devuelve el hilo es lo que hace creíble todo lo demás.
 */

/**
 * Cuántas conversaciones hacen falta para mostrar un porcentaje.
 *
 * Con tres atendidas, «resolvió el 100%» es verdad y no significa nada — al día
 * siguiente dice 33% y el comercio deja de creerle a la pantalla. Debajo del
 * umbral se muestran los números enteros, que no mienten en ninguna escala.
 */
const MINIMO_PARA_PORCENTAJE = 10

export function ResolvioSola({ data }: { data: Cortes | null }) {
  const t = useT()
  const fmt = useFormat()

  // Sin nada que contar la tarjeta no aparece. Un panel de cuenta nueva lleno
  // de ceros dice "esto no sirve" justo el día en que hay que engancharlo; lo
  // que ese usuario necesita es el checklist, que ya está arriba.
  if (!data || data.ia.atendidas === 0) return null

  const { ia, fueraDeHorario, respuesta, escalaciones } = data
  const hayMuestra = ia.atendidas >= MINIMO_PARA_PORCENTAJE

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t('health.soloTitle')}
        </h2>
        {hayMuestra && ia.tasa !== null && (
          <p className="text-xs text-muted-foreground">
            {t('health.soloShare', { share: ia.tasa, total: fmt.number(ia.atendidas) })}
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
