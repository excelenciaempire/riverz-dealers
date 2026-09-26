'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, PackageCheck } from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { KNOWN_CARRIER_NAMES } from '@/lib/shopify/carrier-tracking';
import type { MissingTrackingOrder } from '@/lib/logistics/missing-tracking';

/**
 * /logistica/sin-guia — pedidos que deberían tener guía y en Shopify no la
 * tienen. Se llega desde el aviso de Inicio. Cargar la guía acá dispara el
 * mismo aviso de despacho que habría salido si la app logística la hubiera
 * sincronizado.
 */
export default function PedidosSinGuiaPage() {
  const t = useT();
  const [orders, setOrders] = useState<MissingTrackingOrder[] | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/logistics/missing-tracking', { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        setOrders(json.orders ?? []);
      } catch {
        toast.error(t('logistics.missingLoadError'));
        setOrders([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const quitar = (id: string) => setOrders((prev) => (prev ?? []).filter((o) => o.id !== id));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('logistics.missingTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('logistics.missingSubtitle')}</p>
      </div>

      {orders === null ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-primary/15 text-accent-ink">
            <PackageCheck className="size-5" />
          </span>
          <p className="text-sm font-medium text-foreground">{t('logistics.missingEmpty')}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {orders.map((order) => (
            <OrderRow key={order.id} order={order} onDone={() => quitar(order.id)} />
          ))}
        </ul>
      )}

      <datalist id="transportadoras">
        {KNOWN_CARRIER_NAMES.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </div>
  );
}

function OrderRow({ order, onDone }: { order: MissingTrackingOrder; onDone: () => void }) {
  const t = useT();
  const fmt = useFormat();
  const fetchWithCsrf = useFetchWithCsrf();
  const [tracking, setTracking] = useState('');
  const [carrier, setCarrier] = useState('');
  const [busy, setBusy] = useState<'send' | 'dismiss' | null>(null);

  const enviar = async (body: Record<string, unknown>, action: 'send' | 'dismiss') => {
    setBusy(action);
    try {
      const res = await fetchWithCsrf('/api/logistics/missing-tracking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, ...body }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? t('logistics.missingError'));
        // Cancelado o ya con guía en Shopify: ya no es un pendiente.
        if (json.result === 'cancelled' || json.result === 'already_tracked') onDone();
        return;
      }
      toast.success(json.message);
      onDone();
    } catch {
      toast.error(t('logistics.missingError'));
    } finally {
      setBusy(null);
    }
  };

  const items = (order.line_items ?? [])
    .map((i) => `${i.quantity ?? 1}× ${i.title ?? ''}${i.variant_title ? ` (${i.variant_title})` : ''}`)
    .join(', ');
  const listo = tracking.trim().length >= 4 && carrier.trim().length >= 2;

  return (
    <li className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">
          {order.order_number ?? '—'} · {order.customer_name ?? '—'}
        </p>
        <p className="text-xs text-muted-foreground">
          {fmt.dateTime(order.created_at, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
      {items && <p className="text-xs text-muted-foreground">{items}</p>}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (listo) void enviar({ trackingNumber: tracking, carrier }, 'send');
        }}
      >
        <input
          value={tracking}
          onChange={(e) => setTracking(e.target.value)}
          placeholder={t('logistics.missingTracking')}
          aria-label={t('logistics.missingTracking')}
          inputMode="text"
          autoComplete="off"
          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm"
        />
        <input
          value={carrier}
          onChange={(e) => setCarrier(e.target.value)}
          placeholder={t('logistics.missingCarrier')}
          aria-label={t('logistics.missingCarrier')}
          list="transportadoras"
          autoComplete="off"
          className="h-9 w-44 rounded-md border border-border bg-background px-3 text-sm"
        />
        <button
          type="submit"
          disabled={!listo || busy !== null}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy === 'send' && <Loader2 className="size-3.5 animate-spin" />}
          {t('logistics.missingSend')}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void enviar({ dismiss: true }, 'dismiss')}
          className="h-9 rounded-md border border-border px-3 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {t('logistics.missingDismiss')}
        </button>
      </form>
    </li>
  );
}
