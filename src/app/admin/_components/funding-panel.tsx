'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import type { Funding, FundingProvider } from '@/lib/admin/funding';
import {
  useAdminData,
  Panel,
  Stat,
  Loading,
  LoadError,
  StatusPill,
  type Tone,
} from './admin-ui';
import { RefreshButton } from './filters';

const tones: Record<string, Tone> = {
  ok: 'ok',
  bajo: 'warn',
  sin_saldo: 'error',
  error: 'error',
  desconocido: 'muted',
  sin_llave: 'muted',
};

export function FundingPanel() {
  const t = useT();
  const format = useFormat();
  const [days, setDays] = useState(7);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);
  const { data, loading, error, reload } = useAdminData<Funding>(
    `/api/admin/funding?days=${days}`,
    10_000
  );
  const stale = !!data && now - new Date(data.measuredAt).getTime() > 30_000;
  return (
    <Panel
      title={t('admin.fundingTitle')}
      actions={
        <div className="flex items-center gap-2">
          <select
            aria-label={t('admin.fundingHorizon')}
            className="border-border bg-background h-8 rounded-md border px-2 text-xs"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {[7, 14, 30].map((n) => (
              <option key={n} value={n}>
                {t('admin.fundingDays', { n })}
              </option>
            ))}
          </select>
          <RefreshButton onClick={reload} />
        </div>
      }
    >
      {loading && !data ? (
        <Loading forma="stats+table" cajas={3} />
      ) : error || !data ? (
        <LoadError onRetry={reload} />
      ) : (
        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label={t('admin.fundingTopUp')}
              value={
                stale || data.providersError
                  ? '—'
                  : format.currency(data.topUpUsd, 'USD')
              }
              tone={data.topUpUsd > 0 ? 'warn' : undefined}
              hint={t('admin.fundingPartial', { n: data.unknown })}
            />
            {data.wallets.length ? (
              data.wallets.map((w) => (
                <Stat
                  key={w.currency}
                  label={t('admin.fundingMerchants')}
                  value={format.currency(w.balance, w.currency)}
                  hint={t('admin.fundingAvailable', {
                    amount: format.currency(w.available, w.currency),
                    n: w.accounts,
                  })}
                />
              ))
            ) : (
              <Stat
                label={t('admin.fundingMerchants')}
                value={format.currency(0, 'USD')}
              />
            )}
            <Stat
              label={t('admin.fundingDaily')}
              value={format.currency(data.dailyUsd, 'USD')}
              hint={t('admin.fundingBasis')}
            />
          </div>
          {(stale || data.providersError) && (
            <p
              role="status"
              className="text-xs text-amber-700 dark:text-amber-400"
            >
              {t(stale ? 'admin.fundingStale' : 'admin.fundingProviderError')}
            </p>
          )}
          <p className="text-muted-foreground text-xs">
            {t('admin.fundingPolicy')}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border text-muted-foreground border-b text-left text-xs">
                  {[
                    'fundingProvider',
                    'fundingBalance',
                    'fundingRunway',
                    'fundingRecommended',
                    'fundingAction',
                  ].map((key) => (
                    <th key={key} className="px-2 py-2 font-medium">
                      {t(`admin.${key}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.providers.map((p) => (
                  <tr
                    key={p.id}
                    className="border-border border-b last:border-0"
                  >
                    <td className="px-2 py-3">
                      <span className="font-medium">{p.nombre}</span>
                      <div className="mt-1">
                        <StatusPill
                          tone={tones[p.estado]}
                          label={t(`admin.balanceState_${p.estado}`)}
                        />
                      </div>
                    </td>
                    <td className="px-2 py-3 tabular-nums">
                      <Balance provider={p} />
                      <div className="text-muted-foreground mt-1 text-xs">
                        {p.source === 'estimate'
                          ? t('admin.fundingEstimated')
                          : p.saldo === null
                            ? t('admin.fundingConfirm')
                            : t(
                                p.unidad === 'limit_USD'
                                  ? 'admin.fundingUsageLimit'
                                  : 'admin.fundingLiveApi'
                              )}
                      </div>
                      {p.confirmedAt && (
                        <div className="text-muted-foreground text-xs">
                          {format.dateTime(p.confirmedAt)}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-3 tabular-nums">
                      {p.daysLeft === null
                        ? '—'
                        : t('admin.fundingDays', {
                            n: format.number(Math.floor(p.daysLeft)),
                          })}
                    </td>
                    <td className="px-2 py-3 tabular-nums">
                      <div className="font-medium">
                        {stale
                          ? '—'
                          : p.topUpUsd === null
                            ? t(
                                p.estado === 'sin_llave'
                                  ? 'admin.keyMissing'
                                  : 'admin.fundingConfirm'
                              )
                            : format.currency(p.topUpUsd, 'USD')}
                      </div>
                      {p.targetUsd > 0 && (
                        <div className="text-muted-foreground mt-1 text-xs">
                          {t('admin.fundingTarget', {
                            amount: format.currency(p.targetUsd, 'USD'),
                          })}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {p.url && (
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent-ink text-xs font-medium hover:underline"
                          >
                            {t(
                              p.topUpUsd !== null && p.topUpUsd > 0
                                ? 'admin.balancesTopUp'
                                : 'admin.balancesOpen'
                            )}
                          </a>
                        )}
                        {p.needsConfirmation && (
                          <ConfirmBalance provider={p} onSaved={reload} />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.unallocatedUsd > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {t('admin.fundingUnallocated', {
                amount: format.currency(data.unallocatedUsd, 'USD'),
              })}
            </p>
          )}
          <p className="text-muted-foreground text-xs">
            {t('admin.fundingUpdated', {
              date: format.time(data.measuredAt),
              providers: data.providersCheckedAt
                ? format.time(data.providersCheckedAt)
                : '—',
            })}
          </p>
        </div>
      )}
    </Panel>
  );
}

function Balance({ provider: p }: { provider: FundingProvider }) {
  const t = useT();
  const format = useFormat();
  if (p.saldo === null) return <>—</>;
  if (p.unidad === 'chars')
    return <>{t('admin.providersChars', { n: format.number(p.saldo) })}</>;
  if (p.unidad === 'credits')
    return <>{t('admin.fundingCreditCount', { n: format.number(p.saldo) })}</>;
  if (p.unidad === 'limit_USD') return <>{format.currency(p.saldo, 'USD')}</>;
  return (
    <>
      {p.unidad && /^[A-Za-z]{3}$/.test(p.unidad)
        ? format.currency(p.saldo, p.unidad)
        : format.number(p.saldo)}
    </>
  );
}

function ConfirmBalance({
  provider,
  onSaved,
}: {
  provider: FundingProvider;
  onSaved: () => void;
}) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const amount = value.trim() === '' ? NaN : Number(value);
  if (!open)
    return (
      <button
        type="button"
        className="text-accent-ink text-xs hover:underline"
        onClick={() => setOpen(true)}
      >
        {t('admin.fundingRecord')}
      </button>
    );
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
          const r = await fetchWithCsrf('/api/admin/funding', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: provider.id, balanceUsd: amount }),
          });
          if (!r.ok) {
            toast.error(t('admin.fundingSaveError'));
            return;
          }
          setOpen(false);
          setValue('');
          onSaved();
          toast.success(t('admin.fundingSaved'));
        } catch {
          toast.error(t('admin.fundingSaveError'));
        } finally {
          setSaving(false);
        }
      }}
    >
      <label className="text-muted-foreground block text-xs">
        {t('admin.fundingBalanceUsd')}
        <input
          type="number"
          step="0.01"
          min="0"
          max="1000000"
          required
          aria-label={`${provider.nombre}: ${t('admin.fundingBalanceUsd')}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="border-border bg-background mt-1 w-28 rounded-md border px-2 py-1 text-sm"
        />
      </label>
      <p className="text-muted-foreground max-w-60 text-xs">
        {t('admin.fundingManualHint')}
      </p>
      <div className="flex gap-2 text-xs">
        <button
          type="submit"
          disabled={saving || !Number.isFinite(amount) || amount < 0}
          className="bg-primary text-primary-foreground rounded-md px-2 py-1 disabled:opacity-50"
        >
          {t(saving ? 'admin.fundingSaving' : 'admin.fundingSave')}
        </button>
        <button type="button" disabled={saving} onClick={() => setOpen(false)}>
          {t('admin.fundingCancel')}
        </button>
      </div>
    </form>
  );
}
