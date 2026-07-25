'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Check, Trash2, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';

/**
 * Dropi (COD fulfillment, LatAm) integration card. Optional — only COD/
 * dropshipping merchants connect it; a confirmed voice call then pushes the
 * order to Dropi for dispatch.
 */
export function DropiCard() {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [connected, setConnected] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/dropi', { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) {
        setConnected(!!json.connected);
        setBaseUrl(json.config?.base_url ?? '');
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
    if (!connected && apiKey.trim().length < 6) {
      toast.error(t('voice.dropiInvalidKey'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetchWithCsrf('/api/integrations/dropi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
          config: { base_url: baseUrl.trim() || undefined },
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? t('voice.dropiConnectError'));
        return;
      }
      setConnected(true);
      setApiKey('');
      toast.success(t('voice.dropiConnected'));
    } catch {
      toast.error(t('settings.networkError'));
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    setSaving(true);
    try {
      const res = await fetchWithCsrf('/api/integrations/dropi', { method: 'DELETE' });
      if (!res.ok) {
        toast.error(t('settings.disconnectError'));
        return;
      }
      setConnected(false);
      toast.success(t('voice.dropiDisconnected'));
    } catch {
      toast.error(t('settings.networkError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Truck className="h-5 w-5 text-orange-500" />
          <div>
            <p className="text-sm font-medium text-foreground">Dropi</p>
            <p className="text-xs text-muted-foreground">{t('voice.dropiDesc')}</p>
          </div>
        </div>
        {connected && (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
            <Check className="h-3 w-3" />
            {t('voice.connected')}
          </span>
        )}
      </div>

      {loading ? (
        <div className="mt-3 flex items-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={connected ? t('voice.dropiReplaceKey') : t('voice.dropiApiKey')}
          />
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={t('voice.dropiBaseUrl')}
          />
          <div className="flex items-center gap-2">
            <Button onClick={save} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : connected ? (
                t('settings.update')
              ) : (
                t('common.connect')
              )}
            </Button>
            {connected && (
              <Button onClick={disconnect} disabled={saving} variant="ghost" aria-label="Dropi">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
