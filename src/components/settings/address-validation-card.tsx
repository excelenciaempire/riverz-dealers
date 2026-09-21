'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';
import { cn } from '@/lib/utils';

export function AddressValidationCard() {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [configured, setConfigured] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/integrations/address-validation', {
        cache: 'no-store',
      });
      const json = await response.json();
      if (response.ok) {
        setConfigured(Boolean(json.configured));
        setEnabled(Boolean(json.enabled));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(body: { api_key?: string; enabled: boolean }) {
    setSaving(true);
    try {
      const response = await fetchWithCsrf(
        '/api/integrations/address-validation',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(json.error ?? t('settings.addressValidationSaveError'));
        return false;
      }
      setConfigured(Boolean(json.configured));
      setEnabled(Boolean(json.enabled));
      return true;
    } catch {
      toast.error(t('settings.networkError'));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function toggle(next: boolean) {
    const previous = enabled;
    setEnabled(next);
    if (!(await save({ enabled: next }))) setEnabled(previous);
    else
      toast.success(
        t(
          next
            ? 'settings.addressValidationEnabled'
            : 'settings.addressValidationDisabled'
        )
      );
  }

  async function saveKey() {
    if (!apiKey.trim()) {
      toast.error(t('settings.addressValidationKeyRequired'));
      return;
    }
    const nextEnabled = configured ? enabled : true;
    if (await save({ api_key: apiKey.trim(), enabled: nextEnabled })) {
      setApiKey('');
      setEditing(false);
      toast.success(t('settings.addressValidationConfigured'));
    }
  }

  return (
    <li
      className={cn(
        'group bg-card flex flex-col gap-3 overflow-hidden rounded-xl border p-4 transition-all',
        enabled
          ? 'border-emerald-500/40 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.1)]'
          : 'border-border hover:border-foreground/30'
      )}
    >
      <div className="flex items-start gap-3">
        <div className="ring-border flex size-11 shrink-0 items-center justify-center rounded-xl bg-white p-2 shadow-sm ring-1">
          <MapPin className="size-6 text-[#4285F4]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-foreground truncate text-sm font-semibold">
            {t('settings.addressValidationTitle')}
          </p>
          <p className="text-muted-foreground mt-0.5 line-clamp-3 text-[11px] leading-snug">
            {t('settings.addressValidationDescription')}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-3">
          <Loader2 className="text-muted-foreground size-4 animate-spin" />
        </div>
      ) : configured ? (
        <div className="space-y-2">
          <div className="bg-muted/60 ring-border/50 flex items-center gap-2 rounded-md px-2 py-1.5 ring-1">
            <CheckCircle2
              className={cn(
                'size-3.5',
                enabled ? 'text-emerald-600' : 'text-muted-foreground'
              )}
            />
            <span className="text-foreground flex-1 text-xs">
              {t(
                enabled
                  ? 'settings.addressValidationActive'
                  : 'settings.addressValidationInactive'
              )}
            </span>
            <Switch
              checked={enabled}
              onCheckedChange={(next) => void toggle(next)}
              disabled={saving}
              aria-label={t('settings.addressValidationToggle')}
            />
          </div>
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-muted-foreground hover:text-foreground text-xs font-medium"
            >
              {t('settings.addressValidationReplaceKey')}
            </button>
          )}
        </div>
      ) : null}

      {!loading && (!configured || editing) && (
        <div className="mt-auto space-y-2">
          <label className="block">
            <span className="text-foreground mb-1 block text-xs font-medium">
              {t('settings.addressValidationApiKey')}
            </span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="new-password"
              className="border-border bg-muted text-foreground focus:border-primary w-full rounded-lg border px-2.5 py-1.5 text-xs focus:outline-none"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void saveKey()}
              disabled={saving}
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <KeyRound className="size-4" />
              )}
              {configured ? t('settings.update') : t('common.connect')}
            </button>
            {configured && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setApiKey('');
                }}
                className="text-muted-foreground hover:text-foreground rounded-lg px-3 py-2 text-sm"
              >
                {t('common.cancel')}
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
