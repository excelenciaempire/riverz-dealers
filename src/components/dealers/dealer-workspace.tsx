'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocalizedRouter } from '@/hooks/use-localized-router';
import {
  CarFront,
  CalendarDays,
  Users,
  ArrowUpRight,
  Plus,
  Search,
  Clock3,
  X,
} from 'lucide-react';
import Link from '@/components/i18n/locale-link';
import Image from 'next/image';
import { useT, useLocale } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { toast } from 'sonner';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  APPOINTMENT_STATUSES,
  STAGES,
  VEHICLE_STATUSES,
  vehicleTitle,
  type DealerData,
  type Vehicle,
  type Opportunity,
  type Appointment,
} from '@/lib/dealers/types';
import { demoData, mutateDemo } from '@/lib/dealers/demo';
import { DealerError } from '@/lib/dealers/validation';
import { SalesExecution } from './sales-execution';
import { OpportunityPipeline } from './opportunity-pipeline';
import { inventorySource } from '@/lib/dealers/inventory-source';
import { cn } from '@/lib/utils';
import { DealerGrowthSettings } from './growth-settings';
import { DealerGrowthMetrics } from './growth-metrics';
import { DealerCoach } from './coach';
import { dealerInventoryMatches } from '@/lib/dealers/growth';
const tabs = [
  'today',
  'vehicles',
  'opportunities',
  'appointments',
  'bdc',
  'settings',
  'metrics',
] as const;
type Tab = (typeof tabs)[number];
type Editor =
  | { entity: 'vehicle'; row?: Vehicle }
  | { entity: 'opportunity'; row?: Opportunity }
  | { entity: 'appointment'; row?: Appointment };
const inputClass =
  'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring';
const activeAppointment = (a: Appointment) =>
  ['requested', 'confirmed'].includes(a.status);
