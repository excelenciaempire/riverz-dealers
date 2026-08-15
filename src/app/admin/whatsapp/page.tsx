'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, MessageCircle, ShieldAlert } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';
import { WhatsAppEmbeddedSignup } from '@/components/settings/whatsapp-embedded-signup';
import { Loading, LoadError } from '../_components/admin-ui';

interface Status {
  configured: boolean;
  active: boolean;
  phoneNumberId: string | null;
  wabaId: string | null;
  displayPhoneNumber: string | null;
  templateName: string | null;
  templateLanguage: string;
  hasToken: boolean;
  updatedAt: string | null;
  needsMigration: boolean;
}

/**
 * El WhatsApp de Riverz, no el de un comercio.
 *
 * Vive acá y no en Integraciones porque no es de un inquilino: es el número
 * con el que la plataforma le escribe a los dueños de los comercios cuando
 * algo se rompe. Si saliera por el número del propio comercio, el aviso "tu
 * WhatsApp está bloqueado" sería el único que nunca llega.
 *
 * El token se escribe pero no se lee: la pantalla sólo dice si hay uno puesto.
 */
export default function AdminWhatsAppPage() {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [displayPhoneNumber, setDisplayPhoneNumber] = useState('');
  const [token, setToken] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [isActive, setIsActive] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    let res: Response;
    try {
      res = await fetch('/api/admin/whatsapp', { cache: 'no-store' });
    } catch {
      setFailed(true);
      return;
    }
    // Antes un fallo salía por acá sin decir nada y la pantalla se quedaba
    // girando para siempre, sin forma de reintentar.
    if (!res.ok) {
      setFailed(true);
      return;
    }
    const json = (await res.json()) as Status;
    setStatus(json);
    setPhoneNumberId(json.phoneNumberId ?? '');
    setWabaId(json.wabaId ?? '');
    setDisplayPhoneNumber(json.displayPhoneNumber ?? '');
    setTemplateName(json.templateName ?? '');
    setIsActive(json.active);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetchWithCsrf('/api/admin/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumberId,
          wabaId,
          displayPhoneNumber,
          token,
          templateName,
          templateLanguage: 'es',
          isActive,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? t('admin.saveFailed'));
        return;
      }
      setStatus(json as Status);
      setToken('');
      toast.success(t('common.saved'));
    } finally {
      setSaving(false);
    }
  }

  if (failed) return <LoadError onRetry={load} />;
  if (!status) return <Loading />;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <MessageCircle className="size-5 text-foreground" />
        <h1 className="text-xl font-semibold text-foreground">{t('admin.waPlatformTitle')}</h1>
      </div>

      <p className="max-w-2xl text-sm text-muted-foreground">
        {t('admin.waPlatformDesc')}
      </p>

      {status.needsMigration && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            {t('admin.waNeedsMigration')}
          </span>
        </div>
      )}

      {/* El camino normal es el mismo registro de Meta que usa un comercio: el
          token lo trae el flujo y nadie lo copia a mano. Los campos de abajo
          quedan como salida de emergencia. */}
      <div className="max-w-2xl space-y-3 rounded-xl border border-border bg-card p-5">
        <p className="text-sm font-medium text-foreground">{t('admin.waConnectTitle')}</p>
        <p className="text-xs text-muted-foreground">
          {t('admin.waConnectHint')}{' '}
          {status.configured ? t('admin.waReconnectNote') : ''}
        </p>
        <WhatsAppEmbeddedSignup
          workspaceId="platform"
          target="platform"
          label={status.configured ? t('admin.waReconnect') : t('admin.waConnect')}
          onConnected={() => void load()}
        />
      </div>

      <details className="max-w-2xl rounded-xl border border-border bg-card p-5">
        <summary className="cursor-pointer text-sm font-medium text-foreground">
          {t('admin.waManual')}
        </summary>
        <div className="mt-4 space-y-4">
        <Field label={t('admin.waPhoneId')} hint={t('admin.waPhoneIdHint')}>
          <Input value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} />
        </Field>
        <Field label={t('admin.waWabaId')}>
          <Input value={wabaId} onChange={(e) => setWabaId(e.target.value)} />
        </Field>
        <Field label={t('admin.waDisplay')} hint="+57 300 000 0000">
          <Input
            value={displayPhoneNumber}
            onChange={(e) => setDisplayPhoneNumber(e.target.value)}
          />
        </Field>
        <Field
          label={t('admin.waToken')}
          hint={status.hasToken ? t('admin.waTokenSaved') : t('admin.waTokenHint')}
        >
          <Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={status.hasToken ? '••••••••' : 'EAAG…'}
          />
        </Field>
        <Field
          label={t('admin.waTemplate')}
          hint={t('admin.waTemplateHint')}
        >
          <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
        </Field>

        <div className="flex items-center justify-between border-t border-border pt-4">
          <div>
            <p className="text-sm font-medium text-foreground">{t('admin.waNotify')}</p>
            <p className="text-xs text-muted-foreground">
              {t('admin.waNotifyHint')}
            </p>
          </div>
          <Switch checked={isActive} onCheckedChange={setIsActive} />
        </div>

        <Button onClick={save} disabled={saving} className="w-full">
          {saving && <Loader2 className="size-4 animate-spin" />}
          {t('common.save')}
        </Button>
        </div>
      </details>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
