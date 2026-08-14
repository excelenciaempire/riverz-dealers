'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Check, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';

/**
 * Conectar Mercado Pago (por workspace) para recuperar pagos rechazados.
 *
 * Un pago rechazado no genera pedido, así que no lo ve ningún webhook de la
 * tienda: el token es la única forma de enterarse de que alguien intentó
 * comprar y no pudo. Se guarda encriptado y nunca vuelve al cliente.
 */
export function MercadoPagoCard() {
  const fetchWithCsrf = useFetchWithCsrf();
  const t = useT();
  const [connected, setConnected] = useState(false);
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/mercadopago', { cache: 'no-store' });
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
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">Mercado Pago</p>
          <p className="text-xs text-muted-foreground">
            {t('settings.mpDescription')}
          </p>
        </div>
        {connected && (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
            <Check className="h-3 w-3" />
            {t('settings.connected')}
          </span>
        )}
      </div>

      {loading ? (
        <div className="mt-3 flex items-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : connected ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={t('settings.replaceApiKeyPlaceholder')}
            className="max-w-xs min-w-0 flex-1"
          />
          <Button onClick={save} disabled={saving} variant="secondary">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t('settings.update')}
          </Button>
          <Button
            onClick={disconnect}
            disabled={saving}
            variant="ghost"
            aria-label={t('settings.mpDisconnect')}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="APP_USR-..."
            className="max-w-xs min-w-0 flex-1"
          />
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t('common.connect')}
          </Button>
        </div>
      )}
    </div>
  );
}
