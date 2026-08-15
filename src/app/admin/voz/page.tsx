'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useLocale, useT } from '@/hooks/use-locale';
import { Loading, LoadError } from '../_components/admin-ui';
import type { VoiceModelConfig } from '@/lib/voice/model-config';
import {
  LAYER_PROVIDERS,
  modelsFor,
  providerOption,
  type ProviderOption,
} from '@/lib/voice/providers';
import { describeChange, isValidVoice, type CompatChange } from '@/lib/voice/compat';

/**
 * Platform-admin only: the GLOBAL voice model stack, modular by layer
 * (STT · LLM · TTS · or a full-duplex S2S engine). Each layer is a
 * provider + model dropdown; merchants never see this.
 */
export default function AdminVoiceModelPage() {
  const { t, locale } = useLocale();
  const fetchWithCsrf = useFetchWithCsrf();
  const [config, setConfig] = useState<VoiceModelConfig | null>(null);
  // Lo que el servidor ajustó solo para que el stack quede coherente.
  const [autoFixed, setAutoFixed] = useState<CompatChange[]>([]);
  const [keys, setKeys] = useState<{
    stt_api_key: string;
    llm_api_key: string;
    tts_api_key: string;
    realtime_api_key: string;
  }>({ stt_api_key: '', llm_api_key: '', tts_api_key: '', realtime_api_key: '' });
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch('/api/admin/voice-model', { cache: 'no-store' });
      if (res.status === 403 || res.status === 401) {
        setForbidden(true);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      setConfig(json.config as VoiceModelConfig);
    } catch {
      // Un corte de red no es una falta de permiso. Antes las dos cosas
      // terminaban en el mismo cartel de "prohibido", sin forma de reintentar.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function set(patch: Partial<VoiceModelConfig>) {
    setConfig((c) => (c ? { ...c, ...patch } : c));
  }

  /**
   * Cambiar de proveedor arrastra todo lo suyo: modelo, endpoint, key y voz.
   * Dejar puesto lo del anterior es lo que deja la llamada muda o con 401, así
   * que se limpia acá igual que en el servidor (que es el que manda).
   */
  function changeProvider(layer: 'stt' | 'llm' | 'tts' | 'realtime', p: string, m: string) {
    const patch: Record<string, unknown> = {
      [`${layer}_provider`]: layer === 'realtime' ? p || null : p,
      [`${layer}_model`]: layer === 'realtime' ? m || null : m,
      [`${layer}_base_url`]: null,
    };
    if (layer === 'tts' || layer === 'realtime') {
      patch.tts_default_voice_id = providerOption(layer, p)?.defaultVoice ?? null;
    }
    set(patch as Partial<VoiceModelConfig>);
    setKeys((k) => ({ ...k, [`${layer}_api_key`]: '' }));
    setAutoFixed([]);
  }

  async function save() {
    if (!config) return;
    setSaving(true);
    try {
      const keyPayload = Object.fromEntries(
        Object.entries(keys).filter(([, v]) => v.trim() !== ''),
      );
      const res = await fetchWithCsrf('/api/admin/voice-model', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, ...keyPayload }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? 'Error');
        return;
      }
      setConfig(json.config as VoiceModelConfig);
      setKeys({ stt_api_key: '', llm_api_key: '', tts_api_key: '', realtime_api_key: '' });
      setAutoFixed((json.changes ?? []) as CompatChange[]);
      toast.success(t('voice.adminSaved'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loading />;

  if (forbidden) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20 text-center text-muted-foreground">
        <ShieldAlert className="h-8 w-8" />
        <p className="text-sm">{t('voice.adminForbidden')}</p>
      </div>
    );
  }

  if (failed || !config) return <LoadError onRetry={load} />;

  const isRealtime = config.mode === 'realtime';

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('voice.adminTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('voice.adminDesc')}</p>
      </div>

      {/* Resumen del stack ACTIVO (lo que corre en las llamadas ahora) */}
      <div className="rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Activo: </span>
        {config.mode === 'realtime'
          ? `realtime · ${config.realtime_provider ?? '—'} / ${config.realtime_model ?? '—'}`
          : `pipeline · STT ${config.stt_provider}/${config.stt_model} · LLM ${config.llm_provider}/${config.llm_model} · TTS ${config.tts_provider}/${config.tts_model}`}
      </div>

      {/* Qué se ajustó solo en el último guardado (cambio de proveedor). */}
      {autoFixed.length > 0 && (
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-3 text-xs">
          <p className="font-medium text-foreground">{t('voice.adminAutoFixed')}</p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {autoFixed.map((c, i) => (
              <li key={`${c.layer}-${c.field}-${i}`}>{describeChange(c, locale)}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Mode */}
      <section className="rounded-xl border border-border bg-card p-4">
        <p className="mb-2 text-sm font-medium text-foreground">{t('voice.adminMode')}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => set({ mode: 'pipeline' })}
            className={`rounded-lg border p-3 text-left ${
              !isRealtime ? 'border-primary bg-primary/5' : 'border-border bg-muted/40'
            }`}
          >
            <p className="text-sm font-medium text-foreground">{t('voice.adminModePipeline')}</p>
            <p className="text-xs text-muted-foreground">{t('voice.adminPipelineHint')}</p>
          </button>
          <button
            type="button"
            onClick={() => set({ mode: 'realtime' })}
            className={`rounded-lg border p-3 text-left ${
              isRealtime ? 'border-primary bg-primary/5' : 'border-border bg-muted/40'
            }`}
          >
            <p className="text-sm font-medium text-foreground">{t('voice.adminModeRealtime')}</p>
            <p className="text-xs text-muted-foreground">{t('voice.adminRealtimeHint')}</p>
          </button>
        </div>
      </section>

      {!isRealtime ? (
        <>
          <LayerSection
            title={t('voice.adminStt')}
            layer="stt"
            provider={config.stt_provider}
            model={config.stt_model}
            onProvider={(p, m) => changeProvider('stt', p, m)}
            onModel={(m) => set({ stt_model: m })}
            providerLabel={t('voice.adminProvider')}
            modelLabel={t('voice.adminModel')}
          >
            <Row label={t('voice.adminLanguage')}>
              <Input value={config.stt_language} onChange={(e) => set({ stt_language: e.target.value })} />
            </Row>
            <EndpointKey
              t={t}
              baseUrl={config.stt_base_url}
              onBaseUrl={(v) => set({ stt_base_url: v })}
              hasKey={config.has_stt_key}
              keyVal={keys.stt_api_key}
              onKey={(v) => setKeys((k) => ({ ...k, stt_api_key: v }))}
            />
          </LayerSection>

          <LayerSection
            title={t('voice.adminLlm')}
            layer="llm"
            provider={config.llm_provider}
            model={config.llm_model}
            onProvider={(p, m) => changeProvider('llm', p, m)}
            onModel={(m) => set({ llm_model: m })}
            providerLabel={t('voice.adminProvider')}
            modelLabel={t('voice.adminModel')}
          >
            <EndpointKey
              t={t}
              baseUrl={config.llm_base_url}
              onBaseUrl={(v) => set({ llm_base_url: v })}
              hasKey={config.has_llm_key}
              keyVal={keys.llm_api_key}
              onKey={(v) => setKeys((k) => ({ ...k, llm_api_key: v }))}
            />
          </LayerSection>

          <LayerSection
            title={t('voice.adminTts')}
            layer="tts"
            provider={config.tts_provider}
            model={config.tts_model}
            onProvider={(p, m) => changeProvider('tts', p, m)}
            onModel={(m) => set({ tts_model: m })}
            providerLabel={t('voice.adminProvider')}
            modelLabel={t('voice.adminModel')}
          >
            <VoiceField
              t={t}
              layer="tts"
              provider={config.tts_provider}
              value={config.tts_default_voice_id}
              onChange={(v) => set({ tts_default_voice_id: v })}
            />
            <EndpointKey
              t={t}
              baseUrl={config.tts_base_url}
              onBaseUrl={(v) => set({ tts_base_url: v })}
              hasKey={config.has_tts_key}
              keyVal={keys.tts_api_key}
              onKey={(v) => setKeys((k) => ({ ...k, tts_api_key: v }))}
            />
          </LayerSection>
        </>
      ) : (
        <LayerSection
          title={t('voice.adminRealtime')}
          layer="realtime"
          provider={config.realtime_provider ?? ''}
          model={config.realtime_model ?? ''}
          onProvider={(p, m) => changeProvider('realtime', p, m)}
          onModel={(m) => set({ realtime_model: m || null })}
          providerLabel={t('voice.adminProvider')}
          modelLabel={t('voice.adminModel')}
        >
          <VoiceField
            t={t}
            layer="realtime"
            provider={config.realtime_provider}
            value={config.tts_default_voice_id}
            onChange={(v) => set({ tts_default_voice_id: v })}
          />
          <EndpointKey
            t={t}
            baseUrl={config.realtime_base_url}
            onBaseUrl={(v) => set({ realtime_base_url: v })}
            hasKey={config.has_realtime_key}
            keyVal={keys.realtime_api_key}
            onKey={(v) => setKeys((k) => ({ ...k, realtime_api_key: v }))}
          />
        </LayerSection>
      )}

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t('voice.adminSave')}
        </Button>
      </div>
    </div>
  );
}

/** A layer card: provider select → model select → extra rows (children). */
function LayerSection({
  title,
  layer,
  provider,
  model,
  onProvider,
  onModel,
  providerLabel,
  modelLabel,
  children,
}: {
  title: string;
  layer: keyof typeof LAYER_PROVIDERS;
  provider: string;
  model: string;
  onProvider: (provider: string, model: string) => void;
  onModel: (model: string) => void;
  providerLabel: string;
  modelLabel: string;
  children?: React.ReactNode;
}) {
  const t = useT();
  const providers = LAYER_PROVIDERS[layer];
  const opt: ProviderOption | undefined = providers.find((p) => p.id === provider);
  const models = modelsFor(layer, provider);
  const known = providers.some((p) => p.id === provider);
  // Cuando el modelo actual no está en la lista sugerida, mostramos "custom".
  const modelKnown = models.some((m) => m.id === model);

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <p className="mb-3 text-sm font-medium text-foreground">{title}</p>
      <div className="space-y-3">
        <Row label={providerLabel}>
          <Select
            value={known ? provider : '__custom__'}
            onChange={(v) => {
              if (v === '__custom__') {
                onProvider('', model);
                return;
              }
              // Al cambiar de proveedor, sugerí su primer modelo.
              const first = modelsFor(layer, v)[0]?.id ?? '';
              onProvider(v, first);
            }}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            <option value="__custom__">{t('admin.voiceCustom')}</option>
          </Select>
        </Row>
        {opt?.note ? (
          <p className="text-xs text-muted-foreground sm:pl-[160px]">{opt.note}</p>
        ) : null}

        {known ? (
          <Row label={modelLabel}>
            <Select
              value={modelKnown ? model : '__custom__'}
              onChange={(v) => onModel(v === '__custom__' ? '' : v)}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              <option value="__custom__">{t('admin.voiceCustom')}</option>
            </Select>
          </Row>
        ) : (
          <Row label={providerLabel}>
            <Input placeholder={t('admin.voiceProviderId')} value={provider} onChange={(e) => onProvider(e.target.value, model)} />
          </Row>
        )}

        {(!known || !modelKnown) && (
          <Row label={modelLabel}>
            <Input value={model} onChange={(e) => onModel(e.target.value)} placeholder={t('admin.voiceModelId')} />
          </Row>
        )}

        {children}
      </div>
    </section>
  );
}

/**
 * Voz por defecto de la plataforma. Cada proveedor nombra sus voces distinto,
 * así que el campo se adapta: desaparece cuando la voz va en el modelo
 * (Deepgram Aura) y avisa en el momento si el valor no es de este proveedor,
 * en vez de dejar que se descubra con una llamada muda.
 */
function VoiceField({
  t,
  layer,
  provider,
  value,
  onChange,
}: {
  t: (k: string) => string;
  layer: 'tts' | 'realtime';
  provider: string | null;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const opt = providerOption(layer, provider);
  if (opt?.voiceInModel) {
    return (
      <p className="text-xs text-muted-foreground sm:pl-[160px]">
        {t('voice.adminVoiceInModel')}
      </p>
    );
  }
  const invalid = !!value && !isValidVoice(opt, value);
  return (
    <>
      <Row label={t('voice.adminDefaultVoice')}>
        <Input
          placeholder={opt?.voiceHint ?? ''}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
        />
      </Row>
      {invalid && (
        <p className="text-xs text-destructive sm:pl-[160px]">
          {t('voice.adminVoiceInvalid')}
        </p>
      )}
      {opt?.voiceIds && (
        <p className="text-xs text-muted-foreground sm:pl-[160px]">
          {opt.voiceIds.join(' · ')}
        </p>
      )}
    </>
  );
}

function EndpointKey({
  t,
  baseUrl,
  onBaseUrl,
  hasKey,
  keyVal,
  onKey,
}: {
  t: (k: string) => string;
  baseUrl: string | null;
  onBaseUrl: (v: string | null) => void;
  hasKey: boolean;
  keyVal: string;
  onKey: (v: string) => void;
}) {
  return (
    <>
      <Row label={t('voice.adminEndpoint')}>
        <Input
          placeholder={t('voice.adminEndpointHint')}
          value={baseUrl ?? ''}
          onChange={(e) => onBaseUrl(e.target.value || null)}
        />
      </Row>
      <Row label={t('voice.adminApiKey')}>
        <Input
          type="password"
          placeholder={hasKey ? '••••••••' : t('voice.adminKeyEnvHint')}
          value={keyVal}
          onChange={(e) => onKey(e.target.value)}
        />
      </Row>
      {!hasKey ? (
        <p className="text-xs text-muted-foreground sm:pl-[160px]">
          {t('voice.adminKeyEnvNote')}
        </p>
      ) : null}
    </>
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {children}
    </select>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-1 gap-1 sm:grid-cols-[160px_1fr] sm:items-center">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
