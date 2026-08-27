'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Loader2, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useWorkspace } from '@/hooks/use-workspace';
import { useT } from '@/hooks/use-locale';
import { DropiCard } from '@/components/settings/dropi-card';
import type { VoiceConnectionConfig } from '@/types';

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
  const [cfg, setCfg] = useState<VoiceConnectionConfig>({
    inbound_enabled: false,
    monthly_minutes_limit: null,
    kill_switch: false,
    // El backend graba por defecto (sólo se apaga con false explícito), así que
    // el interruptor arranca en ON para reflejar la realidad.
    recording_enabled: true,
    // El aviso hablado es opt-in: por defecto el agente NO dice que se graba.
    recording_disclosure: false,
    transfer_number: '',
  });

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
          recording_enabled: json.config.recording_enabled !== false,
          recording_disclosure: json.config.recording_disclosure === true,
          transfer_number: json.config.transfer_number ?? '',
          cod_mode: !!json.config.cod_mode,
          order_writeback: json.config.order_writeback ?? { enabled: false },
        });
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
      onSaved?.();
    } catch {
      toast.error(t('settings.networkError'));
    } finally {
      setSaving(false);
    }
  }

  const wb = cfg.order_writeback ?? {};
  const setWb = (patch: Record<string, unknown>) =>
    setCfg({ ...cfg, order_writeback: { ...wb, ...patch } });

  if (loading) {
    return (
      <section className="rounded-xl border border-border bg-card p-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">{t('voice.behaviourTitle')}</h2>

      <div className="mt-3 space-y-1">
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
        {/* El aviso hablado cuelga de la grabación: sin grabar no significa
            nada, y suelto parecía una tercera decisión independiente. */}
        {cfg.recording_enabled && (
          <div className="border-l border-border/60 pl-3">
            <Toggle
              label={t('voice.recordingDisclosure')}
              hint={t('voice.recordingDisclosureHint')}
              checked={!!cfg.recording_disclosure}
              onChange={(c) => setCfg({ ...cfg, recording_disclosure: c })}
            />
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('voice.monthlyLimit')} hint={t('voice.monthlyLimitHint')}>
          <Input
            type="number"
            min={0}
            value={cfg.monthly_minutes_limit ?? 0}
            onChange={(e) => {
              // 0 y vacío significan lo mismo —sin tope— tanto acá como en el
              // guard de `enqueueCall` (`limit && limit > 0`). Un valor
              // ilegible queda sin tope, que es lo que el resto ya asume.
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

      {/* Contra entrega: le sirve a los que hacen dropshipping y a nadie más.
          Antes ocupaba el mismo lugar que grabar las llamadas. */}
      <button
        type="button"
        onClick={() => setAvanzado((v) => !v)}
        className="mt-4 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${avanzado ? 'rotate-180' : ''}`}
        />
        {t('voice.advancedToggle')}
      </button>

      {avanzado && (
        <div className="mt-2 space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
          <Toggle
            label={t('voice.codMode')}
            hint={t('voice.codModeHint')}
            checked={!!cfg.cod_mode}
            onChange={(c) => setCfg({ ...cfg, cod_mode: c })}
          />
          {cfg.cod_mode && (
            <>
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
              {/* Dropi es el destino del pedido confirmado en COD. */}
              <DropiCard />
            </>
          )}
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <Button onClick={save} disabled={saving} size="sm">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t('voice.save')}
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
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

/**
 * Fila de interruptor. La ayuda dice qué HACE — cada uno de éstos decide si
 * suena un teléfono de verdad, y sin la frase la tarjeta mostraba etiquetas
 * sueltas como «Modo COD» sin forma de averiguar qué pasa al prenderlo.
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
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/40">
      <span className="min-w-0">
        <span className="block text-sm text-foreground">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
