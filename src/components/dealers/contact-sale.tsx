'use client';
import { useEffect, useState } from 'react';
import Link from '@/components/i18n/locale-link';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import type { DealerData } from '@/lib/dealers/types';
import { vehicleTitle } from '@/lib/dealers/types';
import { DealerCoach } from './coach';
export function ContactSale({ contactId }: { contactId: string }) {
  const t = useT(),
    fmt = useFormat();
  const [data, setData] = useState<DealerData | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/dealers?contact=${contactId}`, {
      cache: 'no-store',
      signal: abort.signal,
    })
      .then(async (res) => {
        if (res.ok) setData(await res.json());
        else setData(null);
      })
      .catch(() => {});
    return () => {
      abort.abort();
      setData(null);
    };
  }, [contactId]);
  const o = data?.opportunities.find((o) => !['won', 'lost'].includes(o.stage));
  const appointment = data?.appointments
    .filter(
      (a) =>
        a.opportunity_id === o?.id &&
        ['requested', 'confirmed'].includes(a.status)
    )
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  return (
    <section className="rounded-lg border p-3">
      <h3 className="text-xs font-medium">{t('dealers.contactContext')}</h3>
      {o && data?.settings?.coach.enabled !== false && <div className="mt-3"><DealerCoach opportunityId={o.id} /></div>}
      {o && (
        <>
          <p className="mt-2 text-sm">
            {t(`dealers.${o.stage}`)} ·{' '}
            {o.budget == null ? '—' : fmt.currency(o.budget, o.currency)}
          </p>
          {data?.vehicles
            .filter((v) =>
              data.interests.some(
                (i) => i.opportunity_id === o.id && i.vehicle_id === v.id
              )
            )
            .map((v) => (
              <p key={v.id} className="text-muted-foreground mt-1 text-xs">
                {vehicleTitle(v)} · {t(`dealers.${v.status}`)}
              </p>
            ))}
          {appointment && (
            <p className="mt-2 text-xs">
              {fmt.dateTime(appointment.starts_at)} ·{' '}
              {t(`dealers.${appointment.status}`)}
            </p>
          )}
          {o.next_follow_up_at && (
            <p className="mt-2 text-xs">
              {t('dealers.next_follow_up_at')}:{' '}
              {fmt.dateTime(o.next_follow_up_at)}
            </p>
          )}
        </>
      )}
      <Link
        href={`/concesionario?view=opportunities&contact=${contactId}`}
        className="mt-3 block text-xs font-medium underline underline-offset-4"
      >
        {t(o ? 'dealers.edit' : 'dealers.newOpportunity')}
      </Link>
    </section>
  );
}
