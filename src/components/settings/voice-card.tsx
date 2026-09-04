'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  ArrowRightLeft,
  ChevronDown,
  Gauge,
  Loader2,
  Mic2,
  PhoneIncoming,
  Save,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useWorkspace } from '@/hooks/use-workspace';
import { useT } from '@/hooks/use-locale';
import { DropiCard } from '@/components/settings/dropi-card';
import type { VoiceConnectionConfig } from '@/types';

const DEFAULT_CONFIG: VoiceConnectionConfig = {
  inbound_enabled: false,
  monthly_minutes_limit: null,
  kill_switch: false,
  recording_enabled: true,
  recording_disclosure: false,
  transfer_number: '',
};

/**
 * Cómo se comporta el teléfono.
 *
 * Antes esto era una lista de cinco interruptores idénticos donde «Grabar
 * llamadas» —una preferencia— se veía igual que «Pausar todas las llamadas»
 * —un botón de pánico— y que «Modo confirmación COD», que le sirve a uno de
 * cada veinte comercios. Todo con el mismo peso es lo mismo que nada con peso.
 *
 * Quedan tres alturas: lo de todos los días arriba, lo raro plegado, y el
 * freno de emergencia FUERA de esta tarjeta — lo dibuja la pantalla de
 * Llamadas, separado, porque no es una preferencia.
 *
 * Deliberadamente NO está acá:
 *  - el número y su país — los compra `VoiceNumberCard` con su papeleo, y
 *    tenerlos en dos lados dejaba escribir encima de un número provisionado.
 *  - los tiempos del motor de audio (demora del saludo, corte por silencio):
 *    vienen con valores que funcionan y nadie que venda cremas tiene con qué
 *    elegir un número mejor. El guardado hace MERGE, así que sobreviven.
 */
export function VoiceCard({ onSaved }: { onSaved?: () => void }) {
  const t = useT();
  const { workspace } = useWorkspace();
  const fetchWithCsrf = useFetchWithCsrf();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [avanzado, setAvanzado] = useState(false);
  const [cfg, setCfg] = useState<VoiceConnectionConfig>(DEFAULT_CONFIG);
  const [savedCfg, setSavedCfg] =
    useState<VoiceConnectionConfig>(DEFAULT_CONFIG);

  const load = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/voice/connection?workspace_id=${workspace.id}`,
        {
          cache: 'no-store',
        }
      );
      const json = await res.json();
      if (res.ok && json.config) {
        const next: VoiceConnectionConfig = {
          inbound_enabled: !!json.config.inbound_enabled,
          monthly_minutes_limit: json.config.monthly_minutes_limit ?? null,
          kill_switch: !!json.config.kill_switch,
          recording_enabled: json.config.recording_enabled !== false,
          recording_disclosure: json.config.recording_disclosure === true,
          transfer_number: json.config.transfer_number ?? '',
          cod_mode: !!json.config.cod_mode,
          order_writeback: json.config.order_writeback ?? { enabled: false },
        };
        setCfg(next);
        setSavedCfg(next);
        // Si ya usa COD, lo avanzado abre desplegado: esconderle algo que tiene
        // prendido es peor que mostrarlo de más.
        if (json.config.cod_mode) setAvanzado(true);
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
      toast.success(t('voice.saved'));
      setSavedCfg(cfg);
      onSaved?.();
    } catch {
      toast.error(t('settings.networkError'));
    } finally {
      setSaving(false);
    }
  }

  const wb = cfg.order_writeback ?? {};
  const dirty = JSON.stringify(cfg) !== JSON.stringify(savedCfg);
  const setWb = (patch: Record<string, unknown>) =>
    setCfg({ ...cfg, order_writeback: { ...wb, ...patch } });

  if (loading) {
    return (
      <section className="border-border bg-card grid min-h-36 place-items-center rounded-2xl border">
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      </section>
    );
  }

  return (
    <section className="border-border bg-card overflow-hidden rounded-2xl border shadow-sm">
      <div className="border-border/70 flex items-start gap-3 border-b px-4 py-4 sm:px-5">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400">
          <SlidersHorizontal className="size-4" />
        </span>
        <div>
          <h2 className="text-foreground text-sm font-semibold">
            {t('voice.behaviourTitle')}
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {t('voice.behaviourHint')}
          </p>
        </div>
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
        <Toggle
          icon={PhoneIncoming}
          label={t('voice.inboundEnabled')}
          hint={t('voice.inboundHint')}
          checked={!!cfg.inbound_enabled}
          onChange={(c) => setCfg({ ...cfg, inbound_enabled: c })}
        />
        <Toggle
          icon={Mic2}
          label={t('voice.recordingEnabled')}
          hint={t('voice.recordingHint')}
          checked={!!cfg.recording_enabled}
          onChange={(c) => setCfg({ ...cfg, recording_enabled: c })}
        />
        {/* El aviso hablado cuelga de la grabación: sin grabar no significa
            nada, y suelto parecía una tercera decisión independiente. */}
        {cfg.recording_enabled && (
          <div className="sm:col-span-2">
            <Toggle
              compact
              icon={Mic2}
              label={t('voice.recordingDisclosure')}
              hint={t('voice.recordingDisclosureHint')}
              checked={!!cfg.recording_disclosure}
              onChange={(c) => setCfg({ ...cfg, recording_disclosure: c })}
            />
          </div>
        )}
        <ControlField icon={Gauge} label={t('voice.monthlyLimit')}>
          <Input
            type="number"
            min={0}
            value={cfg.monthly_minutes_limit ?? 0}
            onChange={(e) => {
              const n = Number(e.target.value);
              setCfg({
                ...cfg,
                monthly_minutes_limit: Number.isFinite(n)
                  ? Math.max(0, n)
                  : null,
              });
            }}
          />
          <span className="text-muted-foreground text-[11px]">
            {t('voice.monthlyLimitHint')}
          </span>
        </ControlField>
        <ControlField icon={ArrowRightLeft} label={t('voice.transferNumber')}>
          <Input
            value={cfg.transfer_number ?? ''}
            onChange={(e) =>
              setCfg({ ...cfg, transfer_number: e.target.value })
            }
            placeholder={t('voice.phoneNumberPlaceholder')}
          />
        </ControlField>
      </div>

      {/* Contra entrega: le sirve a los que hacen dropshipping y a nadie más.
          Antes ocupaba el mismo lugar que grabar las llamadas. */}
      <button
        type="button"
        onClick={() => setAvanzado((v) => !v)}
        className="text-muted-foreground hover:text-foreground mx-4 inline-flex items-center gap-1 py-1 text-xs transition-colors sm:mx-5"
      >
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${avanzado ? 'rotate-180' : ''}`}
        />
        {t('voice.advancedToggle')}
      </button>

      {avanzado && (
        <div className="border-border bg-muted/15 mx-4 mt-2 space-y-3 rounded-xl border p-3 sm:mx-5">
          <Toggle
            icon={SlidersHorizontal}
            label={t('voice.codMode')}
            hint={t('voice.codModeHint')}
            checked={!!cfg.cod_mode}
            onChange={(c) => setCfg({ ...cfg, cod_mode: c })}
          />
          {cfg.cod_mode && (
            <>
              <Toggle
                icon={ArrowRightLeft}
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
                      placeholder={t('voice.outcomeConfirmed')}
                    />
                  </Field>
                  <Field label={t('voice.cancelledTag')}>
                    <Input
                      value={wb.cancelled_tag ?? ''}
                      onChange={(e) => setWb({ cancelled_tag: e.target.value })}
                      placeholder={t('voice.outcomeCancelled')}
                    />
                  </Field>
                </div>
              )}
              {/* Dropi es el destino del pedido confirmado en COD. */}
              <DropiCard />
            </>
          )}
        </div>
      )}

      <div className="border-border mt-4 flex items-center justify-between border-t px-4 py-3 sm:px-5">
        <span className="text-muted-foreground text-xs">
          {dirty ? t('voice.unsavedChanges') : t('voice.allSaved')}
        </span>
        <Button onClick={save} disabled={saving || !dirty} size="sm">
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>
              <Save className="mr-1 size-3.5" />
              {t('voice.save')}
            </>
          )}
        </Button>
      </div>
    </section>
  );
}

