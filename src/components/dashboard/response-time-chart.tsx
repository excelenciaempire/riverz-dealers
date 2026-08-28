"use client"

import { useState } from 'react'
import { Clock } from 'lucide-react'
import type {
  ResponseTimeMode,
  ResponseTimeReport,
  ResponseTimeSummary,
} from '@/lib/dashboard/types'
import { useT } from '@/hooks/use-locale'
import type { Cortes } from '@/lib/dashboard/cortes'
import type { PrimeraRespuesta } from '@/lib/dashboard/servicio'
import type { TFn } from '@/lib/i18n/translate'
import { cn } from '@/lib/utils'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

interface ResponseTimeChartProps {
  data: ResponseTimeReport | null
  loading: boolean
  /**
   * Quién contestó primero, la IA o una persona. Vive acá y no en la tarjeta de
   * «Lo que resolvió sola»: el promedio de esta tarjeta y la mediana de aquélla
   * son dos formas de medir el mismo minuto, y en la misma pantalla no se leen
   * como dos lecturas sino como un número mal calculado. Acá abajo del promedio
   * la diferencia se explica sola.
   */
  cortes?: Cortes | null
}

const VB_W = 760
const VB_H = 220
const PADDING = { top: 24, right: 16, bottom: 32, left: 44 }

export function ResponseTimeChart({
  data,
  loading,
  cortes,
}: ResponseTimeChartProps) {
  const t = useT()
  // Las dos lecturas vienen calculadas de la misma consulta, así que
  // alternar es instantáneo y no dispara nada.
  const [mode, setMode] = useState<ResponseTimeMode>('first')
  const summary: ResponseTimeSummary | null = data ? data[mode] : null
  const hasData = summary?.buckets.some((b) => b.avgMinutes != null) ?? false

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {mode === 'first'
              ? t('dashboard.avgFirstResponseTime')
              : t('dashboard.avgAllResponseTime')}
          </h2>
          <div className="mt-2 inline-flex rounded-lg border border-border p-0.5">
            <ModeButton
              active={mode === 'first'}
              onClick={() => setMode('first')}
              label={t('dashboard.responseModeFirst')}
            />
            <ModeButton
              active={mode === 'all'}
              onClick={() => setMode('all')}
              label={t('dashboard.responseModeAll')}
            />
          </div>
        </div>
        <div className="text-right text-xs">
          {summary &&
            (summary.thisPeriodAvg != null || summary.prevPeriodAvg != null) && (
              <>
                <div className="text-muted-foreground">
                  {t('dashboard.average')}:{' '}
                  <span className="font-medium text-foreground tabular-nums">
                    {fmt(summary.thisPeriodAvg)}
                  </span>
                </div>
                <div className="text-muted-foreground">
                  {t('dashboard.previousPeriod')}:{' '}
                  <span className="tabular-nums">{fmt(summary.prevPeriodAvg)}</span>
                </div>
              </>
            )}
          {/* Quién llegó primero, y cuánto tardó cada uno.
           *
           * Va debajo del promedio y dice MEDIANA a propósito: son dos
           * estadísticos distintos y antes se apilaban sin decirlo, así que la
           * tarjeta parecía contradecirse — «promedio 4,3 h» arriba y «25 s»
           * abajo. Una media se va con cuatro conversaciones contestadas a los
           * tres días; la mediana no. Las dos son ciertas y miden cosas
           * distintas.
           *
           * El paréntesis es sobre cuántas conversaciones se calculó: una
           * mediana de tres casos no es un dato, y sin el número no hay forma
           * de saberlo. Por eso también se esconde el lado que no llega a
           * cinco. */}
          {mode === 'first' && cortes && (
            <MedianasPrimeraRespuesta r={cortes.respuesta} t={t} />
          )}
        </div>
      </header>

      <div className="p-5">
        {loading || !summary ? (
          <Skeleton className="h-[220px] w-full" />
        ) : !hasData ? (
          <EmptyState
            icon={Clock}
            title={t('dashboard.noResponsesRecorded')}
          />
        ) : (
          <Bars data={summary} t={t} />
        )}
      </div>
    </section>
  )
}

