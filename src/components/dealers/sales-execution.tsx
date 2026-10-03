'use client';
import { useState, type FormEvent } from 'react';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ACTIVITY_KINDS,
  vehicleTitle,
  type DealerData,
  type Opportunity,
} from '@/lib/dealers/types';
import { salesActions, salesMetrics } from '@/lib/dealers/sales-execution';
const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm';
export function SalesExecution({
  data,
  busy,
  onSave,
  onOpportunity,
  onAppointments,
  full = false,
}: {
  data: DealerData;
  busy: boolean;
  onSave: (entity: string, payload: unknown, id?: string) => Promise<void>;
  onOpportunity: (o: Opportunity) => void;
  onAppointments: () => void;
  full?: boolean;
}) {
  const t = useT(),
    fmt = useFormat(),
    [buyer, setBuyer] = useState<Opportunity | null>(null);
  const actions = salesActions(data),
    metrics = salesMetrics(data);
  const [limit, setLimit] = useState(50);
  const [activityAt, setActivityAt] = useState(0);
  function openActivity(o: Opportunity | null) {
    setActivityAt(Date.now());
    setBuyer(o);
  }
  const scheduled =
    buyer?.next_follow_up_at && Date.parse(buyer.next_follow_up_at) > activityAt
      ? new Date(buyer.next_follow_up_at)
      : null;
  const localScheduled = scheduled
    ? `${scheduled.getFullYear()}-${String(scheduled.getMonth() + 1).padStart(2, '0')}-${String(scheduled.getDate()).padStart(2, '0')}T${String(scheduled.getHours()).padStart(2, '0')}:${String(scheduled.getMinutes()).padStart(2, '0')}`
    : '';
  const name = (id: string) =>
    data.contacts.find((c) => c.id === id)?.name || t('dealers.anonymous');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await onSave('activity', {
        opportunity_id: buyer!.id,
        kind: f.get('kind'),
        note: f.get('note'),
        next_follow_up_at: f.get('next_follow_up_at')
          ? new Date(String(f.get('next_follow_up_at'))).toISOString()
          : null,
        follow_up_note: f.get('follow_up_note'),
      });
      setBuyer(null);
    } catch {
      /* The workspace displays the localized API error; retain the form. */
    }
  }
  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">{t('dealers.actionQueue')}</h2>
        <span className="text-muted-foreground text-xs">
          {t('dealers.responseGoal',{minutes:data.settings?.leads.response_minutes??5})}
        </span>
      </div>
      <div className="space-y-3">
        {actions
          .slice(0, full ? limit : 6)
          .map(({ opportunity: o, reason }) => (
            <article key={o.id} className="bg-card rounded-xl border p-4">
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">{name(o.contact_id)}</h3>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t(`dealers.action_${reason}`)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      reason.includes('visit') ||
                      reason === 'confirm_visit' ||
                      reason === 'record_outcome'
                        ? onAppointments()
                        : onOpportunity(o)
                    }
                  >
                    {t('dealers.review')}
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => openActivity(o)}
                  >
                    {t('dealers.logActivity')}
                  </Button>
                </div>
              </div>
            </article>
          ))}
        {!actions.length && (
          <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-sm">
            {t('dealers.emptyActions')}
          </p>
        )}
      </div>
      {full && actions.length > limit && (
        <Button variant="outline" onClick={() => setLimit((n) => n + 50)}>
          {t('dealers.moreActions')}
        </Button>
      )}
      {full && (
        <>
          <label className="grid max-w-md gap-2 text-xs">
            {t('dealers.logActivity')}
            <select
              className={input}
              value=""
              onChange={(e) =>
                openActivity(
                  data.opportunities.find((o) => o.id === e.target.value) ??
                    null
                )
              }
            >
              <option value="">{t('dealers.select')}</option>
              {data.opportunities
                .filter(
                  (o) =>
                    !['won', 'lost'].includes(o.stage) &&
                    !data.contacts.find((c) => c.id === o.contact_id)?.opted_out
                )
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {name(o.contact_id)}
                  </option>
                ))}
            </select>
          </label>
          <div>
            <h2 className="mb-3 font-medium">{t('dealers.funnelDays',{days:data.settings?.metrics.days??30})}</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {(
                ['leads', 'connected', 'booked', 'attended', 'won'] as const
              ).map((k) => (
                <div key={k} className="rounded-xl border p-4">
                  <p className="text-2xl tabular-nums">
                    {fmt.number(metrics[k])}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t(`dealers.metric_${k}`)}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-muted-foreground mt-3 text-xs">
              {t('dealers.slaConfigured', {
                minutes:data.settings?.leads.response_minutes??5,
                onTime: String(metrics.withinFiveMinutes),
                total: String(metrics.connected),
              })}{' '}
              ·{' '}
              {t('dealers.showEvidence', {
                shows: String(metrics.shows),
                total: String(metrics.outcomes),
              })}
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {['discovery', 'objections', 'visit'].map((k) => (
              <details key={k} className="rounded-xl border p-4">
                <summary className="cursor-pointer text-sm font-medium">
                  {t(`dealers.coach_${k}`)}
                </summary>
                <p className="text-muted-foreground mt-3 text-sm">
                  {t(`dealers.coach_${k}_body`)}
                </p>
              </details>
            ))}
          </div>
          <div>
            <h2 className="mb-3 font-medium">{t('dealers.activityHistory')}</h2>
            <div className="space-y-2">
              {[...(data.activities ?? [])]
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .slice(0, 20)
                .map((a) => (
                  <div key={a.id} className="rounded-lg border p-3 text-sm">
                    <p>
                      {name(
                        data.opportunities.find(
                          (o) => o.id === a.opportunity_id
                        )?.contact_id ?? ''
                      )}{' '}
                      · {t(`dealers.${a.kind}`)}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {fmt.dateTime(a.created_at)}
                      {a.note ? ` · ${a.note}` : ''}
                    </p>
                  </div>
                ))}
            </div>
          </div>
        </>
      )}
      {buyer && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setBuyer(null);
          }}
        >
          <DialogContent className="max-h-[90dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {t('dealers.logActivity')} · {name(buyer.contact_id)}
              </DialogTitle>
            </DialogHeader>
            <div className="bg-muted rounded-lg p-3 text-sm">
              <p>{buyer.preferences || t('dealers.unknownPreferences')}</p>
              {buyer.buying_reason && (
                <p className="mt-2">{buyer.buying_reason}</p>
              )}
              {buyer.objection && (
                <p className="mt-2">
                  {t('dealers.objection')}: {buyer.objection}
                </p>
              )}
              <p className="mt-2 text-xs">
                {data.vehicles
                  .filter((v) =>
                    data.interests.some(
                      (i) =>
                        i.opportunity_id === buyer.id && i.vehicle_id === v.id
                    )
                  )
                  .map(
                    (v) => `${vehicleTitle(v)} · ${t(`dealers.${v.status}`)}`
                  )
                  .join(', ')}
              </p>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <label className="grid gap-1.5 text-xs">
                {t('dealers.activityKind')}
                <select name="kind" className={input}>
                  {ACTIVITY_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`dealers.${k}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-xs">
                {t('dealers.notes')}
                <textarea
                  name="note"
                  maxLength={2000}
                  rows={3}
                  className={input}
                />
              </label>
              <label className="grid gap-1.5 text-xs">
                {t('dealers.next_follow_up_at')}
                <input
                  name="next_follow_up_at"
                  type="datetime-local"
                  defaultValue={localScheduled}
                  className={input}
                />
              </label>
              <label className="grid gap-1.5 text-xs">
                {t('dealers.follow_up_note')}
                <input
                  name="follow_up_note"
                  defaultValue={buyer.follow_up_note}
                  maxLength={1000}
                  className={input}
                />
              </label>
              <p className="text-muted-foreground text-xs">
                {t('dealers.activityEvidence')}
              </p>
              <Button type="submit" disabled={busy}>
                {t('dealers.save')}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
