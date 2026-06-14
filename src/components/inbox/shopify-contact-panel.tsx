'use client';

import { useEffect, useState } from 'react';
import { ShoppingBag, ExternalLink, Package, Truck, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Panel Shopify contextual a la derecha del chat. Llama a
 * /api/shopify/customer con el email o teléfono del contacto y muestra:
 *   - Tarjeta "Cliente Shopify" con nombre, total gastado, # de órdenes.
 *   - Tags del cliente en Shopify (si los tiene).
 *   - Últimas 5 órdenes con fecha, total, estado de pago y de envío.
 *     Cada una con link al order status page que el merchant ya puede
 *     compartir con el cliente.
 *
 * Si la tienda no está conectada o el contacto no matchea con ningún
 * customer en Shopify, NO renderiza nada — el sidebar queda limpio.
 */

interface ShopifyResponse {
  connected: boolean;
  shop_domain?: string;
  customer?: {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    total_spent: string;
    orders_count: number;
    currency: string;
    tags: string;
    note: string;
  } | null;
  orders?: Array<{
    id: number;
    name: string;
    created_at: string;
    total_price: string;
    currency: string;
    financial_status: string;
    fulfillment_status: string;
    order_status_url: string;
  }>;
}

const FINANCIAL_LABEL: Record<string, string> = {
  paid: 'Pagado',
  pending: 'Pendiente',
  refunded: 'Reembolsado',
  partially_refunded: 'Reembolsado parcial',
  voided: 'Anulado',
  authorized: 'Autorizado',
};

const FULFILLMENT_LABEL: Record<string, string> = {
  fulfilled: 'Enviado',
  partial: 'Enviado parcial',
  restocked: 'Repuesto',
  '': 'Sin enviar',
};

export function ShopifyContactPanel({
  contactEmail,
  contactPhone,
}: {
  contactEmail: string | null;
  contactPhone: string | null;
}) {
  const [data, setData] = useState<ShopifyResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!contactEmail && !contactPhone) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (contactEmail) params.set('email', contactEmail);
    if (contactPhone) params.set('phone', contactPhone);
    fetch(`/api/shopify/customer?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((res: ShopifyResponse | null) => {
        if (!cancelled) {
          setData(res);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [contactEmail, contactPhone]);

  // Casos "no renderizar nada": no hay datos identificables, la
  // tienda no está conectada, o el cliente no matchea.
  if (loading) return null;
  if (!data?.connected || !data.customer) return null;

  const c = data.customer;
  const fullName =
    `${c.first_name} ${c.last_name}`.trim() || c.email || 'Cliente Shopify';
  const totalSpent = formatMoney(c.total_spent, c.currency);
  const orders = data.orders ?? [];

  return (
    <>
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-emerald-500/20">
              <ShoppingBag className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                Cliente Shopify
              </p>
              <p className="text-sm font-medium text-foreground">{fullName}</p>
            </div>
          </div>
          {data.shop_domain && (
            <a
              href={`https://${data.shop_domain}/admin/customers/${c.id}`}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground"
              title="Ver en Shopify"
              aria-label="Ver en Shopify"
            >
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-md bg-card/60 p-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Total comprado
            </p>
            <p className="mt-0.5 text-sm font-semibold text-foreground">
              {totalSpent}
            </p>
          </div>
          <div className="rounded-md bg-card/60 p-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Pedidos
            </p>
            <p className="mt-0.5 text-sm font-semibold text-foreground">
              {c.orders_count}
            </p>
          </div>
        </div>
        {c.tags && (
          <div className="mt-2 flex flex-wrap gap-1">
            {c.tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
              .slice(0, 4)
              .map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300"
                >
                  {t}
                </span>
              ))}
          </div>
        )}
      </div>

      {orders.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <Package className="h-3 w-3" />
            Últimos pedidos
          </div>
          <ul className="mt-2 space-y-1.5">
            {orders.map((o) => {
              const date = new Date(o.created_at);
              const fulfillmentTone =
                o.fulfillment_status === 'fulfilled'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-muted-foreground';
              return (
                <li
                  key={o.id}
                  className="rounded-md border border-border bg-card p-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-foreground">
                          {o.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {date.toLocaleDateString('es-ES', {
                            day: '2-digit',
                            month: 'short',
                          })}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[10px]">
                        <span
                          className={cn(
                            'inline-flex items-center gap-0.5',
                            o.financial_status === 'paid'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-amber-600 dark:text-amber-400',
                          )}
                        >
                          {o.financial_status === 'paid' && (
                            <Check className="size-2.5" />
                          )}
                          {FINANCIAL_LABEL[o.financial_status] ??
                            o.financial_status}
                        </span>
                        <span className="text-muted-foreground">·</span>
                        <span className={cn('inline-flex items-center gap-0.5', fulfillmentTone)}>
                          {o.fulfillment_status === 'fulfilled' && (
                            <Truck className="size-2.5" />
                          )}
                          {FULFILLMENT_LABEL[o.fulfillment_status] ??
                            o.fulfillment_status ??
                            'Sin enviar'}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold text-foreground">
                        {formatMoney(o.total_price, o.currency)}
                      </p>
                      {o.order_status_url && (
                        <a
                          href={o.order_status_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-muted-foreground hover:text-foreground"
                        >
                          Ver pedido
                        </a>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="my-4 border-t border-border" />
    </>
  );
}

function formatMoney(amount: string | number | undefined, currency: string): string {
  const num = typeof amount === 'string' ? Number(amount) : amount ?? 0;
  if (!isFinite(num)) return `${amount ?? ''}`;
  try {
    return new Intl.NumberFormat('es', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(num);
  } catch {
    return `${num.toLocaleString('es')} ${currency}`;
  }
}
