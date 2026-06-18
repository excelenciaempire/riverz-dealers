'use client';

import { useEffect, useState, type ComponentType } from 'react';
import Link from 'next/link';
import {
  Megaphone,
  Workflow,
  Loader2,
  ShoppingBag,
  AlertCircle,
  Zap,
} from 'lucide-react';
import { InstagramIcon } from '@/components/layout/instagram-icon';
import { cn } from '@/lib/utils';

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

type Range = 7 | 30 | 90;

export default function MetricasPage() {
  const [days, setDays] = useState<Range>(30);
  const [data, setData] = useState<AttributionResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/analytics/attribution?days=${days}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch(() => setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [days]);

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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="app-eyebrow">Análisis</p>
          <h1 className="app-page-title mt-1.5">Métricas y atribución</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Revenue de Shopify atribuido a campañas y flujos en los últimos
            días.
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
          {[7, 30, 90].map((r) => (
            <button
              key={r}
              onClick={() => setDays(r as Range)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs transition-colors',
                days === r
                  ? 'bg-accent text-accent-ink'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {r} días
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : data?.not_connected ? (
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center">
          <ShoppingBag className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium text-foreground">
            Conecta Shopify para ver atribución
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Sin Shopify no podemos cruzar las órdenes con tus campañas y flujos.
          </p>
          <Link
            href="/integraciones"
            className="mt-4 inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-xs font-medium text-accent-ink transition-colors hover:bg-accent/90"
          >
            Conectar Shopify
          </Link>
        </div>
      ) : data?.error ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
          <AlertCircle className="mt-0.5 size-4 text-amber-600 dark:text-amber-400" />
          <p className="text-amber-700 dark:text-amber-300">
            No se pudieron leer las órdenes de Shopify ahora. Intenta de
            nuevo en un rato.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              icon={Megaphone}
              label="Campañas"
              value={formatMoney(totalBroadcastRevenue, currency)}
              sub={`${data?.by_broadcast?.length ?? 0} con ventas`}
            />
            <SummaryCard
              icon={Workflow}
              label="Flujos"
              value={formatMoney(totalFlowRevenue, currency)}
              sub={`${data?.by_flow?.length ?? 0} con ventas`}
            />
            <SummaryCard
              icon={InstagramIcon}
              label="Agente de Instagram"
              value={formatMoney(totalInstagramRevenue, currency)}
              sub={`${data?.by_instagram_agent?.length ?? 0} con ventas`}
            />
            <SummaryCard
              icon={Zap}
              label="Automatizaciones"
              value={formatMoney(totalAutomationRevenue, currency)}
              sub={`${data?.by_automation?.length ?? 0} con ventas`}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Cada lente atribuye por separado (último toque, 24h antes de la
            orden). Una misma venta puede contar en más de una, así que no las
            sumes como total.
          </p>

          <AttributionTable
            title="Top campañas"
            rows={data?.by_broadcast ?? []}
            icon={Megaphone}
            emptyLabel="Sin campañas con revenue atribuible en este rango."
          />
          <AttributionTable
            title="Top flujos"
            rows={data?.by_flow ?? []}
            icon={Workflow}
            emptyLabel="Sin flujos con revenue atribuible en este rango."
          />
          <AttributionTable
            title="Top campañas de Instagram"
            rows={data?.by_instagram_agent ?? []}
            icon={InstagramIcon}
            emptyLabel="Sin ventas atribuidas al Agente de Instagram en este rango."
          />
          <AttributionTable
            title="Top automatizaciones"
            rows={data?.by_automation ?? []}
            icon={Zap}
            emptyLabel="Sin automatizaciones con revenue atribuible en este rango."
          />
        </>
      )}
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
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">Nombre</th>
              <th className="px-4 py-2 text-right">Órdenes</th>
              <th className="px-4 py-2 text-right">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border first:border-t-0">
                <td className="px-4 py-2 text-foreground">{r.name}</td>
                <td className="px-4 py-2 text-right tabular-nums text-foreground">
                  {r.orders_count}
                </td>
                <td className="px-4 py-2 text-right font-semibold tabular-nums text-foreground">
                  {formatMoney(r.revenue, r.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('es', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString('es')} ${currency}`;
  }
}
