"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import type { TFn } from '@/lib/i18n/translate'
import {
  MessageSquare,
  UserPlus,
  Send,
  Inbox,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ChannelMixCard } from '@/components/dashboard/channel-mix-card'
import { SetupChecklist } from '@/components/dashboard/setup-checklist'
import { NeedsAttention } from '@/components/dashboard/needs-attention'
import { PendingApprovals } from '@/components/dashboard/pending-approvals'
import { AttributedRevenue } from '@/components/dashboard/attributed-revenue'
import { useDashboardRealtime } from '@/hooks/use-dashboard-realtime'
import { useTimezone } from '@/hooks/use-timezone'
import {
  DateRangeFilter,
  type CustomRange,
} from '@/components/dashboard/date-range-filter'

import {
  loadActivity,
  loadConversationsSeries,
  loadMetrics,
  loadResponseTime,
} from '@/lib/dashboard/queries'
import {
  previousRangeForPreset,
  rangeForPreset,
  type RangePreset,
} from '@/lib/dashboard/date-utils'
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  MetricsBundle,
  ResponseTimeReport,
} from '@/lib/dashboard/types'

import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import { ConversationsChart } from '@/components/dashboard/conversations-chart'
import { ResponseTimeChart } from '@/components/dashboard/response-time-chart'
import { ActivityFeed } from '@/components/dashboard/activity-feed'

/**
 * El panel del comercio: métricas, gráficos y actividad.
 *
 * Vive acá y no dentro de una página porque tiene dos consumidores. En la
 * aplicación de siempre es la pantalla de Inicio; en Riverz 2.0 es la mitad de
 * abajo de la pestaña Panel, donde se junta con lo que sólo la operación sabe
 * (qué agentes trabajan, qué automatizaciones corrieron). Una implementación:
 * si fueran dos, el mismo comercio vería dos veces las mismas cifras y con
 * distinto resultado, que es el problema que esta versión vino a arreglar.
 *
 * Los dos huecos existen para eso: la operación mete lo suyo EN EL ORDEN
 * correcto —lo que necesita a una persona arriba, lo que está corriendo junto a
 * las métricas— en vez de apilar dos paneles uno abajo del otro.
 */
