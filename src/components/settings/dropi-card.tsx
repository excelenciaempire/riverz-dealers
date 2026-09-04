'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Check, Truck } from 'lucide-react';
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
  const [editing, setEditing] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

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
      setEditing(false);
      setShowAdvanced(false);
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
      const res = await fetchWithCsrf('/api/integrations/dropi', {
        method: 'DELETE',
      });
      if (!res.ok) {
        toast.error(t('settings.disconnectError'));
        return;
      }
      setConnected(false);
      setEditing(false);
      toast.success(t('voice.dropiDisconnected'));
    } catch {
      toast.error(t('settings.networkError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-border bg-card rounded-xl border p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Truck className="size-4 text-orange-500" />
          <div>
            <p className="text-foreground text-sm font-medium">
              {t('voice.dropiTitle')}
            </p>
            <p className="text-muted-foreground text-xs">
              {t('voice.dropiDesc')}
            </p>
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
        <div className="text-muted-foreground mt-3 flex items-center">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : !editing ? (
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            {connected ? t('voice.dropiConfigure') : t('voice.dropiConnect')}
          </Button>
          {connected && (
            <Button
              size="sm"
              variant="ghost"
              onClick={disconnect}
              disabled={saving}
            >
              {t('settings.disconnect')}
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {connected ? t('voice.dropiReplaceKey') : t('voice.dropiApiKey')}
            </span>
            <Input
              name="dropi_api_key"
              type="password"
              autoComplete="new-password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground text-xs transition-colors"
            onClick={() => setShowAdvanced((current) => !current)}
          >
            {t('voice.dropiAdvanced')}
          </button>
          {showAdvanced && (
            <label className="block">
              <span className="text-muted-foreground mb-1 block text-xs font-medium">
                {t('voice.dropiBaseUrl')}
              </span>
              <Input
                name="dropi_base_url"
                type="url"
                autoComplete="off"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </label>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : connected ? (
                t('settings.update')
              ) : (
                t('common.connect')
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setApiKey('');
              }}
            >
              {t('voice.voiceCancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
