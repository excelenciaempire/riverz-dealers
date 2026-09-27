'use client';

import { useState } from 'react';
import { Check, Copy, Pause, X } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import {
  PageHeader,
  Panel,
  Loading,
  LoadError,
  StatusPill,
  Tabs,
  useAdminData,
} from '../_components/admin-ui';

type Partner = {
  id: string;
  name: string;
  email: string;
  website: string | null;
  audience: string;
  promotion_plan: string;
  referral_code: string;
  status: 'pending' | 'active' | 'rejected' | 'paused';
  created_at: string;
  referral_count: number;
  paying_count: number;
  payout_email: string | null;
};
type Commission = {
  id: string;
  affiliate_id: string;
  commission_cents: number;
  gross_cents: number;
  refunded_cents: number;
  paid_commission_cents: number;
  commission_bps: number;
  currency: string;
  status: 'pending' | 'paid' | 'reversed';
  available_at: string;
  earned_at: string;
  stripe_invoice_id: string;
};
type Data = {
  partners: Partner[];
  commissions: Commission[];
  now: string;
  workspaces: { id: string; name: string }[];
  referrals: {
    id: string;
    affiliate_id: string;
    workspace_id: string | null;
    attributed_at: string;
    attribution_note: string | null;
  }[];
};

export default function AdminAffiliatesPage() {
  const t = useT();
  const fmt = useFormat();
  const fetchWithCsrf = useFetchWithCsrf();
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'applications' | 'commissions' | 'referrals'>(
    'applications'
  );
  const { data, loading, error, reload, live } = useAdminData<Data>(
    '/api/admin/affiliates'
  );

  async function update(body: Record<string, string | number>) {
    setSaving(true);
    try {
      const response = await fetchWithCsrf('/api/admin/affiliates', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        toast.error(result?.error ?? t('affiliates.adminSaveError'));
        return false;
      }
      reload();
      return true;
    } catch {
      toast.error(t('affiliates.adminSaveError'));
      return false;
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) return <Loading forma="table" />;
  if (error || !data) return <LoadError onRetry={reload} />;
  const partnersById = new Map(
    data.partners.map((partner) => [partner.id, partner])
  );
  const money = (cents: number, currency = 'usd') =>
    fmt.currency(cents / 100, currency.toUpperCase());

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('affiliates.adminTitle')}
        description={t('affiliates.adminDescription')}
        live={live}
      />
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'applications', label: t('affiliates.adminApplications') },
          { value: 'referrals', label: t('affiliates.adminReferrals') },
          { value: 'commissions', label: t('affiliates.adminCommissions') },
        ]}
      />
      <Panel>
        {tab === 'referrals' ? (
          <div className="space-y-6">
            <form
              className="grid gap-4"
              onSubmit={async (event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const fields = new FormData(form);
                const ok = await update({
                  kind: 'referral',
                  id: String(fields.get('affiliate')),
                  workspaceId: String(fields.get('workspace')),
                  note: String(fields.get('note')),
                });
                if (ok) {
                  form.reset();
                  toast.success(t('affiliates.adminAssigned'));
                }
              }}
            >
              <h2 className="font-medium">{t('affiliates.adminAssign')}</h2>
              <p className="text-muted-foreground text-sm">
                {t('affiliates.adminAssignTerms')}
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 text-sm">
                  {t('affiliates.adminPartner')}
                  <select
                    name="affiliate"
                    required
                    defaultValue=""
                    className="border-border bg-background rounded-md border p-2"
                  >
                    <option value="" disabled>
                      {t('affiliates.adminSelect')}
                    </option>
                    {data.partners
                      .filter((p) => p.status === 'active')
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {p.referral_code}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="grid gap-2 text-sm">
                  {t('affiliates.adminWorkspace')}
                  <select
                    name="workspace"
                    required
                    defaultValue=""
                    className="border-border bg-background rounded-md border p-2"
                  >
                    <option value="" disabled>
                      {t('affiliates.adminSelect')}
                    </option>
                    {data.workspaces
                      .filter(
                        (w) =>
                          !data.referrals.some((r) => r.workspace_id === w.id)
                      )
                      .map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name} · {w.id.slice(0, 8)}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <label className="grid gap-2 text-sm">
                {t('affiliates.adminCallNote')}
                <textarea
                  name="note"
                  required
                  minLength={5}
                  maxLength={1000}
                  rows={2}
                  className="border-border rounded-md border p-2"
                />
              </label>
              <button
                disabled={saving}
                className="bg-primary text-primary-foreground justify-self-start rounded-md px-4 py-2 text-sm disabled:opacity-50"
              >
                {t('affiliates.adminAssign')}
              </button>
            </form>
            <div className="divide-border divide-y">
              {data.referrals.map((r) => (
                <article key={r.id} className="space-y-1 py-4 text-sm">
                  <p className="font-medium">
                    {partnersById.get(r.affiliate_id)?.name ?? '—'} ·{' '}
                    {data.workspaces.find((w) => w.id === r.workspace_id)
                      ?.name ?? '—'}
                  </p>
                  <p className="text-muted-foreground">
                    {fmt.date(r.attributed_at)} · {r.attribution_note}
                  </p>
                </article>
              ))}
            </div>
          </div>
        ) : tab === 'applications' ? (
          data.partners.length ? (
            <div className="divide-border divide-y">
              {data.partners.map((partner) => (
                <article
                  key={partner.id}
                  className="grid gap-4 py-4 lg:grid-cols-[1fr_auto]"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-medium">{partner.name}</h2>
                      <StatusPill
                        tone={
                          partner.status === 'active'
                            ? 'ok'
                            : partner.status === 'pending'
                              ? 'warn'
                              : 'muted'
                        }
                        label={t(
                          `affiliates.admin${partner.status[0].toUpperCase()}${partner.status.slice(1)}`
                        )}
                      />
                    </div>
                    <p className="text-muted-foreground text-sm">
                      {partner.email} · {partner.audience}
                    </p>
                    <p className="max-w-3xl text-sm">
                      {partner.promotion_plan}
                    </p>
                    <div className="text-muted-foreground flex flex-wrap gap-4 pt-1 text-xs">
                      <span>
                        {t('affiliates.adminReferrals')}:{' '}
                        {partner.referral_count} ({partner.paying_count})
                      </span>
                      <span>
                        {t('affiliates.payoutLabel')}:{' '}
                        {partner.payout_email ?? partner.email}
                      </span>
                      <button
                        type="button"
                        className="hover:text-foreground inline-flex items-center gap-1"
                        onClick={() => {
                          void navigator.clipboard.writeText(
                            partner.referral_code
                          );
                          toast.success(t('admin.mejorasCopiado'));
                        }}
                      >
                        <Copy className="size-3" /> {t('affiliates.adminCode')}:{' '}
                        {partner.referral_code}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    {partner.status !== 'active' ? (
                      <button
                        className="bg-primary text-primary-foreground inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs"
                        onClick={() =>
                          update({
                            kind: 'partner',
                            id: partner.id,
                            status: 'active',
                          })
                        }
                      >
                        <Check className="size-3.5" />
                        {t('affiliates.adminApprove')}
                      </button>
                    ) : null}
                    {partner.status === 'active' ? (
                      <button
                        className="border-border inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs"
                        onClick={() =>
                          update({
                            kind: 'partner',
                            id: partner.id,
                            status: 'paused',
                          })
                        }
                      >
                        <Pause className="size-3.5" />
                        {t('affiliates.adminPause')}
                      </button>
                    ) : null}
                    {partner.status === 'pending' ? (
                      <button
                        className="text-destructive inline-flex items-center gap-1 px-2 py-1.5 text-xs"
                        onClick={() =>
                          update({
                            kind: 'partner',
                            id: partner.id,
                            status: 'rejected',
                          })
                        }
                      >
                        <X className="size-3.5" />
                        {t('affiliates.adminReject')}
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {t('affiliates.adminNoRows')}
            </p>
          )
        ) : data.commissions.length ? (
          <div className="divide-border divide-y">
            {data.commissions.map((commission) => {
              const available =
                commission.status === 'pending' &&
                commission.available_at <= data.now;
              const partner = partnersById.get(commission.affiliate_id);
              return (
                <article
                  key={commission.id}
                  className="flex flex-wrap items-center justify-between gap-4 py-4"
                >
                  <div>
                    <p className="font-medium">
                      {partner?.name ?? '—'} ·{' '}
                      {money(commission.commission_cents, commission.currency)}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {t('affiliates.adminCommissionBase', {
                        rate: fmt.number(commission.commission_bps / 100),
                        amount: money(
                          commission.gross_cents - commission.refunded_cents,
                          commission.currency
                        ),
                      })}{' '}
                      · {commission.stripe_invoice_id}
                    </p>
                    {commission.paid_commission_cents >
                    commission.commission_cents ? (
                      <p className="text-destructive text-xs">
                        {t('affiliates.adminClawback', {
                          amount: money(
                            commission.paid_commission_cents -
                              commission.commission_cents,
                            commission.currency
                          ),
                        })}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusPill
                      tone={
                        commission.status === 'paid'
                          ? 'ok'
                          : available
                            ? 'warn'
                            : 'muted'
                      }
                      label={
                        commission.status === 'paid'
                          ? t('affiliates.adminPaid')
                          : commission.status === 'reversed'
                            ? t('affiliates.adminReversed')
                            : available
                              ? t('affiliates.adminAvailable')
                              : t('affiliates.adminOnHold')
                      }
                    />
                    {available ? (
                      <button
                        className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-xs"
                        onClick={() =>
                          update({
                            kind: 'commission',
                            id: commission.id,
                            expectedCents: commission.commission_cents,
                          })
                        }
                      >
                        {t('affiliates.adminPay')}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="text-muted-foreground py-8 text-center text-sm">
            {t('affiliates.adminNoRows')}
          </p>
        )}
      </Panel>
    </div>
  );
}