/**
 * Segundos en algo que se lee de un vistazo.
 *
 * Nadie compara "8" con "15600". La gracia de esta línea es que la diferencia
 * se entienda sin hacer cuentas, así que se pasa a la unidad que corresponda.
 */
/** Mínimo de conversaciones para que una mediana signifique algo. */
const MINIMO_MUESTRAS = 5

function MedianasPrimeraRespuesta({
  r,
  t,
}: {
  r: PrimeraRespuesta
  t: TFn
}) {
  const lados = [
    { v: r.ia, n: r.muestrasIa, etiqueta: t('health.soloIa') },
    { v: r.automatico, n: r.muestrasAutomatico, etiqueta: t('health.soloAutomatico') },
    { v: r.humano, n: r.muestrasHumano, etiqueta: t('health.soloHuman') },
  ].filter((l) => l.v != null && l.n >= MINIMO_MUESTRAS)

  if (lados.length === 0) return null

  return (
    <div className="mt-1 text-muted-foreground">
      {t('health.soloMediana')}{' '}
      {lados.map((l, i) => (
        <span key={l.etiqueta}>
          {i > 0 && ' · '}
          {l.etiqueta}{' '}
          <span className="font-medium text-foreground tabular-nums">
            {duracion(l.v as number, t)}
          </span>{' '}
          <span className="tabular-nums">({l.n})</span>
        </span>
      ))}
    </div>
  )
}

function duracion(segundos: number, t: TFn): string {
  if (segundos < 60) return t('health.durSeconds', { n: segundos })
  if (segundos < 3600) return t('health.durMinutes', { n: Math.round(segundos / 60) })
  const h = Math.floor(segundos / 3600)
  const m = Math.round((segundos % 3600) / 60)
  return m > 0
    ? t('health.durHoursMinutes', { h, m })
    : t('health.durHours', { h })
}

function ModeButton({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'bg-accent text-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  )
}

function Bars({ data, t }: { data: ResponseTimeSummary; t: TFn }) {
  const chartW = VB_W - PADDING.left - PADDING.right
  const chartH = VB_H - PADDING.top - PADDING.bottom

  const n = Math.max(1, data.buckets.length)
  const values = data.buckets.map((b) => b.avgMinutes ?? 0)
  const maxY = niceScale(Math.max(1, ...values))
  const yFor = (v: number) =>
    maxY === 0 ? PADDING.top + chartH : PADDING.top + chartH - (v / maxY) * chartH

  const barSlot = chartW / n
  const barW = Math.min(44, barSlot * 0.7)

  const ticks = [0, maxY / 2, maxY]
  // Con muchos buckets (ej. 30 días) no caben todas las etiquetas → mostramos ~8.
  const labelEvery = Math.max(1, Math.ceil(n / 8))

  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-[220px] w-full" role="img">
      {/* Y grid */}
      {ticks.map((tick) => {
        const y = yFor(tick)
        return (
          <g key={tick}>
            <line
              x1={PADDING.left}
              x2={VB_W - PADDING.right}
              y1={y}
              y2={y}
              stroke="var(--border)"
              strokeDasharray="3 3"
            />
            <text
              x={PADDING.left - 8}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {fmt(tick)}
            </text>
          </g>
        )
      })}

      {/* Bars */}
      {data.buckets.map((b, i) => {
        const x = PADDING.left + barSlot * i + (barSlot - barW) / 2
        const label = bucketLabel(b.key)
        // Los buckets sin muestras no dibujan nada. Antes ponían un tocón de
        // 2px que, con un día casi vacío, formaba una hilera de manchitas en
        // la base indistinguible de valores reales muy chicos.
        if (b.avgMinutes == null) {
          return (
            <g key={b.key}>
              <rect
                x={x}
                y={PADDING.top}
                width={barW}
                height={chartH}
                fill="transparent"
              >
                <title>{`${label}: ${t('dashboard.noSamples')}`}</title>
              </rect>
              {i % labelEvery === 0 && (
                <text
                  x={x + barW / 2}
                  y={VB_H - 10}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[11px]"
                >
                  {label}
                </text>
              )}
            </g>
          )
        }
        const y = yFor(b.avgMinutes)
        // Altura mínima visible: un valor real muy por debajo del pico no
        // puede desaparecer del gráfico — "respondimos rápido" y "no hubo
        // nada" tienen que verse distinto.
        const h = Math.max(3, PADDING.top + chartH - y)
        return (
          <g key={b.key}>
            <rect
              x={x}
              y={PADDING.top + chartH - h}
              width={barW}
              height={h}
              rx={4}
              // El violeta de siempre, ahora por token en vez de un hex
              // suelto. Va con `--chart-3` —una serie sin significado
              // asignado— y no con el 1 o el 2: acá no se cuenta lo que entra
              // ni lo que sale, se mide un tiempo.
              fill="var(--chart-3)"
            >
              <title>
                {label}:{' '}
                {t('dashboard.averageValue', { value: fmt(b.avgMinutes) })}
                {b.samples > 0
                  ? ` (${
                      b.samples === 1
                        ? t('dashboard.sampleCountOne', { n: b.samples })
                        : t('dashboard.sampleCountOther', { n: b.samples })
                    })`
                  : ''}
              </title>
            </rect>
            {i % labelEvery === 0 && (
              <text
                x={x + barW / 2}
                y={VB_H - 10}
                textAnchor="middle"
                className="fill-muted-foreground text-[11px]"
              >
                {label}
              </text>
            )}
          </g>
        )
      })}

    </svg>
  )
}

