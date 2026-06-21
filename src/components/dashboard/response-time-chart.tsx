"use client"

import { Clock } from 'lucide-react'
import { DOW_SHORT_MON_FIRST } from '@/lib/dashboard/date-utils'
import type { ResponseTimeSummary } from '@/lib/dashboard/types'
import { useT } from '@/hooks/use-locale'
import type { TFn } from '@/lib/i18n/translate'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

interface ResponseTimeChartProps {
  data: ResponseTimeSummary | null
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
  const hasData = data?.buckets.some((b) => b.avgMinutes != null) ?? false

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {t('dashboard.avgFirstResponseTime')}
          </h2>
        </div>
        {data && (data.thisPeriodAvg != null || data.prevPeriodAvg != null) && (
          <div className="text-right text-xs">
            <div className="text-muted-foreground">
              {t('dashboard.average')}:{' '}
              <span className="font-medium text-foreground tabular-nums">
                {fmt(data.thisPeriodAvg)}
              </span>
            </div>
            <div className="text-muted-foreground">
              {t('dashboard.previousPeriod')}:{' '}
              <span className="tabular-nums">{fmt(data.prevPeriodAvg)}</span>
            </div>
          </div>
        )}
      </header>

      <div className="p-5">
        {loading || !data ? (
          <Skeleton className="h-[220px] w-full" />
        ) : !hasData ? (
          <EmptyState
            icon={Clock}
            title={t('dashboard.noResponsesRecorded')}
          />
        ) : (
          <Bars data={data} thresholdMinutes={thresholdMinutes} t={t} />
        )}
      </div>
    </section>
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

  const values = data.buckets.map((b) => b.avgMinutes ?? 0)
  const rawMax = Math.max(thresholdMinutes * 1.2, ...values)
  const maxY = niceCeil(rawMax)
  const yFor = (v: number) =>
    maxY === 0 ? PADDING.top + chartH : PADDING.top + chartH - (v / maxY) * chartH

  const barSlot = chartW / 7
  const barW = Math.min(44, barSlot * 0.55)

  const ticks = [0, maxY / 2, maxY].map((t) => Math.round(t))

  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-[220px] w-full" role="img">
      {/* Y grid */}
      {ticks.map((t) => {
        const y = yFor(t)
        return (
          <g key={t}>
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
              {fmt(t)}
            </text>
          </g>
        )
      })}

      {/* Threshold line — rendered after grid so it sits on top, but
          we keep it muted so bars remain the visual focus. */}
      {thresholdMinutes > 0 && thresholdMinutes <= maxY && (
        <g>
          <line
            x1={PADDING.left}
            x2={VB_W - PADDING.right}
            y1={yFor(thresholdMinutes)}
            y2={yFor(thresholdMinutes)}
            stroke="rgb(244 63 94)"
            strokeDasharray="4 4"
            strokeWidth={1.25}
            opacity={0.8}
          />
          {/* Left-anchored so the label never collides with the (usually
              taller) bars on the right side of the chart. */}
          <text
            x={PADDING.left + 4}
            y={yFor(thresholdMinutes) - 4}
            textAnchor="start"
            className="fill-rose-600 dark:fill-rose-300 text-[10px]"
          >
            {t('dashboard.target', { value: fmt(thresholdMinutes) })}
          </text>
        </g>
      )}

      {/* Bars */}
      {data.buckets.map((b, i) => {
        const v = b.avgMinutes ?? 0
        const x = PADDING.left + barSlot * i + (barSlot - barW) / 2
        const y = yFor(v)
        const h = PADDING.top + chartH - y
        const muted = b.avgMinutes == null
        return (
          <g key={i}>
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
                {DOW_SHORT_MON_FIRST[i]}:{' '}
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
            <text
              x={x + barW / 2}
              y={VB_H - 10}
              textAnchor="middle"
              className="fill-muted-foreground text-[11px]"
            >
              {DOW_SHORT_MON_FIRST[i]}
            </text>
          </g>
        )
      })}
    </svg>
  )
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
