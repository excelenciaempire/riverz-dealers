'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Check, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';

/**
 * Conectar Klaviyo (por workspace) para el sync de leads capturados por el
 * Agente de Instagram. La key se guarda encriptada y nunca vuelve al cliente.
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
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">Klaviyo</p>
          <p className="text-xs text-muted-foreground">
            {t('settings.klaviyoDescription')}
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
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
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
            aria-label={t('settings.disconnectKlaviyo')}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={t('settings.klaviyoApiKeyPlaceholder')}
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
