'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import { Loader2, CheckCircle2, Trash2 } from 'lucide-react';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';
import { cn } from '@/lib/utils';

/**
 * Klaviyo, en la misma grilla que los demás conectores.
 *
 * Vivía en una sección aparte debajo de Canales, donde nadie la veía: una
 * integración que no está donde el comercio busca integraciones no se conecta
 * nunca. Misma tarjeta que Mercado Pago o las tiendas.
 *
 * Qué hace al conectar: el cron `klaviyo-sync` espeja los contactos de Riverz
 * (todos los canales) como perfiles de Klaviyo, con sus etiquetas y sus datos
 * de compra, dentro de una lista "Riverz"; las bajas se suprimen. Además el
 * agente de Instagram empuja al instante el lead que captura.
 *
 * La key se guarda encriptada por workspace y nunca vuelve al cliente.
 */
export function KlaviyoCard() {
  const fetchWithCsrf = useFetchWithCsrf();
  const t = useT();
  const [connected, setConnected] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/klaviyo', { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) setConnected(!!json.connected);
    } catch {
      /* no-op */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (apiKey.trim().length < 10) {
      toast.error(t('settings.klaviyoInvalidKey'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetchWithCsrf('/api/integrations/klaviyo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? t('settings.klaviyoConnectError'));
        return;
      }
      setConnected(true);
      setApiKey('');
      toast.success(t('settings.klaviyoConnected'));
    } catch {
      toast.error(t('settings.networkError'));
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    setSaving(true);
    try {
      const res = await fetchWithCsrf('/api/integrations/klaviyo', {
        method: 'DELETE',
      });
      if (!res.ok) {
        toast.error(t('settings.disconnectError'));
        return;
      }
      setConnected(false);
      toast.success(t('settings.klaviyoDisconnected'));
    } catch {
      toast.error(t('settings.networkError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li
      className={cn(
        'group flex flex-col gap-3 overflow-hidden rounded-xl border bg-card p-4 transition-all',
        connected
          ? 'border-emerald-500/40 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.1)]'
          : 'border-border hover:border-foreground/30',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white p-2 shadow-sm ring-1 ring-border">
          <Image src="/channels/klaviyo.svg" alt="Klaviyo" width={28} height={28} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">Klaviyo</p>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
            {t('settings.klaviyoDescription')}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-3">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : connected ? (
        <ul className="space-y-1">
          <li className="flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1.5 ring-1 ring-border/50">
            <CheckCircle2 className="size-3.5 text-emerald-700 dark:text-emerald-400" />
            <span className="flex-1 truncate text-xs text-foreground">
              {t('settings.connected')}
            </span>
            <button
              onClick={disconnect}
              disabled={saving}
              title={t('settings.disconnectKlaviyo')}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-amber-400"
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
            </button>
          </li>
        </ul>
      ) : null}

      {!loading && !connected && (
        <div className="mt-auto space-y-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={t('settings.klaviyoApiKeyPlaceholder')}
            className="w-full rounded-lg border border-border bg-muted px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
          />
          <button
            onClick={save}
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Image src="/channels/klaviyo.svg" alt="" width={16} height={16} />
            )}
            {t('common.connect')}
          </button>
        </div>
      )}
    </li>
  );
}