/** Campo con etiqueta arriba y ayuda abajo. */
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
      <span className="text-muted-foreground mb-1 block text-xs font-medium">
        {label}
      </span>
      {children}
      {hint && (
        <span className="text-muted-foreground mt-1 block text-[11px]">
          {hint}
        </span>
      )}
    </label>
  );
}

/**
 * Fila de interruptor. La ayuda dice qué HACE — cada uno de éstos decide si
 * suena un teléfono de verdad, y sin la frase la tarjeta mostraba etiquetas
 * sueltas como «Modo COD» sin forma de averiguar qué pasa al prenderlo.
 */
function Toggle({
  icon: Icon,
  label,
  hint,
  checked,
  onChange,
  compact,
}: {
  icon: typeof Mic2;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (c: boolean) => void;
  compact?: boolean;
}) {
  return (
    <label
      className={`border-border hover:border-border/80 hover:bg-muted/25 flex cursor-pointer items-start justify-between gap-4 rounded-xl border transition-all ${
        compact ? 'px-3 py-2.5' : 'p-3.5'
      }`}
    >
      <span className="flex min-w-0 gap-2.5">
        <span
          className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg ${
            checked
              ? 'bg-accent/15 text-accent-ink'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0">
          <span className="text-foreground block text-sm font-medium">
            {label}
          </span>
          {hint && (
            <span className="text-muted-foreground mt-0.5 block text-[11px] leading-relaxed">
              {hint}
            </span>
          )}
        </span>
      </span>
      <Switch
        className="mt-1 shrink-0"
        checked={checked}
        onCheckedChange={onChange}
      />
    </label>
  );
}

function ControlField({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Gauge;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="border-border rounded-xl border p-3.5">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="bg-muted text-muted-foreground grid size-7 place-items-center rounded-lg">
          <Icon className="size-3.5" />
        </span>
        <span className="text-foreground text-sm font-medium">{label}</span>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