export function PanelDashboard({
  slotAtencion,
  slotEstado,
  slotDatos,
  tarjetasExtra,
  onRango,
  ocultarChecklist = false,
}: {
  /** Va con lo que necesita a una persona, después de las aprobaciones. */
  slotAtencion?: React.ReactNode
  /** Va después de las tarjetas de métricas. */
  slotEstado?: React.ReactNode
  /** Va antes de los ingresos atribuidos y la actividad. */
  slotDatos?: React.ReactNode
  /** Tarjetas que entran DENTRO de la misma grilla de métricas. */
  tarjetasExtra?: React.ReactNode
  /**
   * Cuántos días abarca el filtro activo. Quien agregue tarjetas propias las
   * tiene que medir sobre el mismo período: dos cifras de la misma pantalla
   * midiendo ventanas distintas es peor que no mostrar una de las dos.
   */
  onRango?: (dias: number) => void
  /** En Riverz 2.0 el asistente de activación reemplaza al checklist. */
  ocultarChecklist?: boolean
} = {}) {
  const t = useT()
  const fmt = useFormat()
  const tz = useTimezone()

  // One global date-range filter drives every card, chart and feed.
  const [preset, setPreset] = useState<RangePreset>('7d')
  const [custom, setCustom] = useState<CustomRange | null>(null)

  // Rango activo en ISO. La tarjeta de ingresos atribuidos consulta una API
  // propia (no Supabase), asi que necesita el rango, no el resultado.
  const [rangeIso, setRangeIso] = useState<{ start: string; end: string } | null>(null)
  const [metrics, setMetrics] = useState<MetricsBundle | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(true)
  const [series, setSeries] = useState<ConversationsSeriesPoint[] | null>(null)
  const [seriesLoading, setSeriesLoading] = useState(true)
  const [responseTime, setResponseTime] = useState<ResponseTimeReport | null>(null)
  const [responseTimeLoading, setResponseTimeLoading] = useState(true)
  const [activity, setActivity] = useState<ActivityItem[] | null>(null)
  const [activityLoading, setActivityLoading] = useState(true)

  // Latest filter + tz in refs so the stable `refresh` callback always reads
  // current values without being recreated (which would re-run effects).
  const presetRef = useRef(preset)
  const customRef = useRef(custom)
  const tzRef = useRef(tz)
  useEffect(() => {
    tzRef.current = tz
  }, [tz])
  // `t` en un ref: loadActivity arma el texto del feed y `refresh` es estable
  // (deps []), así que sin el ref quedaría capturado el `t` inicial y el feed
  // no cambiaría de idioma al vuelo.
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])
  // En un ref por lo mismo que `t`: `refresh` es estable y no puede recrearse
  // cada vez que el padre pasa una función nueva.
  const onRangoRef = useRef(onRango)
  useEffect(() => {
    onRangoRef.current = onRango
  }, [onRango])

  // Epoch guard: switching the range (or a realtime tick) bumps the epoch so
  // a slower earlier response can never land its stale data on a newer one.
  const epochRef = useRef(0)

  const refresh = useCallback(() => {
    const db = createClient()
    const activeTz = tzRef.current
    const range = rangeForPreset(activeTz, presetRef.current, customRef.current)
    setRangeIso({ start: range.start.toISOString(), end: range.end.toISOString() })
    // Días que abarca el filtro, redondeando hacia arriba: "hoy" es 1, no 0.
    onRangoRef.current?.(
      Math.max(1, Math.ceil((range.end.getTime() - range.start.getTime()) / 86_400_000)),
    )
    const prev = previousRangeForPreset(activeTz, presetRef.current, range)
    const epoch = ++epochRef.current
    const fresh = () => epoch === epochRef.current

    void loadMetrics(db, activeTz, range, prev)
      .then((m) => {
        if (fresh()) setMetrics(m)
      })
      .catch((err) => console.error('[dashboard] metrics failed:', err))
      .finally(() => {
        if (fresh()) setMetricsLoading(false)
      })

    void loadConversationsSeries(db, activeTz, range)
      .then((s) => {
        if (fresh()) setSeries(s)
      })
      .catch((err) => console.error('[dashboard] series failed:', err))
      .finally(() => {
        if (fresh()) setSeriesLoading(false)
      })

    void loadResponseTime(db, activeTz, range, prev)
      .then((rt) => {
        if (fresh()) setResponseTime(rt)
      })
      .catch((err) => console.error('[dashboard] response time failed:', err))
      .finally(() => {
        if (fresh()) setResponseTimeLoading(false)
      })

    void loadActivity(db, tRef.current, 50)
      .then((a) => {
        if (fresh()) setActivity(a)
      })
      .catch((err) => console.error('[dashboard] activity failed:', err))
      .finally(() => {
        if (fresh()) setActivityLoading(false)
      })
  }, [])

  // Initial load + re-fetch when the workspace timezone resolves/changes
  // (useTimezone starts with a cached/fallback value, then updates from the
  // DB). This single effect covers BOTH mount and tz changes — skeletons come
  // from the initial *Loading=true state, so refresh never setState's
  // synchronously (safe to call from an effect).
  useEffect(() => {
    refresh()
  }, [tz, refresh])

  // Filter change is a user event → safe to flip skeletons on synchronously.
  const handleFilterChange = useCallback(
    (next: RangePreset, nextCustom?: CustomRange | null) => {
      setPreset(next)
      setCustom(nextCustom ?? null)
      presetRef.current = next
      customRef.current = nextCustom ?? null
      setMetricsLoading(true)
      setSeriesLoading(true)
      setResponseTimeLoading(true)
      setActivityLoading(true)
      refresh()
    },
    [refresh],
  )

  // Live updates — debounced silent refetch keeps the numbers current.
  const { isConnected } = useDashboardRealtime({ onChange: () => refresh() })

  // Catch-up resync on reconnect / tab refocus (Realtime doesn't replay
  // events missed while the socket was down or the tab was backgrounded).
  const wasConnected = useRef(isConnected)
  useEffect(() => {
    if (isConnected && !wasConnected.current) refresh()
    wasConnected.current = isConnected
  }, [isConnected, refresh])
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  const suffix = deltaSuffix(preset, t)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="app-page-title">{t('dashboard.overview')}</h1>
        <LiveIndicator connected={isConnected} t={t} />
      </div>

      {/* Lo que se rompio en silencio. Va PRIMERO: si un envio no salio, eso
          importa mas que cualquier metrica de la pantalla. Solo aparece cuando
          hay algo. */}
      <NeedsAttention />

      {/* Decisiones que la IA no toma sola y esperan a una persona. Van con lo
          roto y no con las metricas: un pago informado sin responder es un
          cliente esperando. */}
      <PendingApprovals />

      {slotAtencion}

      {/* Checklist de onboarding. Solo aparece mientras falte algo (o se oculte). */}
      {!ocultarChecklist && <SetupChecklist />}

      {/* Filtro de fecha — debajo del checklist. Si el checklist se oculta,
          queda justo bajo el header. */}
      <div className="flex justify-end">
        <DateRangeFilter tz={tz} preset={preset} custom={custom} onChange={handleFilterChange} />
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricsLoading || !metrics ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title={t('dashboard.conversations')}
              value={fmt.number(metrics.conversations.current)}
              icon={MessageSquare}
              delta={deltaFor(metrics.conversations.current, metrics.conversations.previous, suffix, t, fmt.number)}
            />
            <MetricCard
              title={t('dashboard.newContacts')}
              value={fmt.number(metrics.newContacts.current)}
              icon={UserPlus}
              delta={deltaFor(metrics.newContacts.current, metrics.newContacts.previous, suffix, t, fmt.number)}
            />
            <MetricCard
              title={t('dashboard.messagesReceived')}
              value={fmt.number(metrics.messagesReceived.current)}
              icon={Inbox}
              delta={deltaFor(metrics.messagesReceived.current, metrics.messagesReceived.previous, suffix, t, fmt.number)}
            />
            <MetricCard
              title={t('dashboard.messagesSent')}
              value={fmt.number(metrics.messagesSent.current)}
              icon={Send}
              delta={deltaFor(metrics.messagesSent.current, metrics.messagesSent.previous, suffix, t, fmt.number)}
            />
            {tarjetasExtra}
          </>
        )}
      </div>

      {slotEstado}

      {/* Channel mix — volume per channel over the selected range. */}
      {metrics && metrics.channelMix.length > 0 && (
        <ChannelMixCard mix={metrics.channelMix} />
      )}

      {/* Conversations over time */}
      <ConversationsChart data={series} loading={seriesLoading} />

      {/* Response time */}
      <ResponseTimeChart data={responseTime} loading={responseTimeLoading} />

      {slotDatos}

      {/* Lo que genero Riverz, en plata. El calculo ya existia y no lo miraba
          nadie: no tenia pantalla. */}
      <AttributedRevenue start={rangeIso?.start ?? null} end={rangeIso?.end ?? null} />

      {/* Activity feed */}
      <ActivityFeed items={activity} loading={activityLoading} />
    </div>
  )
}

