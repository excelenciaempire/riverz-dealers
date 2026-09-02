'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';

export function OperationPrep({ workspaceId, onDone }: { workspaceId: string; onDone: () => void }) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [country, setCountry] = useState('');
  const [language, setLanguage] = useState('es');
  const [channel, setChannel] = useState('whatsapp');
  const [storePlatform, setStorePlatform] = useState('shopify');
  const [checkoutMode, setCheckoutMode] = useState('checkout');
  const [vertical, setVertical] = useState('general');
  const [initialGoal, setInitialGoal] = useState('ventas');
  const [paymentMethods, setPaymentMethods] = useState('');
  const [saving, setSaving] = useState(false);
  const prepare = async () => {
    setSaving(true);
    try {
      const response = await fetchWithCsrf(`/api/admin/workspaces/${workspaceId}/prepare-operation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          websiteUrl,
          country,
          language,
          channel,
          storePlatform,
          checkoutMode,
          vertical,
          initialGoal,
          paymentMethods: paymentMethods.split(',').map((item) => item.trim()).filter(Boolean),
        }),
      });
      if (!response.ok) throw new Error('prepare_failed');
      toast.success(t('admin.prepareOperationDone'));
      onDone();
    } catch {
      toast.error(t('admin.prepareOperationError'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-3 p-4">
      <p className="text-sm text-muted-foreground">{t('admin.prepareOperationHint')}</p>
      <div className="flex flex-wrap gap-2">
        <Input
          value={websiteUrl}
          onChange={(event) => setWebsiteUrl(event.target.value)}
          placeholder="https://"
          aria-label={t('admin.prepareOperationWebsite')}
          className="min-w-0 flex-1 bg-background"
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Campo label={t('admin.prepareOperationCountry')} value={country} onChange={setCountry} />
        <Campo label={t('admin.prepareOperationPayments')} value={paymentMethods} onChange={setPaymentMethods} />
        <Opcion label={t('admin.prepareOperationLanguage')} value={language} onChange={setLanguage} options={[['es', 'Español'], ['en', 'English']]} />
        <Opcion label={t('admin.prepareOperationChannel')} value={channel} onChange={setChannel} options={[['whatsapp', 'WhatsApp'], ['instagram', 'Instagram'], ['webchat', 'Webchat'], ['gmail', 'Gmail']]} />
        <Opcion label={t('admin.prepareOperationPlatform')} value={storePlatform} onChange={setStorePlatform} options={[['shopify', 'Shopify'], ['woocommerce', 'WooCommerce'], ['other', t('admin.prepareOperationGeneral')], ['none', '—']]} />
        <Opcion label={t('admin.prepareOperationCheckout')} value={checkoutMode} onChange={setCheckoutMode} options={[['checkout', 'Checkout'], ['chat', 'Chat'], ['segun_pago', t('operation.cobroSegunPago')]]} />
        <Opcion label={t('admin.prepareOperationVertical')} value={vertical} onChange={setVertical} options={[['general', t('admin.prepareOperationGeneral')], ['regulated', t('admin.prepareOperationRegulated')]]} />
        <Opcion label={t('admin.prepareOperationGoal')} value={initialGoal} onChange={setInitialGoal} options={[['ventas', t('admin.prepareOperationSales')], ['postventa', t('admin.prepareOperationAftersale')], ['recuperacion', t('admin.prepareOperationRecovery')]]} />
      </div>
      <Button onClick={() => void prepare()} disabled={saving}>{t('admin.prepareOperationAction')}</Button>
    </div>
  );
}

function Campo({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="space-y-1 text-xs text-muted-foreground">{label}<Input value={value} onChange={(event) => onChange(event.target.value)} className="bg-background" /></label>;
}

function Opcion({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return <label className="space-y-1 text-xs text-muted-foreground">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">{options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}</select></label>;
}
