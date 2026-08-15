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
import { DropiCard } from '@/components/settings/dropi-card';
import type { VoiceConnectionConfig } from '@/types';

/**
 * Voice / phone behavior card: inbound, recording, transfer, the monthly cap
 * and the kill switch, plus a compact usage summary.
 *
 * Deliberately NOT here:
 *  - the phone number and its country — `VoiceNumberCard` above owns them,
 *    since it's the flow that buys the DID and files the regulatory paperwork.
 *    Having both edit the same two fields let a merchant type over their own
 *    provisioned number.
 *  - the audio-engine knobs (greeting delay, silence timeout, who speaks
 *    first). They ship with working defaults and reading them requires knowing
 *    how a turn-taking pipeline behaves; a merchant selling skincare has no
 *    basis to pick a number. Still honored from the stored config, and the
 *    save now MERGES, so they survive untouched.
 */
export function VoiceCard() {
  const t = useT();
  const { workspace } = useWorkspace();
  const fetchWithCsrf = useFetchWithCsrf();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connected, setConnected] = useState(false);
  const [cfg, setCfg] = useState<VoiceConnectionConfig>({
    inbound_enabled: false,
    monthly_minutes_limit: null,
    kill_switch: false,
    // Grabación: el backend graba por defecto (solo se apaga con false explícito),
    // así que el toggle arranca en ON para reflejar la realidad.
    recording_enabled: true,
    // El aviso hablado es opt-in: por defecto el agente NO dice que se graba.
    recording_disclosure: false,
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
          inbound_enabled: !!json.config.inbound_enabled,
          monthly_minutes_limit: json.config.monthly_minutes_limit ?? null,
          kill_switch: !!json.config.kill_switch,
          // Refleja el default-on del backend: ON salvo que esté explícito en false.
          recording_enabled: json.config.recording_enabled !== false,
          recording_disclosure: json.config.recording_disclosure === true,
          transfer_number: json.config.transfer_number ?? '',
          cod_mode: !!json.config.cod_mode,
          order_writeback: json.config.order_writeback ?? { enabled: false },
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
          <PhoneCall className="h-5 w-5 text-yellow-500" />
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
          <div className="space-y-2">
            <Toggle
              label={t('voice.inboundEnabled')}
              hint={t('voice.inboundEnabledHint')}
              checked={!!cfg.inbound_enabled}
              onChange={(c) => setCfg({ ...cfg, inbound_enabled: c })}
            />
            <Toggle
              label={t('voice.recordingEnabled')}
              hint={t('voice.recordingHint')}
              checked={!!cfg.recording_enabled}
              onChange={(c) => setCfg({ ...cfg, recording_enabled: c })}
            />
            {/* El aviso hablado sólo tiene sentido si se está grabando. */}
            {cfg.recording_enabled && (
              <Toggle
                label={t('voice.recordingDisclosure')}
                hint={t('voice.recordingDisclosureHint')}
                checked={!!cfg.recording_disclosure}
                onChange={(c) => setCfg({ ...cfg, recording_disclosure: c })}
              />
            )}
            <Toggle
              label={t('voice.killSwitch')}
              hint={t('voice.killSwitchHint')}
              checked={!!cfg.kill_switch}
              onChange={(c) => setCfg({ ...cfg, kill_switch: c })}
            />
            <Toggle
              label={t('voice.codMode')}
              hint={t('voice.codModeHint')}
              checked={!!cfg.cod_mode}
              onChange={(c) => setCfg({ ...cfg, cod_mode: c })}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('voice.monthlyLimit')} hint={t('voice.monthlyLimitHint')}>
              <Input
                type="number"
                min={0}
                value={cfg.monthly_minutes_limit ?? 0}
                onChange={(e) => {
                  // 0 y vacío significan lo mismo —sin límite— tanto acá como
                  // en el guard de `enqueueCall` (`limit && limit > 0`). Lo que
                  // no puede pasar es que un valor ilegible se guarde como un
                  // número raro: en ese caso queda sin límite, que es el estado
                  // que el resto de la app ya asume por defecto.
                  const n = Number(e.target.value);
                  setCfg({
                    ...cfg,
                    monthly_minutes_limit: Number.isFinite(n) ? Math.max(0, n) : null,
                  });
                }}
              />
            </Field>
            <Field label={t('voice.transferNumber')} hint={t('voice.transferNumberHint')}>
              <Input
                value={cfg.transfer_number ?? ''}
                onChange={(e) => setCfg({ ...cfg, transfer_number: e.target.value })}
                placeholder={t('voice.phoneNumberPlaceholder')}
              />
            </Field>
          </div>

          {cfg.cod_mode && (
            <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
              <Toggle
                label={t('voice.orderWriteback')}
                checked={!!wb.enabled}
                onChange={(c) => setWb({ enabled: c })}
              />
              {wb.enabled && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                </div>
              )}
              {/* Dropi es el destino del pedido confirmado en COD. La tarjeta
                  existía completa —API, ruta, textos— y no se montaba en
                  ningún lado, así que este interruptor prometía un despacho
                  automático que no había forma de conectar. */}
              <DropiCard />
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
                    className="h-full rounded-full bg-yellow-500"
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
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

/**
 * Toggle row. The hint is what the switch DOES — every one of these decides
 * whether a real phone rings, and the catalog already had the sentences
 * written; nothing rendered them, so the card showed bare labels like "Modo
 * COD" with no way to find out what flipping it does.
 */
function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (c: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <span className="min-w-0">
        <span className="block text-sm text-foreground">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
