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
import { ResolvioSola } from '@/components/dashboard/resolvio-sola'
import { TarjetasRoi } from '@/components/dashboard/tarjetas-roi'
import { useAtribucion } from '@/lib/dashboard/use-attribution'
import { useCortes } from '@/lib/dashboard/use-cortes'
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
  roi = false,
  respuestasIa = null,
  onRango,
}: {
  /**
   * Cambia las cuatro tarjetas de volumen por las seis de retorno.
   *
   * Es un interruptor y no dos componentes porque todo lo demás —el filtro de
   * fechas, los gráficos, el tiempo real, la atribución— es exactamente el
   * mismo. Duplicar la pantalla para cambiar seis tarjetas volvería a dejar dos
   * verdades sobre la misma cuenta.
   */
  roi?: boolean
  /** Mensajes que escribió la IA en el período; sólo lo sabe la operación. */
  respuestasIa?: number | null
  /**
   * Cuántos días abarca el filtro activo. Quien agregue tarjetas propias las
   * tiene que medir sobre el mismo período: dos cifras de la misma pantalla
   * midiendo ventanas distintas es peor que no mostrar una de las dos.
   */
  onRango?: (dias: number) => void
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

  // Una sola vez, para las tarjetas de arriba Y el desglose de abajo: el
  // endpoint hace una consulta por pedido del rango y pedirlo dos veces se nota.
  const atribucion = useAtribucion(rangeIso?.start ?? null, rangeIso?.end ?? null)
  // Lo mismo para los cortes de atención: los miran dos tarjetas.
  const cortes = useCortes(rangeIso?.start ?? null, rangeIso?.end ?? null)

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

      {/* Checklist de onboarding. Se esconde solo cuando ya no falta nada. */}
      <SetupChecklist />

      {/* Filtro de fecha — debajo del checklist. Si el checklist se oculta,
          queda justo bajo el header. */}
      <div className="flex justify-end">
        <DateRangeFilter tz={tz} preset={preset} custom={custom} onChange={handleFilterChange} />
      </div>

      {/* Metric cards */}
      <div
        className={cn(
          'grid grid-cols-1 gap-4 sm:grid-cols-2',
          roi ? 'lg:grid-cols-3' : 'lg:grid-cols-4',
        )}
      >
        {metricsLoading || !metrics ? (
          Array.from({ length: roi ? 6 : 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : roi ? (
          <TarjetasRoi
            metrics={metrics}
            atribucion={atribucion}
            respuestasIa={respuestasIa}
            sufijo={suffix}
          />
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
          </>
        )}
      </div>

      {/* Channel mix — volume per channel over the selected range, y cuánto de
          cada canal tocó la IA. El corte por canal vivía en una segunda tarjeta
          («Quién atendió») que repetía esta misma lista más abajo. */}
      {metrics && metrics.channelMix.length > 0 && (
        <ChannelMixCard mix={metrics.channelMix} cortes={cortes} />
      )}

      {/* Conversations over time */}
      <ConversationsChart data={series} loading={seriesLoading} />

      {/* Response time. La comparacion IA-vs-persona va acá adentro: es el
          mismo minuto medido de otra forma, y en dos tarjetas se leia como dos
          numeros que no cierran. */}
      <ResponseTimeChart
        data={responseTime}
        loading={responseTimeLoading}
        cortes={cortes}
      />

      {/* De donde salio esa plata: cual automatizacion, cual campana, cual
          flujo. El total ya esta arriba; esto es la pregunta que sigue. */}
      <AttributedRevenue data={atribucion} />

      {/* La otra mitad de la pregunta: a cuanta gente atendio que si no habria
          esperado. Va DESPUES de la plata — primero cuanto rindio, despues
          cuanto trabajo. Trae adentro el corte por agente, que antes era una
          tarjeta aparte que repetia el mismo porcentaje. */}
      <ResolvioSola data={cortes} />

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
