'use client';

import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import Link from '@/components/i18n/locale-link';
import {
  Megaphone,
  Workflow,
  Loader2,
  ShoppingBag,
  AlertCircle,
  Zap,
  DollarSign,
  ShoppingCart,
  Receipt,
  MessagesSquare,
  UserPlus,
  CheckCircle2,
  Clock,
  Inbox,
  Send,
  PhoneCall,
  PhoneIncoming,
  BadgeCheck,
  Timer,
  TrendingUp,
} from 'lucide-react';
import { InstagramIcon } from '@/components/layout/instagram-icon';
import { MetricCard } from '@/components/dashboard/metric-card';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { useTimezone } from '@/hooks/use-timezone';
import {
  rangeForPreset,
  previousRangeForPreset,
  type RangePreset,
} from '@/lib/dashboard/date-utils';
import { loadMetrics, loadResponseTime } from '@/lib/dashboard/queries';
import type { MetricsBundle, ResponseTimeSummary, MetricDelta } from '@/lib/dashboard/types';
import {
  DateRangeFilter,
  type CustomRange,
} from '@/components/dashboard/date-range-filter';

type IconType = ComponentType<{ className?: string }>;

interface AttributionRow {
  id: string;
  name: string;
  orders_count: number;
  revenue: number;
  currency: string;
}

interface CommerceTotals {
  revenue: { current: number; previous: number };
  orders: { current: number; previous: number };
  currency: string;
}

interface AttributionResponse {
  days: number;
  by_broadcast: AttributionRow[];
  by_flow: AttributionRow[];
  by_automation: AttributionRow[];
  by_instagram_agent: AttributionRow[];
  totals?: CommerceTotals;
  not_connected?: boolean;
  error?: string;
}

interface VoiceStats {
  total: number;
  answered: number;
  answered_pct: number;
  confirmed: number;
  confirmed_pct: number;
  minutes: number;
  cost: number;
  upsell_revenue: number;
}