export function DealerWorkspace({ demo = false }: { demo?: boolean }) {
  const t = useT(),
    fmt = useFormat(),
    { locale, setLocale } = useLocale(),
    request = useFetchWithCsrf(),
    router = useLocalizedRouter();
  const params = useSearchParams(),
    contactParam = params.get('contact');
  const initialView = params.get('view');
  const [view, setView] = useState<Tab>(
    tabs.includes(initialView as Tab) ? (initialView as Tab) : 'today'
  );
  const [data, setData] = useState<DealerData | null>(null);
  const [error, setError] = useState(''),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all');
  const [editor, setEditor] = useState<Editor | null>(null),
    [busy, setBusy] = useState(false);
  const moving = useRef(false);
  useEffect(() => {
    const v = params.get('view');
    setView(tabs.includes(v as Tab) ? (v as Tab) : 'today');
    setFilter('all');
    setSearch('');
  }, [params]);
  function switchView(tab: Tab) {
    setView(tab);
    const query = new URLSearchParams({ view: tab });
    if (contactParam) query.set('contact', contactParam);
    router.push(`${demo ? '/demo-dealers' : '/concesionario'}?${query}`);
  }
  const load = useCallback(async () => {
    if (demo) return;
    setError('');
    try {
      const res = await fetch('/api/dealers', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dealers.err_failed'));
    }
  }, [demo, t]);
  useEffect(() => {
    if (demo) setData((current) => current ?? demoData());
    else void load();
  }, [load, demo]);
  const contactName = (id: string) =>
    data?.contacts.find((c) => c.id === id)?.name || t('dealers.anonymous');
  const buyer = (o: Opportunity) => contactName(o.contact_id);
  const interests = (id: string) =>
    data?.vehicles.filter((v) =>
      data.interests.some(
        (i) => i.opportunity_id === id && i.vehicle_id === v.id
      )
    ) || [];
  const visibleOpps =
    data?.opportunities.filter(
      (o) =>
        (!contactParam || o.contact_id === contactParam) &&
        `${buyer(o)} ${interests(o.id).map(vehicleTitle).join(' ')}`
          .toLowerCase()
          .includes(search.toLowerCase())
    ) || [];
  const openOpps = visibleOpps.filter(
    (o) => !['won', 'lost'].includes(o.stage)
  );
  const due = openOpps
    .filter(
      (o) =>
        !o.follow_up_paused &&
        o.next_follow_up_at &&
        Date.parse(o.next_follow_up_at) <= Date.now() &&
        !data?.contacts.find((c) => c.id === o.contact_id)?.opted_out
    )
    .sort((a, b) =>
      (a.next_follow_up_at || '').localeCompare(b.next_follow_up_at || '')
    );
  const upcoming =
    data?.appointments
      .filter(
        (a) =>
          activeAppointment(a) &&
          Date.parse(a.ends_at) > Date.now() &&
          (!contactParam || visibleOpps.some((o) => o.id === a.opportunity_id))
      )
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at)) || [];
  const available =
    data?.vehicles.filter((v) => v.status === 'available') || [];
  const displayTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  async function shareAppointment(id: string) {
    try {
      const res=await request('/api/dealers/appointment-link',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appointment_id:id})});
      const body=await res.json();if(!res.ok)throw new Error(body.error);
      await navigator.clipboard.writeText(body.url);toast.success(t('dealers.linkCopied'));
    } catch(e) {toast.error(e instanceof Error?e.message:t('dealers.err_failed'));}
  }
  async function openInbox(contactId: string) {
    try {
      const res = await fetch(`/api/dealers/conversation?contact=${contactId}`);
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      router.push(`/bandeja?c=${result.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('dealers.err_failed'));
    }
  }
  async function save(entity: string, payload: unknown, id?: string) {
    setBusy(true);
    try {
      if (demo && data) setData(mutateDemo(data, entity, payload, id));
      else {
        const res = await request('/api/dealers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entity, id, data: payload }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || t('dealers.err_failed'));
        await load();
      }
      setEditor(null);
      toast.success(t('dealers.saved'));
    } catch (e) {
      toast.error(
        e instanceof DealerError
          ? t(`dealers.err_${e.code}`)
          : e instanceof Error
            ? e.message
            : t('dealers.err_failed')
      );
      if (entity === 'activity') throw e;
    } finally {
      setBusy(false);
    }
  }
  async function moveOpportunity(o: Opportunity, stage: Opportunity['stage']) {
    if (moving.current || busy || stage === o.stage) return;
    moving.current = true;
    setBusy(true);
    try {
      const payload = { stage, expected_stage: o.stage };
      if (demo && data)
        setData(mutateDemo(data, 'opportunity_stage', payload, o.id));
      else {
        const res = await request('/api/dealers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entity: 'opportunity_stage',
            id: o.id,
            data: payload,
          }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || t('dealers.err_failed'));
        await load();
      }
      toast.success(
        t('dealers.stageMoved', {
          name: buyer(o),
          stage: t(`dealers.${stage}`),
        })
      );
    } catch (e) {
      if (!demo) await load();
      toast.error(
        e instanceof DealerError
          ? t(`dealers.err_${e.code}`)
          : e instanceof Error
            ? e.message
            : t('dealers.err_failed')
      );
    } finally {
      moving.current = false;
      setBusy(false);
    }
  }
  function opportunityCard(o: Opportunity) {
    const c = data?.contacts.find((c) => c.id === o.contact_id);
    return (
      <article key={o.id} className="bg-card rounded-xl border p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-medium">{buyer(o)}</h3>
            <p className="text-muted-foreground mt-1 text-xs">
              {o.budget == null ? '—' : fmt.currency(o.budget, o.currency)}
            </p>
          </div>
          <Status value={o.stage} />
        </div>
        <p className="text-muted-foreground mt-3 text-sm">
          {o.preferences || '—'}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {interests(o.id).map((v) => (
            <span key={v.id} className="bg-muted rounded-md px-2 py-1 text-xs">
              {vehicleTitle(v)} · {t(`dealers.${v.status}`)}
            </span>
          ))}
        </div>
        {o.next_follow_up_at && (
          <p className="mt-3 flex items-center gap-1.5 text-xs">
            <Clock3 className="h-3.5 w-3.5" />
            {fmt.dateTime(o.next_follow_up_at)}
          </p>
        )}
        {o.follow_up_note && (
          <p className="text-muted-foreground mt-2 text-xs">
            {o.follow_up_note}
          </p>
        )}
        {(c?.opted_out || o.follow_up_paused) && (
          <p className="mt-3 text-xs text-amber-600">
            {t(c?.opted_out ? 'dealers.optedOut' : 'dealers.paused')}
          </p>
        )}
        <div className="mt-4 flex items-center justify-between border-t pt-3">
          <button
            className="text-xs font-medium hover:underline"
            onClick={() => setEditor({ entity: 'opportunity', row: o })}
          >
            {t('dealers.edit')}
          </button>
          {!demo && (
            <button
              onClick={() => void openInbox(o.contact_id)}
              className="flex items-center gap-1 text-xs"
            >
              {t('dealers.openInbox')}
              <ArrowUpRight className="h-3 w-3" />
            </button>
          )}
        </div>
      </article>
    );
  }
  function appointmentCard(a: Appointment) {
    const o = data?.opportunities.find((o) => o.id === a.opportunity_id),
      v = data?.vehicles.find((v) => v.id === a.vehicle_id);
    return (
      <article
        key={a.id}
        className="bg-card flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4"
      >
        <div className="flex gap-4">
          <div className="bg-muted flex h-12 w-12 shrink-0 items-center justify-center rounded-xl">
            <CalendarDays className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-medium">
              {o ? buyer(o) : '—'} · {t(`dealers.${a.kind}`)}
            </h3>
            <p className="text-muted-foreground mt-1 text-xs">
              {v ? vehicleTitle(v) : '—'} · {a.location}
            </p>
            <p className="mt-2 text-xs">
              {fmt.dateTime(a.starts_at)} — {fmt.time(a.ends_at)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!demo && activeAppointment(a) && data?.settings?.appointments.self_service !== false && <Button variant="outline" size="sm" onClick={()=>void shareAppointment(a.id)}>{t('dealers.shareVisit')}</Button>}
          {activeAppointment(a) && (
            <details className="text-xs">
              <summary className="cursor-pointer">
                {t('dealers.preparation')}
              </summary>
              <div className="mt-2 grid gap-2">
                {(
                  [
                    'customer_confirmed',
                    'vehicle_prepared',
                    'directions_sent',
                  ] as const
                ).map((k) => (
                  <label key={k} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={a[k] ?? false}
                      disabled={busy}
                      onChange={(e) =>
                        void save(
                          'appointment',
                          { [k]: e.target.checked },
                          a.id
                        )
                      }
                    />
                    {t(`dealers.${k}`)}
                  </label>
                ))}
              </div>
            </details>
          )}
          {activeAppointment(a) && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setEditor({ entity: 'appointment', row: a })}
            >
              {t('dealers.reschedule')}
            </Button>
          )}
          <label className="flex items-center gap-2">
            <span className="sr-only">{t('dealers.status')}</span>
            <select
              className={`${inputClass} w-auto`}
              aria-label={`${t('dealers.status')} ${o ? buyer(o) : ''}`}
              value={a.status}
              disabled={busy}
              onChange={(e) =>
                void save('appointment', { status: e.target.value }, a.id)
              }
            >
              {APPOINTMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`dealers.${s}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </article>
    );
  }
  function Status({ value }: { value: string }) {
    return (
      <span
        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${['available', 'won', 'confirmed'].includes(value) ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}
      >
        {data?.settings?.pipeline.labels[value]?.[locale]??t(`dealers.${value}`)}
      </span>
    );
  }
  const create = () =>
    setEditor({
      entity:
        view === 'vehicles'
          ? 'vehicle'
          : view === 'appointments'
            ? 'appointment'
            : 'opportunity',
    });
  return (
    <div className="mx-auto w-full max-w-7xl min-w-0 space-y-7 p-4 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-muted-foreground mb-2 text-xs font-medium tracking-widest uppercase">
            {t('dealers.brand')}
          </p>
          <h1 className="text-3xl font-medium tracking-tight">
            {t(
              view === 'today'
                ? 'dealers.title'
                : view === 'opportunities'
                  ? 'dealers.pipeline'
                  : view === 'settings' ? 'dealers.growthSettings' : view === 'metrics' ? 'dealers.growthMetrics' : `dealers.${view}`
            )}
          </h1>
          {view === 'today' && (
            <p className="text-muted-foreground mt-2 text-sm">
              {t('dealers.subtitle')}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {!demo && <Button variant="outline" onClick={()=>switchView(view==='settings'?'today':'settings')}>{t(view==='settings'?'dealers.today':'dealers.growthSettings')}</Button>}
          {!demo && <Button variant="outline" onClick={()=>switchView(view==='metrics'?'today':'metrics')}>{t(view==='metrics'?'dealers.today':'dealers.growthMetrics')}</Button>}
          {!demo && data?.settings?.coach.enabled !== false && <DealerCoach/>}
          {view === 'today' && (
            <Button variant="outline" onClick={() => switchView('bdc')}>
              {t('dealers.bdc')}
            </Button>
          )}
          {view === 'bdc' && (
            <Button variant="outline" onClick={() => switchView('today')}>
              {t('dealers.today')}
            </Button>
          )}
          {demo && (
            <>
              <Button
                variant="outline"
                onClick={() => setLocale(locale === 'es' ? 'en' : 'es')}
              >
                {locale === 'es' ? 'English' : 'Español'}
              </Button>
              <Link href="/ingresar" className={buttonVariants()}>
                {t('dealers.start')}
              </Link>
            </>
          )}
        </div>
      </header>
      {demo && (
        <div className="flex flex-wrap justify-between gap-2 rounded-xl border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-xs">
          <span>{t('dealers.demo')}</span>
          <span className="text-muted-foreground">{t('dealers.demoNote')}</span>
        </div>
      )}
      {demo && (
        <nav
          className="flex gap-1 overflow-x-auto border-b"
          aria-label={t('dealers.brand')}
        >
          {tabs.filter(tab=>tab!=='settings').map((tab) => (
            <button
              key={tab}
              className={`shrink-0 border-b-2 px-4 py-3 text-sm ${view === tab ? 'border-foreground font-medium' : 'text-muted-foreground border-transparent'}`}
              onClick={() => {
                switchView(tab);
                setFilter('all');
                setSearch('');
              }}
            >
              {t(
                tab === 'opportunities' ? 'dealers.pipeline' : tab === 'metrics' ? 'dealers.growthMetrics' : `dealers.${tab}`
              )}
            </button>
          ))}
        </nav>
      )}
      {error ? (
        <div role="alert" className="rounded-xl border p-6">
          <p>{error}</p>
          <Button
            className="mt-3"
            variant="outline"
            onClick={() => void load()}
          >
            {t('dealers.retry')}
          </Button>
        </div>
      ) : !data ? (
        <p role="status">{t('dealers.loading')}</p>
      ) : (
        <>
          {view === 'settings' && <DealerGrowthSettings onSaved={()=>void load()}/>}
          {view === 'metrics' && <DealerGrowthMetrics data={data}/>}
          {view === 'today' && (
            <>
              <SalesExecution
                data={data}
                busy={busy}
                onSave={save}
                onOpportunity={(o) =>
                  setEditor({ entity: 'opportunity', row: o })
                }
                onAppointments={() => switchView('appointments')}
              />
              {dealerInventoryMatches(data,data.settings).length>0 && <section className="space-y-3"><h2 className="font-medium">{t('dealers.inventoryMatches')}</h2>{dealerInventoryMatches(data,data.settings).slice(0,5).map(match=><article key={match.opportunity.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><div><p className="text-sm font-medium">{buyer(match.opportunity)}</p><p className="text-muted-foreground mt-1 text-xs">{match.vehicles.map(vehicleTitle).join(' · ')}</p></div><Button variant="outline" size="sm" onClick={()=>setEditor({entity:'opportunity',row:match.opportunity})}>{t('dealers.review')}</Button></article>)}</section>}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                  {
                    key: 'followups',
                    n: due.length,
                    icon: Clock3,
                    tab: 'opportunities',
                  },
                  {
                    key: 'upcoming',
                    n: upcoming.length,
                    icon: CalendarDays,
                    tab: 'appointments',
                  },
                  {
                    key: 'active',
                    n: openOpps.length,
                    icon: Users,
                    tab: 'opportunities',
                  },
                  {
                    key: 'inventory',
                    n: available.length,
                    icon: CarFront,
                    tab: 'vehicles',
                  },
                ].map((s) => (
                  <button
                    key={s.key}
                    onClick={() => switchView(s.tab as Tab)}
                    className="bg-card hover:bg-muted/40 rounded-xl border p-4 text-left transition-colors"
                  >
                    <div className="flex justify-between">
                      <s.icon className="text-muted-foreground h-4 w-4" />
                      <ArrowUpRight className="text-muted-foreground h-3.5 w-3.5" />
                    </div>
                    <p className="mt-4 text-3xl font-medium tracking-tight tabular-nums">
                      {fmt.number(s.n)}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {t(`dealers.${s.key}`)}
                    </p>
                  </button>
                ))}
              </div>
              <div className="grid gap-7 lg:grid-cols-2">
                <section>
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="font-medium">{t('dealers.followups')}</h2>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditor({ entity: 'opportunity' })}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {t('dealers.newOpportunity')}
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {due.map(opportunityCard)}
                    {!due.length && <Empty text="emptyFollowups" />}
                  </div>
                </section>
                <section>
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="font-medium">{t('dealers.upcoming')}</h2>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditor({ entity: 'appointment' })}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {t('dealers.newAppointment')}
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {upcoming.slice(0, 5).map(appointmentCard)}
                    {!upcoming.length && <Empty text="emptyAppointments" />}
                  </div>
                  <p className="text-muted-foreground mt-3 text-xs">
                    {t('dealers.timezone', { timezone: displayTimezone })}
                  </p>
                </section>
              </div>
            </>
          )}
          {view === 'bdc' && (
            <SalesExecution
              data={data}
              busy={busy}
              onSave={save}
              onOpportunity={(o) =>
                setEditor({ entity: 'opportunity', row: o })
              }
              onAppointments={() => switchView('appointments')}
              full
            />
          )}
          {view !== 'today' && view !== 'bdc' && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <label className="relative">
                  <Search className="text-muted-foreground absolute top-3 left-3 h-4 w-4" />
                  <input
                    className={`${inputClass} pl-9 sm:w-72`}
                    aria-label={t('dealers.search')}
                    placeholder={t('dealers.search')}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                {view === 'vehicles' && (
                  <select
                    className={cn(inputClass, 'w-40')}
                    aria-label={t('dealers.status')}
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="all">{t('dealers.all')}</option>
                    {(view === 'vehicles' ? VEHICLE_STATUSES : STAGES).map(
                      (s) => (
                        <option key={s} value={s}>
                          {t(`dealers.${s}`)}
                        </option>
                      )
                    )}
                  </select>
                )}
                {contactParam && (
                  <Link
                    href="/concesionario?view=opportunities"
                    className={buttonVariants({ variant: 'outline' })}
                  >
                    <X className="h-4 w-4" />
                    {t('dealers.all')}
                  </Link>
                )}
              </div>
              <Button onClick={create}>
                <Plus className="h-4 w-4" />
                {t(
                  view === 'vehicles'
                    ? 'dealers.newVehicle'
                    : view === 'appointments'
                      ? 'dealers.newAppointment'
                      : 'dealers.newOpportunity'
                )}
              </Button>
            </div>
          )}
          {view === 'vehicles' && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {data.vehicles
                .filter(
                  (v) =>
                    (filter === 'all' || v.status === filter) &&
                    `${vehicleTitle(v)} ${v.stock_number} ${v.vin || ''}`
                      .toLowerCase()
                      .includes(search.toLowerCase())
                )
                .map((v) => {
                  const source = inventorySource(v.notes);
                  return (
                    <article
                      key={v.id}
                      className="bg-card overflow-hidden rounded-xl border"
                    >
                      <div className="bg-muted/50 relative flex aspect-[16/9] items-center justify-center">
                        {v.photos[0] ? (
                          <Image
                            src={v.photos[0]}
                            alt={vehicleTitle(v)}
                            className="h-full w-full object-cover"
                            fill
                            unoptimized
                            sizes="(min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <CarFront className="text-muted-foreground/30 h-16 w-16" />
                        )}
                        <div className="absolute top-3 right-3">
                          <Status value={v.status} />
                        </div>
                      </div>
                      <div className="p-4">
                        <p className="text-muted-foreground text-xs">
                          {v.stock_number}
                        </p>
                        <h3 className="mt-1 font-medium">{vehicleTitle(v)}</h3>
                        <div className="mt-3 flex items-end justify-between">
                          <p className="text-xl font-medium tracking-tight">
                            {v.price === null
                              ? t('dealers.consultPrice')
                              : fmt.currency(v.price, v.currency)}
                          </p>
                          <span className="text-muted-foreground text-xs">
                            {source?.isNew
                              ? t('dealers.conditionNew')
                              : `${fmt.number(v.mileage)} ${v.mileage_unit}`}
                          </span>
                        </div>
                        {source && (
                          <div className="mt-3 space-y-1 text-xs">
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 hover:underline"
                            >
                              {t('dealers.dealerListing')}
                              <ArrowUpRight className="h-3 w-3" />
                            </a>
                            {source.checkedAt && (
                              <p className="text-muted-foreground">
                                {t('dealers.checkedInventory', {
                                  date: fmt.dateTime(source.checkedAt),
                                })}
                              </p>
                            )}
                          </div>
                        )}
                        <Button
                          variant="outline"
                          className="mt-4 w-full"
                          onClick={() =>
                            setEditor({ entity: 'vehicle', row: v })
                          }
                        >
                          {t('dealers.edit')}
                        </Button>
                      </div>
                    </article>
                  );
                })}
              {!data.vehicles.length && <Empty text="emptyVehicles" />}
              {data.vehicles.length > 0 &&
                !data.vehicles.some(
                  (v) =>
                    (filter === 'all' || v.status === filter) &&
                    `${vehicleTitle(v)} ${v.stock_number} ${v.vin || ''}`
                      .toLowerCase()
                      .includes(search.toLowerCase())
                ) && <Empty text="noResults" />}
            </div>
          )}
          {view === 'opportunities' && (
            <OpportunityPipeline
              data={data}
              opportunities={visibleOpps}
              busy={busy}
              onMove={moveOpportunity}
              onEdit={(o) => setEditor({ entity: 'opportunity', row: o })}
              onInbox={demo ? undefined : (id) => void openInbox(id)}
            />
          )}
          {view === 'appointments' && (
            <>
              <p className="text-muted-foreground text-xs">
                {t('dealers.timezone', { timezone: displayTimezone })} ·{' '}
                {t('dealers.requestNote')}
              </p>
              <div className="space-y-3">
                {data.appointments
                  .filter((a) => {
                    const o = data.opportunities.find(
                      (o) => o.id === a.opportunity_id
                    );
                    return (
                      (!contactParam || o?.contact_id === contactParam) &&
                      `${o ? buyer(o) : ''} ${data.vehicles.find((v) => v.id === a.vehicle_id)?.model || ''}`
                        .toLowerCase()
                        .includes(search.toLowerCase())
                    );
                  })
                  .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
                  .map(appointmentCard)}
                {!data.appointments.length && (
                  <Empty text="emptyAppointments" />
                )}
              </div>
            </>
          )}
        </>
      )}
      {editor && data && (
        <DealerEditor
          editor={editor}
          data={data}
          contactId={contactParam}
          busy={busy}
          onClose={() => setEditor(null)}
          onSave={save}
        />
      )}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  const t = useT();
  return (
    <div className="text-muted-foreground rounded-xl border border-dashed px-5 py-10 text-center text-sm">
      {t(`dealers.${text}`)}
    </div>
  );
}
function localDate(value: string | null | undefined) {
  if (!value) return '';
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function DealerEditor({
  editor,
  data,
  contactId,
  busy,
  onClose,
  onSave,
}: {
  editor: Editor;
  data: DealerData;
  contactId: string | null;
  busy: boolean;
  onClose: () => void;
  onSave: (entity: string, payload: unknown, id?: string) => Promise<void>;
}) {
  const t = useT();
  function field(
    key: string,
    defaultValue: string | number | null | undefined,
    type = 'text',
    required = false
  ) {
    return (
      <label className="grid gap-1.5 text-xs font-medium" key={key}>
        {t(`dealers.${key}`)}
        <input
          name={key}
          type={type}
          defaultValue={defaultValue ?? ''}
          required={required}
          placeholder={key === 'price' ? t('dealers.consultPrice') : undefined}
          className={inputClass}
          min={type === 'number' ? 0 : undefined}
          step={
            type === 'number'
              ? key === 'price' || key === 'budget'
                ? '0.01'
                : '1'
              : undefined
          }
          maxLength={key === 'vin' ? 17 : undefined}
        />
      </label>
    );
  }
  function select(
    key: string,
    value: string,
    options: { value: string; label: string }[],
    required = true,
    disabled = false
  ) {
    return (
      <label className="grid gap-1.5 text-xs font-medium">
        {t(`dealers.${key}`)}
        <select
          className={inputClass}
          name={key}
          defaultValue={value}
          required={required}
          disabled={disabled}
        >
          <option value="">{t('dealers.select')}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const states = (items: readonly string[]) =>
    items.map((s) => ({ value: s, label: t(`dealers.${s}`) }));
  function check(key: string, value: boolean) {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input name={key} type="checkbox" defaultChecked={value} />
        {t(`dealers.${key}`)}
      </label>
    );
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget),
      get = (k: string) => String(f.get(k) ?? '');
    const date = (k: string) =>
      get(k) ? new Date(get(k)).toISOString() : null;
    try {
      if (editor.entity === 'vehicle')
        await onSave(
          'vehicle',
          {
            stock_number: get('stock_number'),
            vin: get('vin'),
            make: get('make'),
            model: get('model'),
            year: Number(get('year')),
            mileage: Number(get('mileage')),
            mileage_unit: get('mileage_unit'),
            price: get('price') ? Number(get('price')) : null,
            currency: get('currency'),
            status: get('status'),
            photos: get('photos')
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean),
            notes: get('notes'),
          },
          editor.row?.id
        );
      else if (editor.entity === 'opportunity')
        await onSave(
          'opportunity',
          {
            contact_id: editor.row?.contact_id || get('contact_id'),
            stage: get('stage'),
            budget: get('budget') ? Number(get('budget')) : null,
            currency: get('currency'),
            preferences: get('preferences'),
            buying_timeframe: get('buying_timeframe'),
            financing: f.has('financing'),
            trade_in: get('trade_in'),
            buying_reason: get('buying_reason'),
            objection: get('objection'),
            buyer_type: get('buyer_type'),
            lead_source: get('lead_source'),
            lost_reason: get('lost_reason'),
            next_follow_up_at: date('next_follow_up_at'),
            follow_up_note: get('follow_up_note'),
            follow_up_paused: f.has('follow_up_paused'),
            vehicle_ids: f.getAll('vehicle_ids'),
          },
          editor.row?.id
        );
      else
        await onSave(
          'appointment',
          {
            opportunity_id: get('opportunity_id'),
            vehicle_id: get('vehicle_id'),
            starts_at: date('starts_at'),
            ends_at: date('ends_at'),
            location: get('location'),
            kind: get('kind'),
            status: get('status'),
          },
          editor.row?.id
        );
    } catch {
      toast.error(t('dealers.err_invalid'));
    }
  }
  const v = editor.entity === 'vehicle' ? editor.row : undefined,
    o = editor.entity === 'opportunity' ? editor.row : undefined,
    a = editor.entity === 'appointment' ? editor.row : undefined;
  const defaultStart = new Date(Date.now() + 86400000).toISOString(),
    defaultEnd = new Date(Date.now() + 86400000 + (data.settings?.appointments.duration_minutes??30)*60000).toISOString();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {t(
              editor.row
                ? 'dealers.edit'
                : editor.entity === 'vehicle'
                  ? 'dealers.newVehicle'
                  : editor.entity === 'opportunity'
                    ? 'dealers.newOpportunity'
                    : 'dealers.newAppointment'
            )}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {editor.entity === 'vehicle' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                {field('stock_number', v?.stock_number, 'text', true)}
                {field('vin', v?.vin)}
                {field('make', v?.make, 'text', true)}
                {field('model', v?.model, 'text', true)}
                {field(
                  'year',
                  v?.year || new Date().getFullYear(),
                  'number',
                  true
                )}
                {field('mileage', v?.mileage ?? 0, 'number', true)}
                {select('mileage_unit', v?.mileage_unit || 'mi', [
                  { value: 'mi', label: 'mi' },
                  { value: 'km', label: 'km' },
                ])}
                {field('price', v?.price, 'number')}
                {field('currency', v?.currency || 'USD', 'text', true)}
                {select(
                  'status',
                  v?.status || 'available',
                  states(VEHICLE_STATUSES)
                )}
              </div>
              <label className="grid gap-1.5 text-xs font-medium">
                {t('dealers.photos')}
                <textarea
                  name="photos"
                  defaultValue={v?.photos.join('\n')}
                  rows={3}
                  className={`${inputClass} h-auto py-2`}
                />
              </label>
              <label className="grid gap-1.5 text-xs font-medium">
                {t('dealers.notes')}
                <textarea
                  name="notes"
                  defaultValue={v?.notes}
                  rows={4}
                  maxLength={2000}
                  className={`${inputClass} h-auto py-2`}
                />
              </label>
            </>
          )}
          {editor.entity === 'opportunity' && (
            <>
              {select(
                'contact_id',
                o?.contact_id || contactId || '',
                data.contacts.map((c) => ({
                  value: c.id,
                  label: c.name || c.phone || t('dealers.anonymous'),
                })),
                true,
                !!o
              )}
              <div className="grid grid-cols-2 gap-3">
                {select('stage', o?.stage || 'inquiry', states(STAGES))}
                {field('budget', o?.budget, 'number')}
                {field('currency', o?.currency || 'USD', 'text', true)}
                {field('buying_timeframe', o?.buying_timeframe)}
              </div>
              {field('preferences', o?.preferences)}
              {field('buying_reason', o?.buying_reason)}
              <div className="grid grid-cols-2 gap-3">
                {select(
                  'buyer_type',
                  o?.buyer_type || 'unknown',
                  states(['unknown', 'first_time', 'replacement', 'additional'])
                )}
                {field('lead_source', o?.lead_source)}
              </div>
              {field('objection', o?.objection)}
              {select('lost_reason',o?.lost_reason||'',[{value:'',label:t('dealers.select')},...(data.settings?.metrics.lost_reasons||['price','inventory','timing','financing','competitor','no_response','other']).map(reason=>({value:reason,label:['price','inventory','timing','financing','competitor','no_response','other'].includes(reason)?t(`dealers.loss_${reason}`):reason}))])}
              {check('financing', o?.financing || false)}
              {field('trade_in', o?.trade_in)}
              <fieldset className="rounded-lg border p-3">
                <legend className="px-1 text-xs font-medium">
                  {t('dealers.vehicle_ids')}
                </legend>
                <div className="max-h-36 space-y-2 overflow-y-auto">
                  {data.vehicles.map((v) => (
                    <label
                      key={v.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        name="vehicle_ids"
                        value={v.id}
                        defaultChecked={data.interests.some(
                          (i) =>
                            i.opportunity_id === o?.id && i.vehicle_id === v.id
                        )}
                      />
                      {vehicleTitle(v)}
                      <span className="text-muted-foreground ml-auto text-xs">
                        {t(`dealers.${v.status}`)}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {field(
                'next_follow_up_at',
                localDate(o?.next_follow_up_at),
                'datetime-local'
              )}
              {field('follow_up_note', o?.follow_up_note)}
              {check('follow_up_paused', o?.follow_up_paused || false)}
            </>
          )}
          {editor.entity === 'appointment' && (
            <>
              {select(
                'opportunity_id',
                a?.opportunity_id || '',
                data.opportunities
                  .filter(
                    (o) =>
                      !['won', 'lost'].includes(o.stage) &&
                      !data.contacts.find((c) => c.id === o.contact_id)
                        ?.opted_out
                  )
                  .map((o) => ({
                    value: o.id,
                    label:
                      data.contacts.find((c) => c.id === o.contact_id)?.name ||
                      t('dealers.anonymous'),
                  })),
                true,
                !!a
              )}
              {select(
                'vehicle_id',
                a?.vehicle_id || '',
                data.vehicles
                  .filter((v) => v.status === 'available')
                  .map((v) => ({ value: v.id, label: vehicleTitle(v) })),
                true,
                !!a
              )}
              <div className="grid grid-cols-2 gap-3">
                {field(
                  'starts_at',
                  localDate(a?.starts_at || defaultStart),
                  'datetime-local',
                  true
                )}
                {field(
                  'ends_at',
                  localDate(a?.ends_at || defaultEnd),
                  'datetime-local',
                  true
                )}
              </div>
              <p className="text-muted-foreground text-xs">
                {t('dealers.timezone', {
                  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                })}
              </p>
              {field('location', a?.location || data.settings?.business.location || '', 'text', true)}
              <div className="grid grid-cols-2 gap-3">
                {select(
                  'kind',
                  a?.kind || 'test_drive',
                  states(['visit', 'test_drive'])
                )}
                {select(
                  'status',
                  a?.status || 'confirmed',
                  states(['requested', 'confirmed'])
                )}
              </div>
            </>
          )}
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              {t('dealers.cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {t(busy ? 'dealers.loading' : 'dealers.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
