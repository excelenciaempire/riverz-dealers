'use client';
import { useState } from 'react';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import type { CuentaDelNegocio } from '@/lib/billing/negocio';

export function InvoiceSettlement({ account, disabled, onChanged }: {
  account: CuentaDelNegocio; disabled: boolean; onChanged: () => void;
}) {
  const t = useT(), format = useFormat(), fetchWithCsrf = useFetchWithCsrf();
  const [open, setOpen] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [method, setMethod] = useState<'external_payment' | 'agreement'>('external_payment');
  const [reason, setReason] = useState('');
  const invoice = account.pendingInvoice;
  if (!invoice) return null;
  async function settle() {
    if (!invoice || saving) return;
    setSaving(true); setError('');
    try {
      const response = await fetchWithCsrf('/api/admin/billing/settle', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_id: account.workspaceId,
          invoice_id: invoice.id, amount_remaining: invoice.amountRemaining, currency: invoice.currency, method, reason }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t('admin.billingSettlementFailed'));
      setOpen(false); setReason(''); onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : t('admin.billingSettlementFailed')); }
    finally { setSaving(false); }
  }
  return <fieldset disabled={disabled || saving} className="space-y-3 rounded-xl border border-border p-3 disabled:opacity-60">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm">{t('admin.billingPendingInvoice', { amount: format.currency(invoice.amountRemaining / 100, invoice.currency) })}</span>
      {!open && <button type="button" className="rounded-lg border border-border px-3 py-2 text-xs font-medium" onClick={() => setOpen(true)}>
        {t('admin.billingMarkPaid')}</button>}
    </div>
    {open && <div className="space-y-3">
      <label className="block space-y-1 text-xs"><span>{t('admin.billingSettlementMethod')}</span>
        <select value={method} onChange={e => setMethod(e.target.value as typeof method)} className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm">
          <option value="external_payment">{t('admin.billingExternalPayment')}</option>
          <option value="agreement">{t('admin.billingWaiveAgreement')}</option>
        </select>
      </label>
      <label className="block space-y-1 text-xs"><span>{t('admin.billingSettlementReason')}</span>
        <input maxLength={500} value={reason} onChange={e => setReason(e.target.value)} className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm" />
      </label>
      <p className="text-xs text-muted-foreground">{t(method === 'agreement' ? 'admin.billingWaiveConfirm' : 'admin.billingExternalConfirm')}</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => { setOpen(false); setError(''); }} className="rounded-lg border border-border px-3 py-2 text-xs">{t('admin.billingSettlementCancel')}</button>
        <button type="button" onClick={settle} disabled={!reason.trim() || saving} className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50">
          {t(saving ? 'admin.billingSettling' : 'admin.billingSettlementConfirm')}</button>
      </div>
    </div>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </fieldset>;
}
