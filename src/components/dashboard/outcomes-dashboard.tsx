'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  Percent,
  ShoppingBag,
  UserRound,
  ArrowUpRight,
} from 'lucide-react';
import { toast } from 'sonner';
import Link from '@/components/i18n/locale-link';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { MetricCard } from './metric-card';
import { DetalleAtribucion } from './detalle-atribucion';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  OUTCOME_CATEGORIES,
  type OutcomeCase,
  type OutcomeCategory,
  type OutcomeReport,
} from '@/lib/dashboard/outcomes';
import type { Atribucion } from '@/lib/dashboard/use-attribution';

export function OutcomesDashboard({
  data,
  error,
  attribution,
  onRefresh,
}: {
  data: OutcomeReport | null;
  error: boolean;
  attribution: Atribucion | null;
  onRefresh: () => void;
}) {
  const t = useT();
  const fmt = useFormat();
  const fetchWithCsrf = useFetchWithCsrf();
  const [salesOpen, setSalesOpen] = useState(false);
  const [filter, setFilter] = useState<
    'review' | 'verified' | 'human' | 'pending'
  >('review');
  const [category, setCategory] = useState<OutcomeCategory | 'all'>('all');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<OutcomeCase | null>(null);
  const [reviewCategory, setReviewCategory] =
    useState<OutcomeCategory>('other');
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const salesUnavailable =
    !attribution || !!attribution.error || attribution.not_connected;
  // Keep direct evidence and temporal association separate, with no inferred lift.
  const sales = attribution?.attributed;
  const items =
    data?.cases.filter(
      (c) =>
        c.state === filter && (category === 'all' || c.category === category)
    ) ?? [];
  const pending = data?.pending ?? [];
  const total = filter === 'pending' ? pending.length : items.length;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(total / 10) - 1));
  const changeFilter = (
    next: typeof filter,
    nextCategory: typeof category = 'all'
  ) => {
    setFilter(next);
    setCategory(nextCategory);
    setPage(0);
  };
  const openReview = (c: OutcomeCase) => {
    setSelected(c);
    setReviewCategory(c.category ?? 'other');
    setConfirmed(false);
  };
  const save = async (value: OutcomeCategory | null) => {
    if (!selected || saving) return;
    setSaving(true);
    try {
      const res = await fetchWithCsrf('/api/analytics/outcomes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: selected.id,
          lastMessageId: selected.lastMessageId,
          category: value,
        }),
      });
      const body = await res.json();
      if (!res.ok)
        throw new Error(body.error ?? t('dashboard.outcomeSaveFailed'));
      setSelected(null);
      onRefresh();
      toast.success(
        t(
          value === null ? 'dashboard.outcomeRemoved' : 'dashboard.outcomeSaved'
        )
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('dashboard.outcomeSaveFailed')
      );
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-5" aria-label={t('dashboard.outcomeTitle')}>
      {data?.trial && (
        <div className="border-primary/25 bg-primary/5 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
          <div>
            <h2 className="font-semibold">{t('dashboard.outcomeTrial')}</h2>
            <p className="text-muted-foreground text-sm">
              {t('dashboard.outcomeTrialHelp')}
            </p>
          </div>
          {data.trial.until && (
            <span className="text-sm">
              {t('dashboard.outcomeTrialUntil', {
                date: fmt.date(data.trial.until),
              })}
            </span>
          )}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl border p-4 text-sm"
        >
          {t('dashboard.outcomeLoadFailed')}
          <Button variant="outline" onClick={onRefresh}>
            {t('dashboard.outcomeRetry')}
          </Button>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title={t('dashboard.outcomeResolved')}
          value={data ? fmt.number(data.verified) : '—'}
          icon={CheckCircle2}
          subtitle={t('dashboard.outcomeResolvedSub')}
          onClick={() => changeFilter('verified')}
        />
        <MetricCard
          title={t('dashboard.outcomeRate')}
          value={
            data?.rate != null
              ? fmt.number(data.rate, {
                  style: 'percent',
                  maximumFractionDigits: 0,
                })
              : '—'
          }
          icon={Percent}
          subtitle={
            data
              ? t('dashboard.outcomeRateSub', {
                  n: fmt.number(data.verified),
                  total: fmt.number(data.attended),
                })
              : undefined
          }
          onClick={() => changeFilter('review')}
        />
        <MetricCard
          title={t('dashboard.outcomePending')}
          value={data ? fmt.number(pending.length) : '—'}
          icon={UserRound}
          subtitle={t('dashboard.outcomePendingSub')}
          onClick={() => changeFilter('pending')}
        />
        <MetricCard
          title={t('dashboard.outcomeSales')}
          value={
            salesUnavailable
              ? '—'
              : fmt.money(
                  sales?.revenue ?? 0,
                  sales?.currency ?? attribution?.totals?.currency
                )
          }
          icon={ShoppingBag}
          subtitle={
            attribution?.not_connected
              ? t('dashboard.outcomeConnectStore')
              : attribution?.error === 'mixed_currencies'
                ? t('dashboard.outcomeMixedCurrencies')
                : salesUnavailable
                  ? t('dashboard.outcomeSalesUnavailable')
                  : t('dashboard.outcomeSalesSub', {
                      n: fmt.number(sales?.orders ?? 0),
                    })
          }
          onClick={!salesUnavailable ? () => setSalesOpen(true) : undefined}
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)]">
        <div className="bg-card min-w-0 rounded-xl border">
          <div className="space-y-3 border-b p-5">
            <h2 className="font-semibold">{t('dashboard.outcomeEvidence')}</h2>
            <p className="text-muted-foreground text-xs">
              {t('dashboard.outcomeMethod')}
            </p>
            <div
              className="flex flex-wrap gap-2"
              aria-label={t('dashboard.outcomeEvidence')}
            >
              {(['review', 'verified', 'human', 'pending'] as const).map(
                (value) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={filter === value ? 'secondary' : 'ghost'}
                    aria-pressed={filter === value}
                    onClick={() => changeFilter(value)}
                  >
                    {t(`dashboard.outcomeTab_${value}`)}{' '}
                    <span className="text-muted-foreground tabular-nums">
                      {data
                        ? fmt.number(
                            value === 'pending'
                              ? pending.length
                              : value === 'verified'
                                ? data.verified
                                : value === 'human'
                                  ? data.human
                                  : data.toReview
                          )
                        : '—'}
                    </span>
                  </Button>
                )
              )}
            </div>
            {category !== 'all' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => changeFilter(filter)}
              >
                {t(`dashboard.outcomeCategory_${category}`)} ×
              </Button>
            )}
          </div>
          <div className="divide-y">
            {!data ? (
              <p className="text-muted-foreground p-5 text-sm" role="status">
                {t(
                  error
                    ? 'dashboard.outcomeLoadFailed'
                    : 'dashboard.outcomeLoading'
                )}
              </p>
            ) : total === 0 ? (
              <p className="text-muted-foreground p-5 text-sm">
                {t(`dashboard.outcomeEmpty_${filter}`)}
              </p>
            ) : filter === 'pending' ? (
              pending
                .slice(currentPage * 10, currentPage * 10 + 10)
                .map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 px-5 py-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {c.name ?? t('dashboard.outcomeContact')}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {c.channel}
                        {c.at ? ` · ${fmt.dateTime(c.at)}` : ''}
                      </p>
                    </div>
                    <Link
                      className="shrink-0 text-sm underline underline-offset-4"
                      href={`/bandeja?c=${encodeURIComponent(c.id)}`}
                    >
                      {t('dashboard.outcomeOpen')}
                    </Link>
                  </div>
                ))
            ) : (
              items.slice(currentPage * 10, currentPage * 10 + 10).map((c) => (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {c.name ?? t('dashboard.outcomeContact')}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {c.channel} · {fmt.dateTime(c.at)}
                    </p>
                    {c.category && (
                      <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
                        {t(`dashboard.outcomeCategory_${c.category}`)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <Link
                      className="text-sm underline underline-offset-4"
                      href={`/bandeja?c=${encodeURIComponent(c.id)}`}
                    >
                      {t('dashboard.outcomeOpen')}
                    </Link>
                    {c.state !== 'human' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openReview(c)}
                      >
                        {t(
                          c.state === 'verified'
                            ? 'dashboard.outcomeEdit'
                            : 'dashboard.outcomeReview'
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          {total > 10 && (
            <div className="flex items-center justify-between gap-3 border-t px-5 py-3">
              <Button
                size="sm"
                variant="ghost"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                {t('dashboard.outcomePrevious')}
              </Button>
              <span className="text-xs tabular-nums">
                {fmt.number(currentPage + 1)} /{' '}
                {fmt.number(Math.ceil(total / 10))}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={(currentPage + 1) * 10 >= total}
                onClick={() => setPage(currentPage + 1)}
              >
                {t('dashboard.outcomeNext')}
              </Button>
            </div>
          )}
        </div>
        <div className="bg-card self-start rounded-xl border p-5">
          <h2 className="font-semibold">{t('dashboard.outcomeBreakdown')}</h2>
          <div className="mt-4 space-y-1">
            {OUTCOME_CATEGORIES.map((value) => (
              <button
                key={value}
                type="button"
                className="hover:bg-muted focus-visible:outline-ring flex w-full items-center justify-between gap-3 rounded-lg px-2 py-3 text-left text-sm focus-visible:outline"
                onClick={() => changeFilter('verified', value)}
              >
                <span>{t(`dashboard.outcomeCategory_${value}`)}</span>
                <span className="font-semibold tabular-nums">
                  {data ? fmt.number(data.breakdown[value]) : '—'}
                </span>
              </button>
            ))}
          </div>
          {!salesUnavailable && attribution?.assisted && (
            <div className="mt-4 border-t pt-4">
              <p className="text-muted-foreground text-xs">
                {t('dashboard.outcomeTemporal')}
              </p>
              <button
                type="button"
                onClick={() => setSalesOpen(true)}
                className="mt-2 flex items-center gap-2 text-sm underline underline-offset-4"
              >
                {fmt.money(
                  attribution.assisted.revenue,
                  attribution.assisted.currency
                )}
                <ArrowUpRight className="size-4" />
              </button>
            </div>
          )}
        </div>
      </div>
      <DetalleAtribucion
        data={attribution}
        abierto={salesOpen}
        onAbierto={setSalesOpen}
      />
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && !saving) setSelected(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('dashboard.outcomeReview')}</DialogTitle>
            <DialogDescription>
              {t('dashboard.outcomeReviewHelp')}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <Link
              href={`/bandeja?c=${encodeURIComponent(selected.id)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm underline underline-offset-4"
            >
              {t('dashboard.outcomeOpenNew')}
            </Link>
          )}
          <label className="space-y-2 text-sm">
            <span>{t('dashboard.outcomeCategory')}</span>
            <select
              className="bg-background h-10 w-full rounded-md border px-3"
              value={reviewCategory}
              onChange={(e) =>
                setReviewCategory(e.target.value as OutcomeCategory)
              }
              disabled={saving}
            >
              {OUTCOME_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {t(`dashboard.outcomeCategory_${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input
              className="mt-1"
              type="checkbox"
              checked={confirmed}
              disabled={saving}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {t('dashboard.outcomeConfirm')}
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            {selected?.state === 'verified' && (
              <Button
                variant="outline"
                disabled={saving}
                onClick={() => void save(null)}
              >
                {t('dashboard.outcomeRemove')}
              </Button>
            )}
            <Button
              disabled={!confirmed || saving}
              onClick={() => void save(reviewCategory)}
            >
              {t(saving ? 'dashboard.outcomeSaving' : 'dashboard.outcomeSave')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
