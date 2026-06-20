'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Receipt, ExternalLink } from 'lucide-react';

/**
 * /pedidos — pedidos que el asistente IA creó en Shopify (tabla `orders`,
 * migración 080). Solo lectura: los pedidos los crea el runner (tool
 * create_order) cuando un agente con "Cierre de ventas" activo cierra una
 * compra en el chat. El estado de pago/envío se reconcilia vía el webhook
 * de Shopify.
 */

interface OrderLine {
  title: string;
  quantity: number;
  price: number | null;
}

interface OrderRow {
  id: string;
  created_at: string;
  order_number: string | null;
  order_status_url: string | null;
  currency: string | null;
  total_price: number | null;
  line_items: OrderLine[] | null;
  customer_name: string | null;
  customer_phone: string | null;
  payment_method: string | null;
  financial_status: string | null;
  fulfillment_status: string | null;
  status: string;
  channel: string | null;
}

export default function PedidosPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/orders', { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Error');
        setOrders(json.orders ?? []);
      } catch {
        toast.error('No se pudieron cargar los pedidos.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Pedidos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pedidos que el asistente cerró con tus clientes en el chat.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Receipt className="size-5" />
          </span>
          <div>
            <p className="text-sm font-medium text-foreground">Todavía no hay pedidos</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Cuando un asistente con &quot;Cierre de ventas&quot; activo cierre una
              compra, el pedido aparecerá aquí y en Shopify.
            </p>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Pedido</th>
                <th className="px-4 py-2.5 font-medium">Cliente</th>
                <th className="px-4 py-2.5 font-medium">Productos</th>
                <th className="px-4 py-2.5 font-medium">Total</th>
                <th className="px-4 py-2.5 font-medium">Pago</th>
                <th className="px-4 py-2.5 font-medium">Estado</th>
                <th className="px-4 py-2.5 font-medium">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr
                  key={o.id}
                  className="border-b border-border/60 last:border-0 hover:bg-muted/40"
                >
                  <td className="px-4 py-3 font-medium text-foreground">
                    {o.order_status_url ? (
                      <a
                        href={o.order_status_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-foreground hover:text-primary"
                      >
                        {o.order_number ?? '—'}
                        <ExternalLink className="size-3 text-muted-foreground" />
                      </a>
                    ) : (
                      (o.order_number ?? '—')
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-foreground">{o.customer_name ?? '—'}</div>
                    {o.customer_phone && (
                      <div className="text-xs text-muted-foreground">
                        {o.customer_phone}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {summarizeItems(o.line_items)}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-foreground">
                    {formatMoney(o.total_price, o.currency)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatPayment(o.payment_method)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge order={o} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDate(o.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function summarizeItems(items: OrderLine[] | null): string {
  if (!items || items.length === 0) return '—';
  return items.map((i) => `${i.quantity}× ${i.title}`).join(', ');
}

function formatMoney(n: number | null, currency: string | null): string {
  if (n == null) return '—';
  const cur = (currency || 'ARS').toUpperCase();
  if (cur === 'ARS') {
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: cur,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${cur} ${n}`;
  }
}

function formatPayment(method: string | null): string {
  if (method === 'transfer') return 'Transferencia';
  if (method === 'card_or_mp') return 'Tarjeta / MP';
  return method ?? '—';
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function StatusBadge({ order }: { order: OrderRow }) {
  // Preferimos el estado financiero de Shopify; si está pagado o cumplido
  // lo marcamos en verde, pendiente en ámbar, fallido/cancelado en rojo.
  const fin = (order.financial_status ?? '').toLowerCase();
  const fulfilled = (order.fulfillment_status ?? '').toLowerCase() === 'fulfilled';
  let label: string;
  let tone: 'green' | 'amber' | 'red' | 'gray';
  if (order.status === 'cancelled' || order.status === 'failed') {
    label = order.status === 'cancelled' ? 'Cancelado' : 'Falló';
    tone = 'red';
  } else if (fulfilled) {
    label = 'Enviado';
    tone = 'green';
  } else if (fin === 'paid') {
    label = 'Pagado';
    tone = 'green';
  } else if (fin === 'pending' || !fin) {
    label = 'Pendiente de pago';
    tone = 'amber';
  } else {
    label = fin;
    tone = 'gray';
  }
  const cls = {
    green:
      'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    amber:
      'border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    red: 'border-red-600/30 bg-red-500/10 text-red-700 dark:text-red-400',
    gray: 'border-border bg-muted text-muted-foreground',
  }[tone];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {label}
    </span>
  );
}
