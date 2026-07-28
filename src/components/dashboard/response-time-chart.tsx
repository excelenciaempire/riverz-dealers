"use client"

import { useState } from 'react'
import { Clock } from 'lucide-react'
import type {
  ResponseTimeMode,
  ResponseTimeReport,
  ResponseTimeSummary,
} from '@/lib/dashboard/types'
import { useT } from '@/hooks/use-locale'
import type { TFn } from '@/lib/i18n/translate'
import { cn } from '@/lib/utils'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

interface ResponseTimeChartProps {
  data: ResponseTimeReport | null
  loading: boolean
  /** Minutes. Horizontal dashed line rendered at this height. */
  thresholdMinutes?: number
}

const VB_W = 760
const VB_H = 220
const PADDING = { top: 24, right: 16, bottom: 32, left: 44 }

export function ResponseTimeChart({
  data,
  loading,
  thresholdMinutes = 5,
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
        {summary &&
          (summary.thisPeriodAvg != null || summary.prevPeriodAvg != null) && (
            <div className="text-right text-xs">
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
            </div>
          )}
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
          <Bars data={summary} thresholdMinutes={thresholdMinutes} t={t} />
        )}
      </div>
    </section>
  )
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

function Bars({
  data,
  thresholdMinutes,
  t,
}: {
  data: ResponseTimeSummary
  thresholdMinutes: number
  t: TFn
}) {
  const chartW = VB_W - PADDING.left - PADDING.right
  const chartH = VB_H - PADDING.top - PADDING.bottom

  const n = Math.max(1, data.buckets.length)
  const values = data.buckets.map((b) => b.avgMinutes ?? 0)
  const rawMax = Math.max(thresholdMinutes * 1.2, ...values)
  const maxY = niceCeil(rawMax)
  const yFor = (v: number) =>
    maxY === 0 ? PADDING.top + chartH : PADDING.top + chartH - (v / maxY) * chartH

  const barSlot = chartW / n
  const barW = Math.min(44, barSlot * 0.6)

  const ticks = [0, maxY / 2, maxY].map((t) => Math.round(t))
  // Con muchos buckets (ej. 30 días) no caben todas las etiquetas → mostramos ~8.
  const labelEvery = Math.max(1, Math.ceil(n / 8))
  const showThreshold = thresholdMinutes > 0 && thresholdMinutes <= maxY
  const thY = yFor(thresholdMinutes)

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
        const v = b.avgMinutes ?? 0
        const x = PADDING.left + barSlot * i + (barSlot - barW) / 2
        const y = yFor(v)
        const h = PADDING.top + chartH - y
        const muted = b.avgMinutes == null
        const label = bucketLabel(b.key)
        return (
          <g key={b.key}>
            <rect
              x={x}
              y={muted ? PADDING.top + chartH - 2 : y}
              width={barW}
              height={muted ? 2 : Math.max(1, h)}
              rx={4}
              fill={muted ? 'var(--muted)' : '#7c3aed'}
              opacity={muted ? 0.6 : 1}
            >
              <title>
                {label}:{' '}
                {b.avgMinutes == null
                  ? t('dashboard.noSamples')
                  : t('dashboard.averageValue', { value: fmt(b.avgMinutes) })}
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

      {/* Threshold "objetivo" line — rendered LAST so it sits ON TOP of the bars
          (before it hid behind a tall bar). Label right-anchored with a small
          background chip so it's always legible over any bar. */}
      {showThreshold && (
        <g>
          <line
            x1={PADDING.left}
            x2={VB_W - PADDING.right}
            y1={thY}
            y2={thY}
            stroke="rgb(244 63 94)"
            strokeDasharray="4 4"
            strokeWidth={1.25}
          />
          <rect
            x={VB_W - PADDING.right - 82}
            y={thY - 15}
            width={82}
            height={13}
            rx={3}
            fill="var(--card)"
            opacity={0.9}
          />
          <text
            x={VB_W - PADDING.right - 4}
            y={thY - 5}
            textAnchor="end"
            className="fill-rose-600 dark:fill-rose-300 text-[10px]"
          >
            {t('dashboard.target', { value: fmt(thresholdMinutes) })}
          </text>
        </g>
      )}
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

function fmt(mins: number | null): string {
  if (mins == null) return '—'
  if (mins <= 0) return '0'
  if (mins < 1) return `${Math.max(1, Math.round(mins * 60))}s`
  if (mins < 60) return `${Math.round(mins)}m`
  return `${(mins / 60).toFixed(1)}h`
}

function niceCeil(max: number): number {
  if (max <= 0) return 10
  const pow = Math.pow(10, Math.floor(Math.log10(max)))
  const n = max / pow
  let nice: number
  if (n <= 1) nice = 1
  else if (n <= 2) nice = 2
  else if (n <= 5) nice = 5
  else nice = 10
  return nice * pow
}