// ------------------------------------------------------------

// Subtle live-sync badge. Green pulsing dot while the realtime channel is
// subscribed; muted when the socket is down (data still loads, just not live).
function LiveIndicator({ connected, t }: { connected: boolean; t: TFn }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground"
      title={connected ? t('dashboard.realtimeData') : t('dashboard.noLiveConnection')}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          connected ? 'animate-pulse bg-emerald-500' : 'bg-muted-foreground/40',
        )}
      />
      {connected ? t('dashboard.live') : t('dashboard.offline')}
    </span>
  )
}

function deltaSuffix(preset: RangePreset, t: TFn): string {
  switch (preset) {
    case 'today':
      return t('dashboard.vsYesterdaySoFar')
    case 'yesterday':
      return t('dashboard.vsPreviousDay')
    case '7d':
      return t('dashboard.vsPrevious7d')
    case '30d':
      return t('dashboard.vsPrevious30d')
    case 'custom':
      return t('dashboard.vsPreviousPeriod')
  }
}

function deltaFor(
  current: number,
  previous: number,
  suffix: string,
  t: TFn,
  nf: (v: number) => string,
) {
  const delta = current - previous
  const label =
    delta === 0
      ? t('dashboard.noChange', { suffix })
      : t('dashboard.deltaChange', {
          delta: `${delta > 0 ? '+' : '-'}${nf(Math.abs(delta))}`,
          suffix,
        })
  return { sign: delta, label }
}
