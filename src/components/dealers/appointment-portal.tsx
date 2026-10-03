'use client';
import { useEffect, useState } from 'react';
import { useT } from '@/hooks/use-locale';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
interface Visit {
  starts_at: string;
  ends_at: string;
  status: string;
  customer_confirmed: boolean;
  location: string;
  timezone: string;
  business: string;
  seller: string;
  maps_url: string;
  video_url: string;
  vehicle: { title: string; photo: string | null };
  allow_reschedule: boolean;
  slots: string[];
}
export function AppointmentPortal() {
  const t = useT(),
    [visit, setVisit] = useState<Visit | null>(null),
    [error, setError] = useState(''),
    [token, setToken] = useState(''),
    [busy, setBusy] = useState(false),
    [slot, setSlot] = useState(''),
    [done, setDone] = useState('');
  const time = (value: string) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone: visit?.timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  async function call(token: string, action: string, starts_at?: string) {
    const r = await fetch('/api/dealers/appointment-public', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, action, starts_at }),
    });
    const b = await r.json();
    if (!r.ok) throw new Error(b.error);
    return b;
  }
  useEffect(() => {
    const value = window.location.hash.slice(1);
    setToken(value);
    call(value, 'view')
      .then(setVisit)
      .catch((e) => setError(e.message));
  }, []);
  async function act(action: string) {
    setBusy(true);
    setError('');
    try {
      const r = await call(token, action, slot);
      setDone(
        action === 'reschedule' && r.status === 'requested'
          ? 'requested'
          : action
      );
      if (action !== 'cancel') setVisit(await call(token, 'view'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dealers.err_failed'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-xl space-y-5 px-5 py-12">
      <p className="text-muted-foreground text-sm">
        {visit?.business || t('dealers.brand')}
      </p>
      <h1 className="text-3xl font-medium">{t('dealers.yourVisit')}</h1>
      {error && (
        <p role="alert" className="rounded-xl border p-4 text-sm">
          {error}
        </p>
      )}
      {!visit && !error && <p role="status">{t('dealers.loading')}</p>}
      {visit && (
        <article className="space-y-4 rounded-2xl border p-5">
          {visit.vehicle.photo && (
            <Image
              unoptimized
              width={800}
              height={450}
              className="aspect-video w-full rounded-xl object-cover"
              src={visit.vehicle.photo}
              alt={visit.vehicle.title}
              referrerPolicy="no-referrer"
            />
          )}
          <h2 className="text-xl font-medium">{visit.vehicle.title}</h2>
          <p>{time(visit.starts_at)}</p>
          <p className="text-muted-foreground text-sm">
            {visit.timezone} · {visit.location}
          </p>
          {visit.seller && <p className="text-sm">{visit.seller}</p>}
          {visit.status === 'requested' && (
            <p className="text-sm">{t('dealers.requestNote')}</p>
          )}
          <div className="flex flex-wrap gap-4 text-sm">
            {visit.maps_url && (
              <a
                href={visit.maps_url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {t('dealers.directions')}
              </a>
            )}
            {visit.video_url && (
              <a
                href={visit.video_url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {t('dealers.visitVideo')}
              </a>
            )}
          </div>
          {done && (
            <p role="status" className="bg-muted rounded-lg p-3 text-sm">
              {t(`dealers.portal_${done}`)}
            </p>
          )}
          {done !== 'cancel' && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy || visit.customer_confirmed}
                  onClick={() => void act('confirm')}
                >
                  {t(
                    visit.customer_confirmed
                      ? 'dealers.customer_confirmed'
                      : 'dealers.confirmAttendance'
                  )}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void act('cancel')}
                >
                  {t('dealers.cancelVisit')}
                </Button>
              </div>
              {visit.allow_reschedule && (
                <details>
                  <summary className="cursor-pointer text-sm">
                    {t('dealers.reschedule')}
                  </summary>
                  <div className="mt-3 flex gap-2">
                    <select
                      className="bg-background min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
                      aria-label={t('dealers.starts_at')}
                      value={slot}
                      onChange={(e) => setSlot(e.target.value)}
                    >
                      <option value="">
                        {t(
                          visit.slots.length
                            ? 'dealers.select'
                            : 'dealers.noSlots'
                        )}
                      </option>
                      {visit.slots.map((s) => (
                        <option key={s} value={s}>
                          {time(s)}
                        </option>
                      ))}
                    </select>
                    <Button
                      disabled={busy || !slot}
                      onClick={() => void act('reschedule')}
                    >
                      {t('dealers.save')}
                    </Button>
                  </div>
                </details>
              )}
            </>
          )}
        </article>
      )}
    </main>
  );
}
