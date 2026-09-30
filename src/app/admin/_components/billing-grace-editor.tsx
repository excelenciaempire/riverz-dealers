"use client";
import { useEffect, useState } from 'react';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { validGraceHours, MAX_GRACE_HOURS } from '@/lib/billing/grace';
import type { CuentaDelNegocio } from '@/lib/billing/negocio';

export function BillingGraceEditor({ account, disabled, onChanged }: {
  account: CuentaDelNegocio; disabled: boolean; onChanged: () => void;
}) {
  const t = useT(), format = useFormat(), fetchWithCsrf = useFetchWithCsrf();
  const [hours, setHours] = useState(String(account.graceHours ?? 24));
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  useEffect(() => setHours(String(account.graceHours ?? 24)), [account.graceHours]);
  const valid = validGraceHours(Number(hours));
  const changed = Number(hours) !== (account.graceHours ?? 24);
  const preview = account.graceUntil && valid && changed
    ? new Date(Date.parse(account.graceUntil) + (Number(hours) - (account.graceHours ?? 24)) * 3_600_000).toISOString() : null;
  const save = async () => {
    setSaving(true); setError('');
    try {
      const response = await fetchWithCsrf('/api/admin/billing', { method: 'PUT',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gracia: {
          workspace_id: account.workspaceId, horas: Number(hours), horas_previas: account.graceHours ?? 24,
        } }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t('admin.billingSaveFailed'));
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : t('admin.billingSaveFailed')); }
    finally { setSaving(false); }
  };
  return <fieldset disabled={disabled || saving} className="space-y-2 rounded-xl border border-border p-3 disabled:opacity-60">
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t('admin.billingGraceHours')}
        <input type="number" min={24} max={MAX_GRACE_HOURS} step={1} value={hours}
          onChange={e => setHours(e.target.value)} className="h-[34px] w-32 rounded-lg border border-border bg-background px-2 text-sm text-foreground" />
      </label>
      <button type="button" onClick={save} disabled={disabled || saving || !valid || Number(hours) === (account.graceHours ?? 24)}
        className="h-[34px] rounded-lg border border-border px-3 text-xs font-medium disabled:opacity-50">{t('admin.billingSaveGrace')}</button>
    </div>
    <p className="text-xs text-muted-foreground">{t('admin.billingGraceApplies')}</p>
    {preview && <p className="text-xs text-amber-600">{t('admin.billingGracePreview', { date: format.dateTime(preview) })}
      {Date.parse(preview) <= Date.now() && <> {t('admin.billingGraceWillPause')}</>}
    </p>}
    {account.graceUntil && <p className="text-xs">
      {t(account.readOnly ? 'admin.billingReadOnly' : 'admin.billingGraceEnds', { date: format.dateTime(account.graceUntil) })}
      {account.invoiceUrl && <> · <a href={account.invoiceUrl} target="_blank" rel="noopener noreferrer" className="underline">{t('admin.billingViewInvoice')}</a></>}
    </p>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </fieldset>;
}
