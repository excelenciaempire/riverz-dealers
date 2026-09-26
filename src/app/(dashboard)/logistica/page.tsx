import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { resolveWorkspaceId } from '@/lib/instagram-agent/workspace';
import { readLogisticsReview } from '@/lib/integrations/logistics-read';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { formatDateTime } from '@/lib/i18n/format';
import Link from '@/components/i18n/locale-link';

export const dynamic = 'force-dynamic';
export default async function LogisticsPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const locale = await getLocale();
  const t = (key: string) => translate(locale, `logistics.${key}`);
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return <p className="p-6">{t('unauthorized')}</p>;
  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceId(client, user.id);
  if (!workspaceId) return <p className="p-6">{t('noOrders')}</p>;
  let report;
  try { report = await readLogisticsReview(admin, workspaceId, locale, (await searchParams).cursor); }
  catch { return <p className="p-6">{t('error')}</p>; }
  return <main className="mx-auto max-w-5xl space-y-6 p-6">
    <header className="flex items-center justify-between gap-4">
      <div><h1 className="text-2xl font-semibold">{t('title')}</h1><p className="text-sm text-muted-foreground">{t('draft')}</p></div>
      <div className="flex gap-2">
        <Link href="/logistica/sin-guia" className="rounded-md border px-4 py-2 text-sm" prefetch={false}>{t('missingTitle')}</Link>
        <Link href="/logistica" className="rounded-md border px-4 py-2 text-sm" prefetch={false}>{t('refresh')}</Link>
      </div>
    </header>
    <div className="rounded-lg border p-4 text-sm space-y-1"><p>{t('source')}</p>{report.blockers.map(code => <p key={code}>{t(code)}</p>)}</div>
    {!report.orders.length && <p>{t('noOrders')}</p>}
    {report.orders.map(order => <article key={order.id} className="space-y-4 rounded-xl border p-5">
      <div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">{order.name} · {order.recipient_name}</h2><span className="text-sm text-muted-foreground">{t(order.stage)}</span></div>
      <div className="space-y-1 text-sm"><p>{order.order_items}</p><p>{order.total_price_display}</p><p>{order.delivery_address}</p></div>
      {order.trackingNumber && <div className="text-sm"><p>{order.carrier} · {order.trackingNumber}</p>{order.trackingCandidate && <a href={order.trackingCandidate} target="_blank" rel="noopener noreferrer" className="underline">{t('tracking')}</a>}<p className="text-muted-foreground">{t('trackingCandidate')}</p></div>}
      <p className="text-sm font-medium">{t('review')}</p>
      {order.calls.length > 0 && <details><summary className="cursor-pointer text-sm">{t('calls')} ({order.calls.length})</summary><div className="mt-3 space-y-3 text-sm">{order.calls.map(call => <div key={call.id}><p>{t(call.status)}{call.dataOnly ? ` · ${t('dataOnly')}` : ''}{call.endedAt ? ` · ${formatDateTime(call.endedAt, locale)}` : ''}</p><p className="whitespace-pre-wrap text-muted-foreground">{call.summary}</p></div>)}</div></details>}
      {order.messages.length > 0 && <details><summary className="cursor-pointer text-sm">{t('history')}</summary><p className="my-2 text-xs text-muted-foreground">{t('historyNote')}</p><div className="max-h-80 space-y-3 overflow-y-auto text-sm">{order.messages.map(message => <div key={message.id} className="rounded border p-3"><p className="text-xs text-muted-foreground">{formatDateTime(message.at, locale)}</p><p className="whitespace-pre-wrap">{message.text}</p></div>)}</div></details>}
    </article>)}
    {report.nextCursor && <Link prefetch={false} href={`/logistica?cursor=${encodeURIComponent(report.nextCursor)}`} className="inline-block rounded-md border px-4 py-2">{t('next')}</Link>}
  </main>;
}
