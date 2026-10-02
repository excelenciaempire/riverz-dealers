'use client';

import { useEffect, useRef, useState } from 'react';
import type { Locale } from '@/lib/i18n/config';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { orderRequestAction, visitorOrderPage, widgetOrderRequest, widgetOrderText, type OrderRequestAction, type VisitorOrder } from '@/lib/channels/webchat/order-contract';
import { WidgetAddressRequest } from './address-request';

export function OrderRequests({ session, locale, onSend, onExpired }: {
  session: string; locale: Locale; onSend: (text: string) => Promise<boolean>; onExpired: () => void;
}) {
  const [orders, setOrders] = useState<VisitorOrder[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<VisitorOrder | null>(null);
  const [action, setAction] = useState<OrderRequestAction>('confirm');
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const lastCursor = useRef<string | undefined>(undefined);
  const t = (key: string) => widgetOrderText(locale, key);
  useEffect(() => () => controller.current?.abort(), []);

  async function load(cursor?: string) {
    if (loading) return;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    lastCursor.current = cursor;
    setLoading(true); setError(false);
    try {
      const params = new URLSearchParams({ locale, ...(cursor ? { cursor } : {}) });
      const res = await fetch(`/api/widget/orders?${params}`, { headers: { Authorization: `Bearer ${session}` }, cache: 'no-store', signal: request.signal });
      if (res.status === 401) { onExpired(); return; }
      if (!res.ok) throw new Error('unavailable');
      const page = visitorOrderPage.parse(await res.json());
      if (request.signal.aborted) return;
      setOrders(previous => cursor ? [...new Map([...(previous ?? []), ...page.orders].map(order => [order.id, order])).values()] : page.orders);
      setNext(page.next_cursor);
    } catch { if (!request.signal.aborted) setError(true); }
    finally { if (!request.signal.aborted) setLoading(false); }
  }

  if (!SHOW_RIVERZ_IMPROVEMENTS) return null;
  return <details className="mb-3 rounded-xl border border-neutral-200 p-3" onToggle={event => { if (!event.currentTarget.open) { controller.current?.abort(); setLoading(false); setSelected(null); } }}>
    <summary className="cursor-pointer text-sm font-medium" onClick={event => { if (!event.currentTarget.parentElement?.hasAttribute('open') && !loading) { setSelected(null); setDetails(''); void load(); } }}>{t('ordersTitle')}</summary>
    <div className="mt-3 space-y-2 text-sm">
      {loading ? <p role="status" className="text-neutral-500">{t('ordersLoading')}</p> : null}
      {error ? <button type="button" className="text-left text-neutral-600 underline" onClick={() => void load(lastCursor.current)}>{t('orderUnavailable')}</button> : null}
      {orders?.length === 0 && !error ? <p className="text-neutral-500">{t('ordersEmpty')}</p> : null}
      {orders?.map(order => <button key={order.id} type="button" disabled={sending} className="block w-full rounded-lg border border-neutral-200 px-3 py-2 text-left hover:bg-neutral-50 disabled:opacity-50" onClick={() => { setSelected(order); setAction('confirm'); setDetails(''); }}>{order.reference}</button>)}
      {next && !error ? <button type="button" disabled={loading} className="underline disabled:opacity-50" onClick={() => void load(next)}>{t('ordersMore')}</button> : null}
      {selected ? <form className="space-y-2 border-t border-neutral-200 pt-3" onSubmit={async event => {
        event.preventDefault(); if (sending || action === 'address') return;
        const text = widgetOrderRequest(locale, selected, action, details); if (!text) return;
        setSending(true);
        try { if (await onSend(text)) { setSelected(null); setDetails(''); } }
        finally { setSending(false); }
      }}>
        <p className="font-medium">{selected.reference}</p>
        <label className="block">{t('orderAction')}
          <select className="mt-1 block w-full rounded-lg border border-neutral-200 p-2" disabled={sending} value={action} onChange={event => { const value = orderRequestAction.parse(event.target.value); setAction(value); setDetails(''); }}>
            {orderRequestAction.options.map(value => <option key={value} value={value}>{t(`orderAction_${value}`)}</option>)}
          </select>
        </label>
        {action === 'address' ? <WidgetAddressRequest key={selected.id} session={session} locale={locale} orderId={selected.id} onExpired={onExpired} /> : null}
        {action !== 'confirm' && action !== 'address' ? <label className="block">{t(`orderDetails_${action}`)}
          <textarea className="mt-1 block w-full resize-none rounded-lg border border-neutral-200 p-2" rows={3} required maxLength={600} disabled={sending} value={details} onChange={event => setDetails(event.target.value)} />
        </label> : null}
        {action !== 'address' ? <button type="submit" disabled={sending || (action !== 'confirm' && !details.trim())} className="rounded-lg bg-neutral-900 px-3 py-2 text-white disabled:opacity-50">{t('orderSendRequest')}</button> : null}
      </form> : null}
    </div>
  </details>;
}
