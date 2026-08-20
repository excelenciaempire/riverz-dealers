'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Contact, ContactPurchase, ContactPurchaseSummary } from '@/types';
import { loadContactPurchases, summarizePurchases } from '@/lib/contacts/purchases';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import type { TFn } from '@/lib/i18n/translate';
import { Loader2, ShoppingBag } from 'lucide-react';

/**
 * Qué compró este contacto.
 *
 * Dos fuentes que no dicen lo mismo, y la ficha muestra las dos sin
 * disimular la diferencia:
 *
 *   * El resumen de la tienda (`contacts.shopify_customer_data`) sabe cuántos
 *     pedidos hizo el cliente EN TODA SU VIDA y cuánto gastó, pero no cuáles.
 *   * `contact_purchases` tiene el detalle de cada pedido, y empieza donde
 *     empieza lo que la tienda dejó leer — sin el permiso `read_all_orders`,
 *     Shopify entrega apenas los últimos 60 días.
 *
 * Cuando el primero cuenta más pedidos que los que el segundo puede detallar,
 * se dice: "3 pedidos más sin detalle". Es la diferencia entre "este cliente
 * compró una sola vez" y "de este cliente vemos una sola compra", que es
 * justo lo que un comercio necesita distinguir antes de concluir que nadie
 * recompra.
 */
export function ContactPurchasesPanel({ contact }: { contact: Contact }) {
  const supabase = createClient();
  const t = useT();
  const fmt = useFormat();

  const [purchases, setPurchases] = useState<ContactPurchase[] | null>(null);
  const [historySince, setHistorySince] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await loadContactPurchases(supabase, contact.id);
      if (!cancelled) setPurchases(rows);

      const workspaceId = (contact as unknown as { workspace_id?: string }).workspace_id;
      if (!workspaceId) return;
      const { data } = await supabase
        .from('shopify_connections')
        .select('purchase_history_since')
        .eq('workspace_id', workspaceId)
        .not('purchase_history_since', 'is', null)
        .order('purchase_history_since', { ascending: true })
        .limit(1)
        .maybeSingle();
      const since = (data as { purchase_history_since: string | null } | null)
        ?.purchase_history_since;
      if (!cancelled && since) setHistorySince(since);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, contact]);

  if (purchases == null) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const snap = contact.shopify_customer_data ?? null;
  const summary = summarizePurchases(purchases, {
    ordersCount: snap?.orders_count ?? null,
    totalSpent: snap?.total_spent ?? null,
    currency: snap?.currency ?? null,
  });

  if (summary.ordersCount === 0 && purchases.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <ShoppingBag className="size-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t('contacts.buyNever')}</p>
      </div>
    );
  }

  const dateOpts: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  };
  const money = (v: number) => fmt.currency(v, summary.currency ?? undefined);

  return (
    <div className="space-y-4">
      <Headline summary={summary} t={t} />

      <div className="grid grid-cols-3 gap-2">
        <Stat label={t('contacts.shopOrders')} value={String(summary.ordersCount)} />
        <Stat
          label={t('contacts.shopTotalSpent')}
          value={summary.totalSpent > 0 ? money(summary.totalSpent) : '—'}
        />
        <Stat
          label={t('contacts.buyAverage')}
          value={summary.averageOrder ? money(summary.averageOrder) : '—'}
        />
      </div>

      {(summary.lastPurchaseAt || summary.firstPurchaseAt) && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          {summary.lastPurchaseAt && (
            <div>
              <dt className="text-muted-foreground">{t('contacts.buyLast')}</dt>
              <dd className="text-foreground">
                {fmt.date(summary.lastPurchaseAt, dateOpts)}
                {summary.daysSinceLast != null && (
                  <span className="text-muted-foreground">
                    {' · '}
                    {summary.daysSinceLast === 0
                      ? t('contacts.buyToday')
                      : t('contacts.buyDaysAgo', { n: summary.daysSinceLast })}
                  </span>
                )}
              </dd>
            </div>
          )}
          {summary.firstPurchaseAt && (
            <div>
              <dt className="text-muted-foreground">{t('contacts.buyFirst')}</dt>
              <dd className="text-foreground">
                {fmt.date(summary.firstPurchaseAt, dateOpts)}
              </dd>
            </div>
          )}
        </dl>
      )}

      {summary.topProducts.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            {t('contacts.buyTopProducts')}
          </p>
          <ul className="space-y-1">
            {summary.topProducts.map((p) => (
              <li key={p.title} className="flex justify-between gap-3 text-xs">
                <span className="truncate text-foreground">{p.title}</span>
                <span className="shrink-0 text-muted-foreground">
                  {t('contacts.buyUnits', { n: p.quantity })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {purchases.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            {t('contacts.buyHistory')}
          </p>
          <ul className="divide-y divide-border/60 rounded-lg border border-border">
            {purchases.map((p) => {
              const total = Number(p.total);
              const items = (p.line_items ?? [])
                .map((li) => li.title)
                .filter(Boolean)
                .join(', ');
              return (
                <li key={p.id} className="space-y-0.5 p-2.5">
                  <div className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="font-medium text-foreground">
                      {p.order_number || `#${p.external_id}`}
                    </span>
                    <span className="shrink-0 text-foreground">
                      {Number.isFinite(total) && total > 0
                        ? fmt.currency(total, p.currency ?? summary.currency ?? undefined)
                        : '—'}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
                    <span className="truncate">{items || '—'}</span>
                    {p.placed_at && (
                      <span className="shrink-0">{fmt.date(p.placed_at, dateOpts)}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {(summary.missingDetail > 0 || historySince) && (
        <p className="text-xs text-muted-foreground">
          {[
            summary.missingDetail > 0
              ? t('contacts.buyMissingDetail', { n: summary.missingDetail })
              : null,
            historySince
              ? t('contacts.buyHistorySince', {
                  date: fmt.date(historySince, { month: 'short', year: 'numeric' }),
                })
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
    </div>
  );
}

/** Una línea que dice qué clase de cliente es, sin obligar a leer números. */
function Headline({
  summary,
  t,
}: {
  summary: ContactPurchaseSummary;
  t: TFn;
}) {
  const label = summary.isRepeat
    ? t('contacts.buyRepeat')
    : summary.ordersCount === 1
      ? t('contacts.buyOnce')
      : t('contacts.buyNever');
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
      <ShoppingBag className="size-3.5" />
      {label}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}
