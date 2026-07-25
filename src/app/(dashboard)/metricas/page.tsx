'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import Link from '@/components/i18n/locale-link';
import {
  Megaphone,
  Workflow,
  Loader2,
  ShoppingBag,
  AlertCircle,
  Zap,
} from 'lucide-react';
import { InstagramIcon } from '@/components/layout/instagram-icon';
import { VoiceAnalytics } from '@/components/voice/voice-analytics';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { useTimezone } from '@/hooks/use-timezone';
import { rangeForPreset, type RangePreset } from '@/lib/dashboard/date-utils';
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

interface AttributionResponse {
  days: number;
  by_broadcast: AttributionRow[];
  by_flow: AttributionRow[];
  by_automation: AttributionRow[];
  by_instagram_agent: AttributionRow[];
  not_connected?: boolean;
  error?: string;
}

export default function MetricasPage() {
  const t = useT();
  const fmt = useFormat();
  const tz = useTimezone();
  const [preset, setPreset] = useState<RangePreset>('30d');
  const [custom, setCustom] = useState<CustomRange | null>(null);
  const [data, setData] = useState<AttributionResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const presetRef = useRef(preset);
  const customRef = useRef(custom);
  const tzRef = useRef(tz);

  // Out-of-order guard: a slower earlier request can't overwrite a newer one.
  const reqEpoch = useRef(0);

  const load = useCallback(() => {
    const range = rangeForPreset(tzRef.current, presetRef.current, customRef.current);
    const epoch = ++reqEpoch.current;
    const qs = `start=${encodeURIComponent(range.start.toISOString())}&end=${encodeURIComponent(range.end.toISOString())}`;
    return fetch(`/api/analytics/attribution?${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (epoch === reqEpoch.current && d) setData(d);
      })
      .catch(() => {})
      .finally(() => {
        if (epoch === reqEpoch.current) setLoading(false);
      });
  }, []);

  // Initial load + reload when the workspace tz resolves/changes. State is
  // written only in async callbacks, so this is safe to call from an effect.
  useEffect(() => {
    tzRef.current = tz;
    load();
  }, [tz, load]);

  // Auto-refresh every 60s + on tab focus (attribution is Shopify-driven, no
  // realtime table to subscribe to). Silent — no spinner flash.
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

  const totalBroadcastRevenue =
    data?.by_broadcast?.reduce((s, r) => s + r.revenue, 0) ?? 0;
  const totalFlowRevenue =
    data?.by_flow?.reduce((s, r) => s + r.revenue, 0) ?? 0;
  const totalAutomationRevenue =
    data?.by_automation?.reduce((s, r) => s + r.revenue, 0) ?? 0;
  const totalInstagramRevenue =
    data?.by_instagram_agent?.reduce((s, r) => s + r.revenue, 0) ?? 0;
  const currency =
    data?.by_broadcast?.[0]?.currency ??
    data?.by_flow?.[0]?.currency ??
    data?.by_instagram_agent?.[0]?.currency ??
    data?.by_automation?.[0]?.currency ??
    'USD';

  // Same range the attribution query uses — passed to the voice panel so it
  // follows the page's date filter. Memoized on the filter (not every render)
  // so a live `end` (e.g. preset "30d") doesn't retrigger the panel's fetch.
  const voiceRange = useMemo(
    () => rangeForPreset(tz, preset, custom),
    [tz, preset, custom],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="app-page-title">{t('metrics.title')}</h1>
        </div>
        <DateRangeFilter tz={tz} preset={preset} custom={custom} onChange={handleFilterChange} />
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : data?.not_connected ? (
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-6 sm:p-8 text-center">
          <ShoppingBag className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium text-foreground">
            {t('metrics.connectShopifyTitle')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('metrics.connectShopifyDescription')}
          </p>
          <Link
            href="/integraciones"
            className="mt-4 inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-xs font-medium text-accent-ink transition-colors hover:bg-accent/90"
          >
            {t('metrics.connectShopifyCta')}
          </Link>
        </div>
      ) : data?.error ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
          <AlertCircle className="mt-0.5 size-4 text-amber-600 dark:text-amber-400" />
          <p className="text-amber-700 dark:text-amber-300">
            {t('metrics.shopifyReadError')}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              icon={Megaphone}
              label={t('metrics.cardCampaigns')}
              value={formatMoney(fmt, totalBroadcastRevenue, currency)}
              sub={t('metrics.withSales', { n: data?.by_broadcast?.length ?? 0 })}
            />
            <SummaryCard
              icon={Workflow}
              label={t('metrics.cardFlows')}
              value={formatMoney(fmt, totalFlowRevenue, currency)}
              sub={t('metrics.withSales', { n: data?.by_flow?.length ?? 0 })}
            />
            <SummaryCard
              icon={InstagramIcon}
              label={t('metrics.cardInstagramAgent')}
              value={formatMoney(fmt, totalInstagramRevenue, currency)}
              sub={t('metrics.withSales', { n: data?.by_instagram_agent?.length ?? 0 })}
            />
            <SummaryCard
              icon={Zap}
              label={t('metrics.cardAutomations')}
              value={formatMoney(fmt, totalAutomationRevenue, currency)}
              sub={t('metrics.withSales', { n: data?.by_automation?.length ?? 0 })}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            {t('metrics.attributionNote')}
          </p>

          <AttributionTable
            title={t('metrics.topCampaigns')}
            rows={data?.by_broadcast ?? []}
            icon={Megaphone}
            emptyLabel={t('metrics.emptyCampaigns')}
          />
          <AttributionTable
            title={t('metrics.topFlows')}
            rows={data?.by_flow ?? []}
            icon={Workflow}
            emptyLabel={t('metrics.emptyFlows')}
          />
          <AttributionTable
            title={t('metrics.topInstagramCampaigns')}
            rows={data?.by_instagram_agent ?? []}
            icon={InstagramIcon}
            emptyLabel={t('metrics.emptyInstagram')}
          />
          <AttributionTable
            title={t('metrics.topAutomations')}
            rows={data?.by_automation ?? []}
            icon={Zap}
            emptyLabel={t('metrics.emptyAutomations')}
          />
        </>
      )}

      {/* Voice AI calls — self-hides when there are no calls yet. Shown
          regardless of Shopify (voice works without a store). Follows the
          same date range as the rest of the page. */}
      <VoiceAnalytics
        start={voiceRange.start.toISOString()}
        end={voiceRange.end.toISOString()}
      />
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: IconType;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10">
          <Icon className="size-4 text-accent-ink" />
        </div>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
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
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          {emptyLabel}
        </p>
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
                  <td className="px-4 py-2 text-right tabular-nums text-foreground">
                    {r.orders_count}
                  </td>
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
