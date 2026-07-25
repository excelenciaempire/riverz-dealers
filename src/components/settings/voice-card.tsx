'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Loader2, Check, PhoneCall } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useWorkspace } from '@/hooks/use-workspace';
import { useT } from '@/hooks/use-locale';
import type { VoiceConnectionConfig } from '@/types';

/**
 * Voice / phone integration card: assign the workspace's DID, toggle inbound,
 * set a monthly minutes cap and a kill switch, plus a compact call summary.
 */
export function VoiceCard() {
  const t = useT();
  const { workspace } = useWorkspace();
  const fetchWithCsrf = useFetchWithCsrf();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connected, setConnected] = useState(false);
  const [cfg, setCfg] = useState<VoiceConnectionConfig>({
    phone_number: '',
    country: '',
    inbound_enabled: false,
    monthly_minutes_limit: null,
    kill_switch: false,
    recording_enabled: false,
    transfer_number: '',
  });
  const [usage, setUsage] = useState<{
    minutes_used: number;
    minutes_limit: number;
    spend_usd: number;
    calls: number;
  } | null>(null);

  const load = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/voice/connection?workspace_id=${workspace.id}`, {
        cache: 'no-store',
      });
      const json = await res.json();
      if (res.ok && json.config) {
        setCfg({
          phone_number: json.config.phone_number ?? '',
          country: json.config.country ?? '',
          inbound_enabled: !!json.config.inbound_enabled,
          monthly_minutes_limit: json.config.monthly_minutes_limit ?? null,
          kill_switch: !!json.config.kill_switch,
          recording_enabled: !!json.config.recording_enabled,
          transfer_number: json.config.transfer_number ?? '',
          cod_mode: !!json.config.cod_mode,
          order_writeback: json.config.order_writeback ?? { enabled: false },
          dedupe_hours: json.config.dedupe_hours ?? 0.25,
        });
        setConnected(json.status === 'connected');
      }
      // Talk minutes + estimated spend this month vs the monthly cap.
      const usageRes = await fetch(`/api/voice/usage?workspace_id=${workspace.id}`, {
        cache: 'no-store',
      });
      if (usageRes.ok) {
        setUsage(
          (await usageRes.json()) as {
            minutes_used: number;
            minutes_limit: number;
            spend_usd: number;
            calls: number;
          },
        );
      }
    } catch {
      /* no-op */
    } finally {
      setLoading(false);
    }
  }, [workspace?.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!workspace?.id) return;
    setSaving(true);
    try {
      const res = await fetchWithCsrf('/api/voice/connection', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspace.id, config: cfg }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? t('voice.callFailed'));
        return;
      }
      setConnected(json.status === 'connected');
      toast.success(t('voice.saved'));
    } catch {
      toast.error(t('settings.networkError'));
    } finally {
      setSaving(false);
    }
  }

  const wb = cfg.order_writeback ?? {};
  const setWb = (patch: Record<string, unknown>) =>
    setCfg({ ...cfg, order_writeback: { ...wb, ...patch } });

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PhoneCall className="h-5 w-5 text-violet-500" />
          <p className="text-sm font-medium text-foreground">{t('voice.cardTitle')}</p>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            connected
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-border bg-muted text-muted-foreground'
          }`}
        >
          {connected && <Check className="h-3 w-3" />}
          {connected ? t('voice.connected') : t('voice.notConnected')}
        </span>
      </div>

      {loading ? (
        <div className="mt-3 flex items-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('voice.phoneNumber')}>
              <Input
                value={cfg.phone_number ?? ''}
                onChange={(e) => setCfg({ ...cfg, phone_number: e.target.value })}
                placeholder={t('voice.phoneNumberPlaceholder')}
              />
            </Field>
            <Field label={t('voice.country')}>
              <Input
                value={cfg.country ?? ''}
                onChange={(e) => setCfg({ ...cfg, country: e.target.value })}
                placeholder="CO"
                maxLength={2}
              />
            </Field>
            <Field label={t('voice.monthlyLimit')}>
              <Input
                type="number"
                min={0}
                value={cfg.monthly_minutes_limit ?? 0}
                onChange={(e) =>
                  setCfg({ ...cfg, monthly_minutes_limit: Number(e.target.value) || null })
                }
              />
            </Field>
            <Field label={t('voice.transferNumber')}>
              <Input
                value={cfg.transfer_number ?? ''}
                onChange={(e) => setCfg({ ...cfg, transfer_number: e.target.value })}
                placeholder={t('voice.phoneNumberPlaceholder')}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Toggle
              label={t('voice.inboundEnabled')}
              checked={!!cfg.inbound_enabled}
              onChange={(c) => setCfg({ ...cfg, inbound_enabled: c })}
            />
            <Toggle
              label={t('voice.recordingEnabled')}
              checked={!!cfg.recording_enabled}
              onChange={(c) => setCfg({ ...cfg, recording_enabled: c })}
            />
            <Toggle
              label={t('voice.killSwitch')}
              checked={!!cfg.kill_switch}
              onChange={(c) => setCfg({ ...cfg, kill_switch: c })}
            />
            <Toggle
              label={t('voice.codMode')}
              checked={!!cfg.cod_mode}
              onChange={(c) => setCfg({ ...cfg, cod_mode: c })}
            />
          </div>

          {cfg.cod_mode && (
            <div className="grid grid-cols-1 gap-3 rounded-lg border border-border/60 bg-muted/20 p-3 sm:grid-cols-2">
              <Toggle
                label={t('voice.orderWriteback')}
                checked={!!wb.enabled}
                onChange={(c) => setWb({ enabled: c })}
              />
              <Field label={t('voice.dedupeHours')}>
                <Input
                  type="number"
                  min={0}
                  step="0.25"
                  value={cfg.dedupe_hours ?? 0.25}
                  onChange={(e) => setCfg({ ...cfg, dedupe_hours: Number(e.target.value) || 0.25 })}
                />
              </Field>
              {wb.enabled && (
                <>
                  <Field label={t('voice.confirmedTag')}>
                    <Input
                      value={wb.confirmed_tag ?? ''}
                      onChange={(e) => setWb({ confirmed_tag: e.target.value })}
                      placeholder="Confirmado"
                    />
                  </Field>
                  <Field label={t('voice.cancelledTag')}>
                    <Input
                      value={wb.cancelled_tag ?? ''}
                      onChange={(e) => setWb({ cancelled_tag: e.target.value })}
                      placeholder="Cancelado"
                    />
                  </Field>
                </>
              )}
            </div>
          )}

          {usage && (usage.calls > 0 || usage.minutes_used > 0) && (
            <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>{t('voice.usageTitle')}</span>
                <span className="text-foreground">
                  {usage.minutes_used} {t('voice.usageMinutes').toLowerCase()}
                  {usage.minutes_limit > 0
                    ? ` / ${usage.minutes_limit}`
                    : ` · ${t('voice.usageUnlimited')}`}
                </span>
              </div>
              {usage.minutes_limit > 0 && (
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full bg-violet-500"
                    style={{
                      width: `${Math.min(100, Math.round((usage.minutes_used / usage.minutes_limit) * 100))}%`,
                    }}
                  />
                </div>
              )}
              {usage.spend_usd > 0 && (
                <div className="mt-1.5 flex items-center justify-between text-muted-foreground">
                  <span>{t('voice.usageSpend')}</span>
                  <span className="text-foreground">${usage.spend_usd.toFixed(2)}</span>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t('voice.save')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Compact labeled field (2-column friendly). */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Compact toggle row — label + switch, no descriptions. */
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (c: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <span className="text-sm text-foreground">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
