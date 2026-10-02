'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Locale } from '@/lib/i18n/config';
import { SHIPPING_COUNTRIES, shippingAddress, type OrderShippingAddress } from '@/lib/shopify/shipping-address-contract';
import { addressRequestReceipt, type AddressRequestReceipt } from '@/lib/channels/webchat/address-request-contract';
import { widgetOrderText } from '@/lib/channels/webchat/order-contract';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
const empty: OrderShippingAddress = { address1: '', address2: '', city: '', province: '', zip: '', countryCode: '' };
export function WidgetAddressRequest({ session, locale, orderId, onExpired }: { session: string; locale: Locale; orderId: string; onExpired: () => void }) {
  const [address, setAddress] = useState(empty), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null), [receipt, setReceipt] = useState<AddressRequestReceipt | null>(null);
  const attempt = useRef<{ key: string; id: string } | null>(null), controller = useRef<AbortController | null>(null);
  const expired = useRef(onExpired);
  const storageKey = `riverz-webchat-order-request:${orderId}`;
  const t = (key: string, vars?: Record<string, string | number>) => widgetOrderText(locale, key, vars);
  const countries = useMemo(() => { const names = new Intl.DisplayNames([locale], { type: 'region' });
    return SHIPPING_COUNTRIES.map(code => ({ code, name: names.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name, locale)); }, [locale]);
  useEffect(() => { expired.current = onExpired; }, [onExpired]);
  useEffect(() => {
    if (!SHOW_RIVERZ_IMPROVEMENTS) return () => controller.current?.abort();
    let id: string | null = null;
    try { id = sessionStorage.getItem(storageKey); } catch { /* Storage is optional. */ }
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return () => controller.current?.abort();
    const request = new AbortController(); controller.current = request; setBusy(true);
    void fetch(`/api/widget/order-address-requests?${new URLSearchParams({ id, locale })}`, { headers: { Authorization: `Bearer ${session}` }, cache: 'no-store', signal: request.signal })
      .then(async response => {
        if (response.status === 401) { expired.current(); return; }
        if (response.status === 404) { try { sessionStorage.removeItem(storageKey); } catch {} return; }
        if (!response.ok) throw new Error('unavailable');
        const parsed = addressRequestReceipt.safeParse(await response.json());
        if (!parsed.success || parsed.data.id !== id) throw new Error('unavailable');
        if (!request.signal.aborted) setReceipt(parsed.data);
      }).catch(() => { if (!request.signal.aborted) setError(widgetOrderText(locale, 'addressRequestError_unavailable')); })
      .finally(() => { if (!request.signal.aborted) setBusy(false); });
    return () => request.abort();
  }, [session, locale, storageKey]);
  async function send(refresh = false) {
    if (busy) return;
    const valid = shippingAddress(address); if (!refresh && (!valid || !confirmed)) return;
    if (!refresh) { const key = JSON.stringify([orderId, locale, valid]); if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() }; }
    const id = refresh ? receipt?.id ?? attempt.current?.id : attempt.current?.id; if (!id) return;
    controller.current?.abort(); const request = new AbortController(); controller.current = request; setBusy(true); setError(null);
    let failureText = t('addressRequestError_unavailable');
    try {
      const response = await fetch(refresh ? `/api/widget/order-address-requests?${new URLSearchParams({ id, locale })}` : '/api/widget/order-address-requests', {
        method: refresh ? 'GET' : 'POST', cache: 'no-store', signal: request.signal,
        headers: { Authorization: `Bearer ${session}`, ...(!refresh ? { 'Content-Type': 'application/json' } : {}) },
        ...(!refresh ? { body: JSON.stringify({ id, order_id: orderId, address: valid, confirmed: true, locale }) } : {}),
      });
      if (response.status === 401) { onExpired(); return; }
      const raw = await response.json(); if (!response.ok) { if (typeof raw.error === 'string') failureText = raw.error; throw new Error('unavailable'); }
      const parsed = addressRequestReceipt.safeParse(raw); if (!parsed.success || parsed.data.id !== id) throw new Error(t('addressRequestError_unavailable'));
      if (!request.signal.aborted) {
        setReceipt(parsed.data);
        try { sessionStorage.setItem(storageKey, parsed.data.id); } catch { /* No address or token is stored. */ }
      }
    } catch { if (!request.signal.aborted) setError(failureText); }
    finally { if (!request.signal.aborted) setBusy(false); }
  }
  if (!SHOW_RIVERZ_IMPROVEMENTS) return null;
  const submitted = receipt !== null && receipt.status !== 'not_submitted';
  return <div className="space-y-2">
    {!submitted ? <>
      {(['address1', 'address2', 'city', 'province', 'zip'] as const).map(field => <label className="block" key={field}>{t(`addressRequest_${field}`)}
        <input className="mt-1 block w-full rounded-lg border border-neutral-200 p-2" disabled={busy} value={address[field]} maxLength={field === 'zip' ? 32 : 255}
          onChange={event => { setAddress(previous => ({ ...previous, [field]: event.target.value })); setConfirmed(false); }} />
      </label>)}
      <label className="block">{t('addressRequest_countryCode')}<select className="mt-1 block w-full rounded-lg border border-neutral-200 p-2" disabled={busy} value={address.countryCode}
        onChange={event => { setAddress(previous => ({ ...previous, countryCode: event.target.value })); setConfirmed(false); }}>
        <option value="">—</option>{countries.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}
      </select></label>
      <label className="flex items-start gap-2"><input type="checkbox" disabled={busy} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{t('addressRequestConfirm')}</label>
      <p className="text-neutral-500">{t('addressRequestScope')}</p>
      <button type="button" className="rounded-lg bg-neutral-900 px-3 py-2 text-white disabled:opacity-50" disabled={busy || !confirmed || !shippingAddress(address)} onClick={() => void send()}>{t('addressRequestSend')}</button>
    </> : null}
    {receipt ? <p role="status">{t(`addressRequestStatus_${receipt.status}`, { date: receipt.confirmed_at ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(receipt.confirmed_at)) : '' })}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {receipt || attempt.current ? <button type="button" className="ml-2 underline disabled:opacity-50" disabled={busy} onClick={() => void send(true)}>{t('addressRequestRefresh')}</button> : null}
    {submitted ? <button type="button" className="ml-2 underline disabled:opacity-50" disabled={busy || receipt.status === 'processing'} onClick={() => {
      attempt.current = null; setReceipt(null); setAddress(empty); setConfirmed(false); setError(null);
      try { sessionStorage.removeItem(storageKey); } catch {}
    }}>{t('addressRequestAgain')}</button> : null}
  </div>;
}