/** Etiqueta legible de un bucket-key: `YYYY-MM-DDTHH` → "HH:00"; `YYYY-MM-DD` → "D/M". */
function bucketLabel(key: string): string {
  if (key.includes('T')) {
    const hh = key.slice(11, 13)
    return `${hh}:00`
  }
  const [, m, d] = key.split('-')
  return d && m ? `${Number(d)}/${Number(m)}` : key
}

export function fmt(mins: number | null): string {
  if (mins == null) return '—'
  if (mins <= 0) return '0'
  if (mins < 1) return `${Math.max(1, Math.round(mins * 60))}s`
  if (mins < 60) return `${Math.round(mins)}m`
  const hours = mins / 60
  // Las horas exactas se escriben "2h", no "2.0h". Es lo que hace que la
  // escala del eje se lea como una escala y no como una medición.
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`
}

/**
 * Tope del eje en un valor redondo PARA LA UNIDAD EN QUE SE MUESTRA.
 *
 * El redondeo genérico a potencias de 10 trabajaba sobre minutos: para un
 * pico de 4 horas daba 500 minutos, que en el eje aparecía como "8.3h".
 * Redondo en minutos, ilegible en pantalla. Acá los escalones son los que
 * uno esperaría ver escritos: 15m, 30m, 1h, 2h, 6h, 12h, 1d…
 *
 * Todos los escalones son divisibles por 2, porque el eje dibuja también
 * la marca intermedia (maxY/2) y esa también tiene que quedar redonda.
 */
export function niceScale(maxMinutes: number): number {
  // Sin el escalón de 3h a propósito: su marca intermedia caería en 1.5h.
  // Cada escalón de acá parte en dos dando una unidad entera, que es lo
  // que hace que el eje se lea de un vistazo.
  const STEPS = [5, 10, 20, 30, 60, 90, 120, 240, 360, 480, 720, 1440]
  for (const step of STEPS) {
    if (maxMinutes <= step) return step
  }
  // Más de un día: se sube de a días enteros.
  return Math.ceil(maxMinutes / 1440) * 1440
}
