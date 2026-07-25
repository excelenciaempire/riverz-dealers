'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Check, PhoneCall } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useWorkspace } from '@/hooks/use-workspace';
import { useT } from '@/hooks/use-locale';
import type { VoiceCall, VoiceConnectionConfig } from '@/types';

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
  const [stats, setStats] = useState<{ total: number; answered: number; minutes: number } | null>(
    null,
  );

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
      // Compact stats from recent calls.
      const callsRes = await fetch(`/api/voice/calls?workspace_id=${workspace.id}&limit=200`, {
        cache: 'no-store',
      });
      if (callsRes.ok) {
        const { calls } = (await callsRes.json()) as { calls: VoiceCall[] };
        const total = calls.length;
        const answered = calls.filter((c) => c.status === 'completed').length;
        const minutes = Math.round(
          calls.reduce((acc, c) => acc + (c.duration_seconds ?? 0), 0) / 60,
        );
        setStats({ total, answered, minutes });
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

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PhoneCall className="h-5 w-5 text-violet-500" />
          <div>
            <p className="text-sm font-medium text-foreground">{t('voice.cardTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('voice.cardDesc')}</p>
          </div>
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
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {t('voice.phoneNumber')}
              </span>
              <Input
                value={cfg.phone_number ?? ''}
                onChange={(e) => setCfg({ ...cfg, phone_number: e.target.value })}
                placeholder={t('voice.phoneNumberPlaceholder')}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {t('voice.country')}
              </span>
              <Input
                value={cfg.country ?? ''}
                onChange={(e) => setCfg({ ...cfg, country: e.target.value })}
                placeholder="CO"
                maxLength={2}
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              {t('voice.monthlyLimit')}{' '}
              <span className="text-muted-foreground/60">({t('voice.monthlyLimitHint')})</span>
            </span>
            <Input
              type="number"
              min={0}
              value={cfg.monthly_minutes_limit ?? 0}
              onChange={(e) =>
                setCfg({ ...cfg, monthly_minutes_limit: Number(e.target.value) || null })
              }
            />
          </label>

          <label className="flex items-center justify-between">
            <span className="text-sm text-foreground">{t('voice.inboundEnabled')}</span>
            <Switch
              checked={!!cfg.inbound_enabled}
              onCheckedChange={(c) => setCfg({ ...cfg, inbound_enabled: c })}
            />
          </label>

          <label className="flex items-center justify-between">
            <span>
              <span className="block text-sm text-foreground">{t('voice.recordingEnabled')}</span>
              <span className="block text-xs text-muted-foreground">{t('voice.recordingHint')}</span>
            </span>
            <Switch
              checked={!!cfg.recording_enabled}
              onCheckedChange={(c) => setCfg({ ...cfg, recording_enabled: c })}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              {t('voice.transferNumber')}
            </span>
            <Input
              value={cfg.transfer_number ?? ''}
              onChange={(e) => setCfg({ ...cfg, transfer_number: e.target.value })}
              placeholder={t('voice.transferNumberHint')}
            />
          </label>

          <label className="flex items-center justify-between">
            <span>
              <span className="block text-sm text-foreground">{t('voice.killSwitch')}</span>
              <span className="block text-xs text-muted-foreground">{t('voice.killSwitchHint')}</span>
            </span>
            <Switch
              checked={!!cfg.kill_switch}
              onCheckedChange={(c) => setCfg({ ...cfg, kill_switch: c })}
            />
          </label>

          {/* COD / dropshipping mode — opt-in. Off = a normal merchant sees
              nothing extra. On = reveals order write-back + grouping window. */}
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
            <label className="flex items-center justify-between">
              <span>
                <span className="block text-sm text-foreground">{t('voice.codMode')}</span>
                <span className="block text-xs text-muted-foreground">{t('voice.codModeHint')}</span>
              </span>
              <Switch
                checked={!!cfg.cod_mode}
                onCheckedChange={(c) => setCfg({ ...cfg, cod_mode: c })}
              />
            </label>

            {cfg.cod_mode && (
              <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
                <label className="flex items-center justify-between">
                  <span className="text-sm text-foreground">{t('voice.orderWriteback')}</span>
                  <Switch
                    checked={!!cfg.order_writeback?.enabled}
                    onCheckedChange={(c) =>
                      setCfg({
                        ...cfg,
                        order_writeback: { ...(cfg.order_writeback ?? {}), enabled: c },
                      })
                    }
                  />
                </label>
                {cfg.order_writeback?.enabled && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-muted-foreground">
                        {t('voice.confirmedTag')}
                      </span>
                      <Input
                        value={cfg.order_writeback?.confirmed_tag ?? ''}
                        onChange={(e) =>
                          setCfg({
                            ...cfg,
                            order_writeback: {
                              ...(cfg.order_writeback ?? {}),
                              confirmed_tag: e.target.value,
                            },
                          })
                        }
                        placeholder="Confirmado"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-muted-foreground">
                        {t('voice.cancelledTag')}
                      </span>
                      <Input
                        value={cfg.order_writeback?.cancelled_tag ?? ''}
                        onChange={(e) =>
                          setCfg({
                            ...cfg,
                            order_writeback: {
                              ...(cfg.order_writeback ?? {}),
                              cancelled_tag: e.target.value,
                            },
                          })
                        }
                        placeholder="Cancelado"
                      />
                    </label>
                  </div>
                )}
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">
                    {t('voice.dedupeHours')}{' '}
                    <span className="text-muted-foreground/60">({t('voice.dedupeHoursHint')})</span>
                  </span>
                  <Input
                    type="number"
                    min={0}
                    step="0.25"
                    value={cfg.dedupe_hours ?? 0.25}
                    onChange={(e) =>
                      setCfg({ ...cfg, dedupe_hours: Number(e.target.value) || 0.25 })
                    }
                  />
                </label>
              </div>
            )}
          </div>

          {stats && stats.total > 0 && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <span>
                {t('voice.metricTotal')}: <span className="text-foreground">{stats.total}</span>
              </span>
              <span>
                {t('voice.metricAnswered')}:{' '}
                <span className="text-foreground">{stats.answered}</span>
              </span>
              <span>
                {t('voice.metricMinutes')}: <span className="text-foreground">{stats.minutes}</span>
              </span>
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
