'use client';

import { useEffect, useState } from 'react';
import { Loader2, Send, CheckCheck, Eye, MousePointerClick, ShoppingCart } from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';

interface AnalyticsResponse {
  hasButtons: boolean;
  metaOk: boolean;
  metrics: { sent: number; delivered: number; read: number; clicked: number };
  cart: {
    recovered: number;
    revenue: number;
    buyers: Array<{ name: string; amount: number; at: string | null }>;
  } | null;
}

/**
 * Métricas de una plantilla, bajo la vista previa. Enviados / entregados /
 * leídos siempre; clics + CTR solo si la plantilla tiene botón; conversión de
 * carrito solo si es una plantilla de recuperación. Datos de la Template
 * Analytics API de Meta (últimos 30 días) + shopify_checkouts.
 */
export function TemplateMetrics({ templateId }: { templateId: string }) {
  const t = useT();
  const fmt = useFormat();
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/whatsapp/templates/${templateId}/analytics`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled) setData(j as AnalyticsResponse | null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">{t('templates.metricsTitle')}</h2>
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('templates.metricsLoading')}
        </div>
      ) : !data || !data.metaOk ? (
        <p className="py-4 text-sm text-muted-foreground">{t('templates.metricsUnavailable')}</p>
      ) : (
        <>
          <p className="mb-3 text-xs text-muted-foreground">{t('templates.metricsPeriod')}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Tile icon={Send} label={t('templates.metricSent')} value={fmt.number(data.metrics.sent)} />
            <Tile
              icon={CheckCheck}
              label={t('templates.metricDelivered')}
              value={fmt.number(data.metrics.delivered)}
              sub={pct(data.metrics.delivered, data.metrics.sent)}
            />
            <Tile
              icon={Eye}
              label={t('templates.metricRead')}
              value={fmt.number(data.metrics.read)}
              sub={pct(data.metrics.read, data.metrics.delivered)}
            />
            {/* Clics + CTR solo si la plantilla tiene botón */}
            {data.hasButtons && (
              <Tile
                icon={MousePointerClick}
                label={t('templates.metricClicks')}
                value={fmt.number(data.metrics.clicked)}
                sub={t('templates.metricCtr', { pct: pct(data.metrics.clicked, data.metrics.delivered) })}
              />
            )}
          </div>

          {/* Conversión de carrito abandonado */}
          {data.cart && (
            <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                <ShoppingCart className="h-3.5 w-3.5" />
                {t('templates.metricCartTitle')}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Tile
                  label={t('templates.metricCartRecovered')}
                  value={fmt.number(data.cart.recovered)}
                />
                <Tile
                  label={t('templates.metricCartRevenue')}
                  value={`$${fmt.number(Math.round(data.cart.revenue))}`}
                />
              </div>

              {/* Quiénes compraron después de recibir el mensaje */}
              {data.cart.buyers.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs text-muted-foreground">
                    {t('templates.metricCartBuyers')}
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {data.cart.buyers.map((b, i) => (
                      <li
                        key={`${b.name}-${i}`}
                        className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/40 px-2.5 py-1.5 text-xs"
                      >
                        <span className="truncate text-foreground">
                          {b.name || t('templates.metricCartBuyerUnknown')}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          ${fmt.number(Math.round(b.amount))}
                          {b.at && (
                            <span className="ml-2">
                              {fmt.date(b.at, { day: '2-digit', month: 'short' })}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </div>
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
