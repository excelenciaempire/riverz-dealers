'use client';
import { useEffect, useRef, useState } from 'react';
import { useLocale, useT } from '@/hooks/use-locale';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { caseAddressRequestPage } from '@/lib/channels/webchat/address-request-contract';
import type { z } from 'zod';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
type Page = z.infer<typeof caseAddressRequestPage>;
export function CustomerAddressRequests({ conversationId, orderId, onPrepared }: {
  conversationId: string; orderId: string; onPrepared: (operationId: string, requestId: string) => Promise<void>;
}) {
  const t = useT(), { locale } = useLocale(), csrf = useFetchWithCsrf();
  const [open, setOpen] = useState(false), [page, setPage] = useState<Page | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const attempts = useRef(new Map<string, string>());
  const endpoint = `/api/conversations/${conversationId}/orders/${orderId}/customer-address-requests`;
  useEffect(() => {
    if (!open) return; const controller = new AbortController();
    void fetch(endpoint, { cache: 'no-store', signal: controller.signal }).then(async response => {
      const raw = await response.json(); if (!response.ok) throw new Error(raw.error ?? t('webchat.addressRequestError_unavailable'));
      const value = caseAddressRequestPage.parse(raw);
      if (value.requests.some(request => request.order_id !== orderId || request.conversation_id !== conversationId)) throw new Error(t('webchat.addressRequestError_unavailable'));
      if (!controller.signal.aborted) { setPage(value); setError(null); }
    }).catch(() => { if (!controller.signal.aborted) setError(t('webchat.addressRequestError_unavailable')); });
    return () => controller.abort();
  }, [open, endpoint, orderId, conversationId, t]);
  async function prepare(requestId: string) {
    if (busy) return; setBusy(true); setError(null);
    let id = attempts.current.get(requestId); if (!id) { id = crypto.randomUUID(); attempts.current.set(requestId, id); }
    try {
      const response = await csrf(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, request_id: requestId }) });
      const raw = await response.json(); if (!response.ok) throw new Error(raw.error ?? t('webchat.addressRequestError_unavailable'));
      if (raw.operation_id !== id || raw.request_id !== requestId || raw.order_id !== orderId) throw new Error(t('webchat.addressRequestError_unavailable'));
      await onPrepared(id, requestId);
    } catch { setError(t('webchat.addressRequestError_unavailable')); }
    finally { setBusy(false); }
  }
  if (!SHOW_RIVERZ_IMPROVEMENTS) return null;
  return <details className="rounded-lg border p-3" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-medium">{t('webchat.addressRequestTeamTitle')}</summary>
    <div className="mt-3 space-y-3">
      {error ? <p role="alert">{error}</p> : null}
      {page?.requests.length === 0 ? <p>{t('webchat.addressRequestEmpty')}</p> : null}
      {page?.requests.map(request => <div key={request.id} className="space-y-2 break-words">
        <p>{request.reference} · {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(request.created_at))}</p>
        <p>{Object.values(request.address).filter(Boolean).join(', ')}</p>
        <button type="button" className="rounded-lg border px-3 py-2 disabled:opacity-50" disabled={busy} onClick={() => void prepare(request.id)}>{t('webchat.addressRequestPrepare')}</button>
      </div>)}
    </div>
  </details>;
}
