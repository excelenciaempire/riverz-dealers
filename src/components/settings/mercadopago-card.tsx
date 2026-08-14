'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import { Loader2, CheckCircle2, Trash2, Copy, AlertTriangle } from 'lucide-react';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';
import { cn } from '@/lib/utils';

/**
 * Mercado Pago como conector, en la misma grilla que las tiendas.
 *
 * Va acá y no en la lista de integraciones sueltas por una razón de
 * producto: es el conector el que hace descubrir la recuperación de pagos
 * rechazados. La receta de la automatización sólo aparece cuando esto está
 * conectado, así que si el conector no se ve, nadie llega nunca — no se
 * conecta una pasarela por una función que no se sabe que existe.
 *
 * Conecta con Access Token pegado y no con OAuth porque Mercado Pago exige
 * registrar una aplicación y una URL de retorno por cada comercio; el token
 * lo saca cualquiera de su panel en dos clics y funciona hoy.
 */
export function MercadoPagoCard() {
  const fetchWithCsrf = useFetchWithCsrf();
  const t = useT();
  const [connected, setConnected] = useState(false);
  const [notifyUrl, setNotifyUrl] = useState<string | null>(null);
  const [oauth, setOauth] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/mercadopago', { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) {
        setConnected(!!json.connected);
        setNotifyUrl(json.notify_url ?? null);
        setOauth(!!json.oauth);
        setAlert(json.alert ?? null);
        setExpiresAt(json.expires_at ?? null);
      }
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
    if (token.trim().length < 20) {
      toast.error(t('settings.mpInvalidToken'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetchWithCsrf('/api/integrations/mercadopago', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: token.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? t('settings.mpConnectError'));
        return;
      }
      setConnected(true);
      setToken('');
      setNotifyUrl(json.notify_url ?? null);
      await load();
      toast.success(t('settings.mpConnected'));
    } catch {
      toast.error(t('settings.networkError'));
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    setSaving(true);
    try {
      const res = await fetchWithCsrf('/api/integrations/mercadopago', {
        method: 'DELETE',
      });
      if (!res.ok) {
        toast.error(t('settings.disconnectError'));
        return;
      }
      setConnected(false);
      toast.success(t('settings.mpDisconnected'));
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
          <Image src="/channels/mercadopago.svg" alt="Mercado Pago" width={28} height={28} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">Mercado Pago</p>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
            {t('settings.mpDescription')}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-3">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : connected ? (
        <ul className="space-y-1">
          {/* El aviso va primero y con su acción al lado: una conexión que
              hay que renovar y no lo dice se apaga sola y el comerciante se
              entera por las ventas que dejaron de recuperarse. */}
          {alert && (
            <li
              className={cn(
                'rounded-md px-2 py-2 ring-1',
                alert === 'renovacion_fallida'
                  ? 'bg-red-500/10 ring-red-500/40'
                  : 'bg-amber-500/10 ring-amber-500/40',
              )}
            >
              <p className="flex items-start gap-1.5 text-[11px] leading-snug text-foreground">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {alert === 'renovacion_fallida'
                    ? t('settings.mpRenewFailed')
                    : t('settings.mpExpiringSoon', {
                        date: expiresAt
                          ? new Date(expiresAt).toLocaleDateString()
                          : '',
                      })}
                </span>
              </p>
              {oauth && (
                <a
                  href="/api/mercadopago/oauth/start"
                  className="mt-1.5 inline-block text-[11px] font-medium underline underline-offset-2"
                >
                  {t('settings.mpReconnect')}
                </a>
              )}
            </li>
          )}
          <li className="flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1.5 ring-1 ring-border/50">
            <CheckCircle2 className="size-3.5 text-emerald-700 dark:text-emerald-400" />
            <span className="flex-1 truncate text-xs text-foreground">
              {t('settings.connected')}
            </span>
            <button
              onClick={disconnect}
              disabled={saving}
              title={t('settings.mpDisconnect')}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-amber-400"
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
            </button>
          </li>
          {notifyUrl && (
            <li className="rounded-md bg-muted/40 px-2 py-2 ring-1 ring-border/50">
              <p className="text-[11px] leading-snug text-muted-foreground">
                {t('settings.mpNotifyUrlLabel')}
              </p>
              <div className="mt-1 flex items-center gap-1">
                <code className="min-w-0 flex-1 truncate text-[10px] text-foreground">
                  {notifyUrl}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(notifyUrl);
                    toast.success(t('settings.mpNotifyUrlCopied'));
                  }}
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={t('settings.mpNotifyUrlCopy')}
                >
                  <Copy className="size-3.5" />
                </button>
              </div>
            </li>
          )}
        </ul>
      ) : null}

      {/* Con la aplicación configurada, conectar es un clic: el comerciante
          autoriza en Mercado Pago y vuelve conectado. Sin ella, queda el
          camino de pegar el token, que sirve igual. */}
      {!loading && !connected && oauth && (
        <a
          href="/api/mercadopago/oauth/start"
          className="mt-auto flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Image src="/channels/mercadopago.svg" alt="" width={16} height={16} />
          {t('common.connect')}
        </a>
      )}

      {!loading && !connected && !oauth && (
        <div className="mt-auto space-y-2">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="APP_USR-..."
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
              <Image src="/channels/mercadopago.svg" alt="" width={16} height={16} />
            )}
            {t('common.connect')}
          </button>
        </div>
      )}
    </li>
  );
}