export default function RendimientoPage() {
  const t = useT();
  const fmt = useFormat();
  const tz = useTimezone();
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id;

  const [preset, setPreset] = useState<RangePreset>('30d');
  const [custom, setCustom] = useState<CustomRange | null>(null);
  const [data, setData] = useState<AttributionResponse | null>(null);
  const [metrics, setMetrics] = useState<MetricsBundle | null>(null);
  const [resp, setResp] = useState<ResponseTimeSummary | null>(null);
  const [voice, setVoice] = useState<VoiceStats | null>(null);
  const [loading, setLoading] = useState(true);

  const presetRef = useRef(preset);
  const customRef = useRef(custom);
  const tzRef = useRef(tz);
  const wsRef = useRef(workspaceId);

  // Out-of-order guard: a slower earlier request can't overwrite a newer one.
  const reqEpoch = useRef(0);

  const load = useCallback(() => {
    const epoch = ++reqEpoch.current;
    const activeTz = tzRef.current;
    const range = rangeForPreset(activeTz, presetRef.current, customRef.current);
    const prev = previousRangeForPreset(activeTz, presetRef.current, range);
    const qs = `start=${encodeURIComponent(range.start.toISOString())}&end=${encodeURIComponent(range.end.toISOString())}`;

    // 1) Atribución + totales de comercio (Shopify).
    const attribution = fetch(`/api/analytics/attribution?${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (epoch === reqEpoch.current && d) setData(d);
      })
      .catch(() => {})
      .finally(() => {
        if (epoch === reqEpoch.current) setLoading(false);
      });

    // 2) Conversaciones / mensajes / contactos (Supabase, con delta vs previo).
    const db = createClient();
    void loadMetrics(db, activeTz, range, prev)
      .then((m) => {
        if (epoch === reqEpoch.current) setMetrics(m);
      })
      .catch(() => {});
    void loadResponseTime(db, activeTz, range, prev)
      .then((r) => {
        if (epoch === reqEpoch.current) setResp(r);
      })
      .catch(() => {});

    // 3) Llamadas.
    if (wsRef.current) {
      void fetch(
        `/api/voice/analytics?workspace_id=${wsRef.current}&${qs}`,
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((v) => {
          if (epoch === reqEpoch.current && v && !v.error) setVoice(v);
        })
        .catch(() => {});
    }

    return attribution;
  }, []);

  useEffect(() => {
    tzRef.current = tz;
    wsRef.current = workspaceId;
    if (workspaceId) load();
  }, [tz, workspaceId, load]);

  // Auto-refresh cada 60s + al volver a la pestaña (atribución es de Shopify,
  // sin realtime). Silencioso.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const handleFilterChange = useCallback(
    (next: RangePreset, nextCustom?: CustomRange | null) => {
      setPreset(next);
      setCustom(nextCustom ?? null);
      presetRef.current = next;
      customRef.current = nextCustom ?? null;
      setLoading(true);
      load();
    },
    [load],
  );

  // ── Derived ──
  const totals = data?.totals;
  const currency =
    totals?.currency ??
    data?.by_broadcast?.[0]?.currency ??
    data?.by_flow?.[0]?.currency ??
    'USD';
  const aovCur = totals && totals.orders.current ? totals.revenue.current / totals.orders.current : 0;
  const aovPrev = totals && totals.orders.previous ? totals.revenue.previous / totals.orders.previous : 0;

  const totalBroadcastRevenue = sumRevenue(data?.by_broadcast);
  const totalFlowRevenue = sumRevenue(data?.by_flow);
  const totalAutomationRevenue = sumRevenue(data?.by_automation);
  const totalInstagramRevenue = sumRevenue(data?.by_instagram_agent);

  const delta = (d: MetricDelta | undefined) => makeDelta(t, d?.current ?? 0, d?.previous ?? 0);
  const money = (n: number) => formatMoney(fmt, n, currency);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="app-page-title">{t('metrics.title')}</h1>
        <DateRangeFilter tz={tz} preset={preset} custom={custom} onChange={handleFilterChange} />
      </div>

      {loading && !data ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* ── Comercio (Shopify) ── */}
          <Section title={t('metrics.secCommerce')}>
            {data?.not_connected ? (
              <ConnectShopify t={t} full />
            ) : data?.error ? (
              <ShopifyError t={t} />
            ) : (
              <Grid>
                <MetricCard
                  title={t('metrics.kpiRevenue')}
                  value={money(totals?.revenue.current ?? 0)}
                  icon={DollarSign}
                  delta={makeDelta(t, totals?.revenue.current ?? 0, totals?.revenue.previous ?? 0)}
                />
                <MetricCard
                  title={t('metrics.kpiOrders')}
                  value={fmt.number(totals?.orders.current ?? 0)}
                  icon={ShoppingCart}
                  delta={makeDelta(t, totals?.orders.current ?? 0, totals?.orders.previous ?? 0)}
                />
                <MetricCard
                  title={t('metrics.kpiAov')}
                  value={money(aovCur)}
                  icon={Receipt}
                  delta={makeDelta(t, aovCur, aovPrev)}
                />
              </Grid>
            )}
          </Section>

          {/* ── Ingresos atribuidos (canales Riverz) ── */}
          {!data?.not_connected && !data?.error && (
            <Section title={t('metrics.secAttributed')} note={t('metrics.attributionNote')}>
              <Grid>
                <MetricCard
                  title={t('metrics.cardCampaigns')}
                  value={money(totalBroadcastRevenue)}
                  icon={Megaphone}
                  subtitle={t('metrics.withSales', { n: data?.by_broadcast?.length ?? 0 })}
                />
                <MetricCard
                  title={t('metrics.cardFlows')}
                  value={money(totalFlowRevenue)}
                  icon={Workflow}
                  subtitle={t('metrics.withSales', { n: data?.by_flow?.length ?? 0 })}
                />
                <MetricCard
                  title={t('metrics.cardInstagramAgent')}
                  value={money(totalInstagramRevenue)}
                  icon={InstagramIcon}
                  subtitle={t('metrics.withSales', { n: data?.by_instagram_agent?.length ?? 0 })}
                />
                <MetricCard
                  title={t('metrics.cardAutomations')}
                  value={money(totalAutomationRevenue)}
                  icon={Zap}
                  subtitle={t('metrics.withSales', { n: data?.by_automation?.length ?? 0 })}
                />
              </Grid>
            </Section>
          )}

          {/* ── Conversaciones ── */}
          <Section title={t('metrics.secConversations')}>
            <Grid>
              <MetricCard
                title={t('metrics.kpiConversations')}
                value={fmt.number(metrics?.conversations.current ?? 0)}
                icon={MessagesSquare}
                delta={delta(metrics?.conversations)}
              />
              <MetricCard
                title={t('metrics.kpiNewContacts')}
                value={fmt.number(metrics?.newContacts.current ?? 0)}
                icon={UserPlus}
                delta={delta(metrics?.newContacts)}
              />
              <MetricCard
                title={t('metrics.kpiResolved')}
                value={fmt.number(metrics?.resolved.current ?? 0)}
                icon={CheckCircle2}
                delta={delta(metrics?.resolved)}
              />
              <MetricCard
                title={t('metrics.kpiResponseTime')}
                value={resp?.thisPeriodAvg != null ? t('metrics.minutesValue', { n: Math.round(resp.thisPeriodAvg) }) : '—'}
                icon={Clock}
                subtitle={
                  resp?.prevPeriodAvg != null
                    ? t('metrics.vsPrevValue', { v: t('metrics.minutesValue', { n: Math.round(resp.prevPeriodAvg) }) })
                    : undefined
                }
              />
            </Grid>
          </Section>

          {/* ── Mensajes ── */}
          <Section title={t('metrics.secMessages')}>
            <Grid>
              <MetricCard
                title={t('metrics.kpiReceived')}
                value={fmt.number(metrics?.messagesReceived.current ?? 0)}
                icon={Inbox}
                delta={delta(metrics?.messagesReceived)}
              />
              <MetricCard
                title={t('metrics.kpiSent')}
                value={fmt.number(metrics?.messagesSent.current ?? 0)}
                icon={Send}
                delta={delta(metrics?.messagesSent)}
              />
            </Grid>
          </Section>

          {/* ── Llamadas ── */}
          {voice && voice.total > 0 && (
            <Section title={t('metrics.secCalls')}>
              <Grid>
                <MetricCard
                  title={t('metrics.kpiCalls')}
                  value={fmt.number(voice.total)}
                  icon={PhoneCall}
                  subtitle={t('metrics.callsAnswered', { n: voice.answered })}
                />
                <MetricCard
                  title={t('metrics.kpiAnswered')}
                  value={`${voice.answered_pct}%`}
                  icon={PhoneIncoming}
                  subtitle={t('metrics.ofTotal')}
                />
                <MetricCard
                  title={t('metrics.kpiConfirmed')}
                  value={`${voice.confirmed_pct}%`}
                  icon={BadgeCheck}
                  subtitle={t('metrics.ofAnswered')}
                />
                <MetricCard
                  title={t('metrics.kpiMinutes')}
                  value={fmt.number(voice.minutes)}
                  icon={Timer}
                  subtitle={voice.cost ? money(voice.cost) : undefined}
                />
                {voice.upsell_revenue > 0 && (
                  <MetricCard
                    title={t('metrics.kpiUpsell')}
                    value={money(voice.upsell_revenue)}
                    icon={TrendingUp}
                  />
                )}
              </Grid>
            </Section>
          )}

          {/* ── Detalle de atribución (tablas) ── */}
          {!data?.not_connected && !data?.error && (
            <div className="space-y-4">
              <AttributionTable title={t('metrics.topCampaigns')} rows={data?.by_broadcast ?? []} icon={Megaphone} emptyLabel={t('metrics.emptyCampaigns')} />
              <AttributionTable title={t('metrics.topFlows')} rows={data?.by_flow ?? []} icon={Workflow} emptyLabel={t('metrics.emptyFlows')} />
              <AttributionTable title={t('metrics.topInstagramCampaigns')} rows={data?.by_instagram_agent ?? []} icon={InstagramIcon} emptyLabel={t('metrics.emptyInstagram')} />
              <AttributionTable title={t('metrics.topAutomations')} rows={data?.by_automation ?? []} icon={Zap} emptyLabel={t('metrics.emptyAutomations')} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </section>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}

function ConnectShopify({ t, full }: { t: ReturnType<typeof useT>; full?: boolean }) {
  return (
    <div className={`rounded-xl border border-dashed border-border bg-card/40 p-6 text-center ${full ? 'sm:p-8' : ''}`}>
      <ShoppingBag className="mx-auto size-8 text-muted-foreground" />
      <p className="mt-3 text-sm font-medium text-foreground">{t('metrics.connectShopifyTitle')}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t('metrics.connectShopifyDescription')}</p>
      <Link
        href="/integraciones"
        className="mt-4 inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-xs font-medium text-accent-ink transition-colors hover:bg-accent/90"
      >
        {t('metrics.connectShopifyCta')}
      </Link>
    </div>
  );
}

function ShopifyError({ t }: { t: ReturnType<typeof useT> }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
      <AlertCircle className="mt-0.5 size-4 text-amber-600 dark:text-amber-400" />
      <p className="text-amber-700 dark:text-amber-300">{t('metrics.shopifyReadError')}</p>
    </div>
  );
}

function AttributionTable({
  title,
  rows,
  icon: Icon,
  emptyLabel,
}: {
  title: string;
  rows: AttributionRow[];
  icon: IconType;
  emptyLabel: string;
}) {
  const t = useT();
  const fmt = useFormat();
  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Icon className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">{t('metrics.colName')}</th>
                <th className="px-4 py-2 text-right">{t('metrics.colOrders')}</th>
                <th className="px-4 py-2 text-right">{t('metrics.colRevenue')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border first:border-t-0">
                  <td className="px-4 py-2 text-foreground max-w-[160px] truncate sm:max-w-none">{r.name}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-foreground">{r.orders_count}</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-foreground">
                    {formatMoney(fmt, r.revenue, r.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function sumRevenue(rows?: AttributionRow[]): number {
  return rows?.reduce((s, r) => s + r.revenue, 0) ?? 0;
}

/** Build a MetricCard delta (up = good) from current/previous. Undefined when
 *  there's nothing to compare (both zero). */
function makeDelta(
  t: ReturnType<typeof useT>,
  current: number,
  previous: number,
): { sign: number; label: string } | undefined {
  if (!current && !previous) return undefined;
  const diff = current - previous;
  const sign = diff > 0 ? 1 : diff < 0 ? -1 : 0;
  const pct = previous > 0 ? Math.round((diff / previous) * 100) : current > 0 ? 100 : 0;
  const label = t('metrics.vsPrevValue', { v: `${pct > 0 ? '+' : ''}${pct}%` });
  return { sign, label };
}

function formatMoney(
  fmt: ReturnType<typeof useFormat>,
  amount: number,
  currency: string,
): string {
  try {
    return fmt.currency(amount, currency || 'USD', { maximumFractionDigits: 0 });
  } catch {
    return `${fmt.number(amount)} ${currency}`;
  }
}
