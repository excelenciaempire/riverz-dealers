"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  MessageSquare,
  UserPlus,
  CheckCircle2,
  Send,
  Inbox,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ChannelMixCard } from '@/components/dashboard/channel-mix-card'
import { SetupChecklist } from '@/components/dashboard/setup-checklist'
import { useDashboardRealtime } from '@/hooks/use-dashboard-realtime'
import { useTimezone } from '@/hooks/use-timezone'

import {
  loadActivity,
  loadConversationsSeries,
  loadMetrics,
  loadResponseTime,
} from '@/lib/dashboard/queries'
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  MetricsBundle,
  ResponseTimeSummary,
} from '@/lib/dashboard/types'

import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import { ConversationsChart } from '@/components/dashboard/conversations-chart'
import { ResponseTimeChart } from '@/components/dashboard/response-time-chart'
import { ActivityFeed } from '@/components/dashboard/activity-feed'

type RangeDays = 7 | 30 | 90

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<MetricsBundle | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(true)

  const [range, setRange] = useState<RangeDays>(30)
  // Keep a cache per range so switching tabs doesn't re-fetch what we
  // already have. Ranges the user hasn't opened yet stay null and
  // trigger a fetch on first view.
  const [series, setSeries] = useState<Record<RangeDays, ConversationsSeriesPoint[] | null>>({
    7: null,
    30: null,
    90: null,
  })
  const [seriesLoading, setSeriesLoading] = useState(true)

  const [responseTime, setResponseTime] = useState<ResponseTimeSummary | null>(null)
  const [responseTimeLoading, setResponseTimeLoading] = useState(true)

  const [activity, setActivity] = useState<ActivityItem[] | null>(null)
  const [activityLoading, setActivityLoading] = useState(true)

  // Current range in a ref so the realtime refetch (a stable callback)
  // reloads whichever range the user is viewing without re-subscribing.
  const rangeRef = useRef(range)
  useEffect(() => {
    rangeRef.current = range
  }, [range])

  // The workspace timezone (the app's single reporting zone) drives every
  // day-boundary in the loaders below. Mirror it into a ref for the same
  // reason as range: `refresh` is a stable []-memoised callback and must
  // read the latest tz without being re-created.
  const tz = useTimezone()
  const tzRef = useRef(tz)

  // Refetch everything. All state writes happen in async callbacks (never
  // synchronously here) so this is safe to call straight from an effect —
  // first-load skeletons come from the initial `*Loading = true` state, and
  // live refetches update the numbers in place without a skeleton flash.
  // `silent` only controls series-cache invalidation (see below).
  const refresh = useCallback((opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false
    const db = createClient()
    const r = rangeRef.current
    const activeTz = tzRef.current

    void loadMetrics(db, activeTz)
      .then((m) => setMetrics(m))
      .catch((err) => console.error('[dashboard] metrics failed:', err))
      .finally(() => setMetricsLoading(false))

    // Reload the range in view and invalidate the other cached ranges so
    // they refetch on next view — a live update makes all of them stale.
    void loadConversationsSeries(db, activeTz, r)
      .then((s) => {
        // If the user switched ranges while this was in flight, drop the
        // result — handleRangeChange now owns the visible range, and
        // applying stale data here would clobber it (flicker / wrong bars).
        if (rangeRef.current !== r) return
        setSeries((prev) => {
          const next: Record<RangeDays, ConversationsSeriesPoint[] | null> =
            silent ? { 7: null, 30: null, 90: null } : { ...prev }
          next[r] = s
          return next
        })
      })
      .catch((err) => console.error('[dashboard] series failed:', err))
      .finally(() => setSeriesLoading(false))

    void loadResponseTime(db, activeTz)
      .then((rt) => setResponseTime(rt))
      .catch((err) => console.error('[dashboard] response time failed:', err))
      .finally(() => setResponseTimeLoading(false))

    // Fetch up to 50 so the biggest page-size option in the feed (50 rows)
    // is already in memory — switching sizes is then a pure client slice.
    void loadActivity(db, 50)
      .then((a) => setActivity(a))
      .catch((err) => console.error('[dashboard] activity failed:', err))
      .finally(() => setActivityLoading(false))
  }, [])

  // Initial load. Reads tzRef.current, seeded from the cached workspace tz,
  // so the very first buckets are already in the right zone for a returning
  // user.
  useEffect(() => {
    refresh()
  }, [refresh])

  // When the workspace tz resolves to a value different from the cached
  // seed (or an admin changes it), re-bucket everything in the new zone.
  // The ref guard makes this a no-op on mount, so the initial load above
  // isn't duplicated.
  useEffect(() => {
    if (tzRef.current === tz) return
    tzRef.current = tz
    refresh({ silent: true })
  }, [tz, refresh])

  // Live updates — any change to messages / conversations / contacts /
  // broadcasts / automation_logs (debounced) triggers a silent refetch so
  // the numbers stay in sync without a manual reload.
  const { isConnected } = useDashboardRealtime({
    onChange: () => refresh({ silent: true }),
  })

  // Catch-up resync: Realtime does NOT replay events missed while the
  // socket was down or the tab was backgrounded, so refetch whenever the
  // channel reconnects or the tab returns to the foreground.
  const wasConnected = useRef(isConnected)
  useEffect(() => {
    if (isConnected && !wasConnected.current) refresh({ silent: true })
    wasConnected.current = isConnected
  }, [isConnected, refresh])
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh({ silent: true })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  // Range switch handler — kept in an event callback (not an effect) so
  // the setState calls stay out of the react-hooks/set-state-in-effect
  // rule's way. The cached bucket check means switching back to a
  // previously-viewed range is instant and doesn't re-fetch.
  const handleRangeChange = useCallback(
    (r: RangeDays) => {
      setRange(r)
      if (series[r] !== null) return
      setSeriesLoading(true)
      const db = createClient()
      loadConversationsSeries(db, tz, r)
        .then((s) => setSeries((prev) => ({ ...prev, [r]: s })))
        .catch((err) => console.error('[dashboard] series failed:', err))
        .finally(() => setSeriesLoading(false))
    },
    [series, tz],
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="app-eyebrow">Inicio</p>
          <h1 className="app-page-title mt-1.5">Resumen</h1>
        </div>
        <LiveIndicator connected={isConnected} />
      </div>

      {/* Checklist de onboarding. Solo aparece mientras falte algo. */}
      <SetupChecklist />


      {/* Metric cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {metricsLoading || !metrics ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title="Conversaciones abiertas"
              value={metrics.activeConversations.current.toLocaleString()}
              icon={MessageSquare}
              subtitle="En curso ahora"
            />
            <MetricCard
              title="Contactos nuevos hoy"
              value={metrics.newContactsToday.current.toLocaleString()}
              icon={UserPlus}
              delta={{
                sign:
                  metrics.newContactsToday.current - metrics.newContactsToday.previous,
                label: deltaLabel(
                  metrics.newContactsToday.current - metrics.newContactsToday.previous,
                  'vs ayer',
                ),
              }}
            />
            <MetricCard
              title="Resueltas hoy"
              value={metrics.resolvedToday.current.toLocaleString()}
              icon={CheckCircle2}
              delta={{
                sign:
                  metrics.resolvedToday.current - metrics.resolvedToday.previous,
                label: deltaLabel(
                  metrics.resolvedToday.current - metrics.resolvedToday.previous,
                  'vs ayer',
                ),
              }}
            />
            <MetricCard
              title="Mensajes recibidos hoy"
              value={metrics.messagesReceivedToday.current.toLocaleString()}
              icon={Inbox}
              delta={{
                sign:
                  metrics.messagesReceivedToday.current - metrics.messagesReceivedToday.previous,
                label: deltaLabel(
                  metrics.messagesReceivedToday.current - metrics.messagesReceivedToday.previous,
                  'vs ayer',
                ),
              }}
            />
            <MetricCard
              title="Mensajes enviados hoy"
              value={metrics.messagesSentToday.current.toLocaleString()}
              icon={Send}
              delta={{
                sign:
                  metrics.messagesSentToday.current - metrics.messagesSentToday.previous,
                label: deltaLabel(
                  metrics.messagesSentToday.current - metrics.messagesSentToday.previous,
                  'vs ayer',
                ),
              }}
            />
          </>
        )}
      </div>

      {/* Channel mix — volume per channel over the last 7 days. Helps the
          team see WHERE the inbox load is coming from at a glance. */}
      {metrics && metrics.channelMix.length > 0 && (
        <ChannelMixCard mix={metrics.channelMix} />
      )}

      {/* Charts row */}
      <ConversationsChart
        series={series}
        loading={seriesLoading}
        range={range}
        onRangeChange={handleRangeChange}
      />

      {/* Response time */}
      <ResponseTimeChart data={responseTime} loading={responseTimeLoading} />

      {/* Activity feed */}
      <ActivityFeed items={activity} loading={activityLoading} />
    </div>
  )
}

// ------------------------------------------------------------

// Subtle live-sync badge. Green pulsing dot while the realtime channel is
// subscribed; muted when the socket is down (data still loads, just not
// pushed live).
function LiveIndicator({ connected }: { connected: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground"
      title={connected ? 'Datos en tiempo real' : 'Sin conexión en vivo'}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          connected ? 'animate-pulse bg-emerald-500' : 'bg-muted-foreground/40',
        )}
      />
      {connected ? 'En vivo' : 'Sin conexión'}
    </span>
  )
}

function deltaLabel(delta: number, suffix: string): string {
  if (delta === 0) return `Sin cambios ${suffix}`
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toLocaleString()} ${suffix}`
}
