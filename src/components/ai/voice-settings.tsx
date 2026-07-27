'use client';

import { useRef, useState } from 'react';
import { Play, Square, Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { useT } from '@/hooks/use-locale';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { cn } from '@/lib/utils';
import type { VoiceCallingHours, VoiceCallType, VoiceObjectives } from '@/types';
import {
  CURATED_VOICES,
  DEFAULT_CALLING_HOURS,
  DEFAULT_MAX_CALL_SECONDS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_DELAY_MINUTES,
} from '@/lib/voice/constants';

export interface VoiceState {
  voice_enabled: boolean;
  voice_ai_decides: boolean;
  voice_id: string | null;
  voice_greeting: string;
  voice_objectives: VoiceObjectives;
  voice_max_call_seconds: number;
  voice_calling_hours: VoiceCallingHours;
  voice_max_retries: number;
  voice_retry_delay_minutes: number;
}

export function initialVoiceState(agent?: {
  voice_enabled?: boolean;
  voice_ai_decides?: boolean;
  voice_id?: string | null;
  voice_greeting?: string | null;
  voice_objectives?: VoiceObjectives | null;
  voice_max_call_seconds?: number;
  voice_calling_hours?: VoiceCallingHours | null;
  voice_max_retries?: number;
  voice_retry_delay_minutes?: number;
}): VoiceState {
  return {
    voice_enabled: agent?.voice_enabled ?? false,
    voice_ai_decides: agent?.voice_ai_decides ?? false,
    voice_id: agent?.voice_id ?? null,
    voice_greeting: agent?.voice_greeting ?? '',
    voice_objectives: agent?.voice_objectives ?? {},
    voice_max_call_seconds: agent?.voice_max_call_seconds ?? DEFAULT_MAX_CALL_SECONDS,
    voice_calling_hours: agent?.voice_calling_hours ?? DEFAULT_CALLING_HOURS,
    voice_max_retries: agent?.voice_max_retries ?? DEFAULT_MAX_RETRIES,
    voice_retry_delay_minutes:
      agent?.voice_retry_delay_minutes ?? DEFAULT_RETRY_DELAY_MINUTES,
  };
}

const OBJECTIVE_TYPES: { type: VoiceCallType; labelKey: string }[] = [
  { type: 'order_confirmation', labelKey: 'voice.objOrderConfirmation' },
  { type: 'cart_recovery', labelKey: 'voice.objCartRecovery' },
  { type: 'followup', labelKey: 'voice.objFollowup' },
  { type: 'inbound', labelKey: 'voice.objInbound' },
];

const DAY_KEYS: { day: number; key: string }[] = [
  { day: 1, key: 'voice.dayMon' },
  { day: 2, key: 'voice.dayTue' },
  { day: 3, key: 'voice.dayWed' },
  { day: 4, key: 'voice.dayThu' },
  { day: 5, key: 'voice.dayFri' },
  { day: 6, key: 'voice.daySat' },
  { day: 7, key: 'voice.daySun' },
];

export function VoiceSettings({
  value,
  onChange,
  language,
  workspaceId,
}: {
  value: VoiceState;
  onChange: (v: VoiceState) => void;
  language: string;
  workspaceId?: string;
}) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [previewing, setPreviewing] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [setupText, setSetupText] = useState('');
  const [setupLoading, setSetupLoading] = useState(false);
  // Opciones avanzadas ocultas por defecto — el 95% de los usuarios no las toca.
  const [showAdvanced, setShowAdvanced] = useState(false);

  const set = (patch: Partial<VoiceState>) => onChange({ ...value, ...patch });

  async function aiSetup() {
    if (!workspaceId || !setupText.trim()) return;
    setSetupLoading(true);
    try {
      const res = await fetchWithCsrf('/api/ai/agents/voice-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          description: setupText.trim(),
          language,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? t('voice.setupError'));
        return;
      }
      const c = json.config as {
        voice_enabled: boolean;
        voice_ai_decides: boolean;
        voice_greeting: string;
        objectives: VoiceObjectives;
      };
      onChange({
        ...value,
        voice_enabled: c.voice_enabled ?? true,
        voice_ai_decides: Boolean(c.voice_ai_decides),
        voice_greeting: c.voice_greeting || value.voice_greeting,
        voice_objectives: { ...value.voice_objectives, ...c.objectives },
      });
      setSetupText('');
      toast.success(t('voice.setupApplied'));
    } finally {
      setSetupLoading(false);
    }
  }

  async function preview(voiceId: string) {
    if (previewing) {
      audioRef.current?.pause();
      setPreviewing(null);
      return;
    }
    setPreviewing(voiceId);
    try {
      const res = await fetch('/api/voice/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice_id: voiceId, language }),
      });
      if (!res.ok) {
        setPreviewing(null);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        setPreviewing(null);
        URL.revokeObjectURL(url);
      };
      await audio.play();
    } catch {
      setPreviewing(null);
    }
  }

  function setObjective(
    type: VoiceCallType,
    patch: { enabled?: boolean; objective?: string; extra_instructions?: string },
  ) {
    const prev = value.voice_objectives[type] ?? { enabled: false, objective: '' };
    set({
      voice_objectives: {
        ...value.voice_objectives,
        [type]: { ...prev, ...patch },
      },
    });
  }

  function setUpsell(patch: { enabled?: boolean; offer_text?: string; discount?: string }) {
    const oc = value.voice_objectives.order_confirmation ?? { enabled: false, objective: '' };
    const prevUpsell = oc.upsell ?? { enabled: false };
    set({
      voice_objectives: {
        ...value.voice_objectives,
        order_confirmation: { ...oc, upsell: { ...prevUpsell, ...patch } },
      },
    });
  }

  // Fin <= inicio significa turno noche: la franja sigue hasta el día
  // siguiente (22:00 → 02:00). Lo decimos en el sitio para que no parezca
  // un dato mal cargado.
  const crossesMidnight =
    value.voice_calling_hours.start >= value.voice_calling_hours.end;
  const noDays = value.voice_calling_hours.days.length === 0;

  function toggleDay(day: number) {
    const days = value.voice_calling_hours.days.includes(day)
      ? value.voice_calling_hours.days.filter((d) => d !== day)
      : [...value.voice_calling_hours.days, day].sort((a, b) => a - b);
    set({ voice_calling_hours: { ...value.voice_calling_hours, days } });
  }

  return (
    <div className="space-y-6">
      {/* Enable */}
      <div className="flex items-start justify-between gap-4">
        {/* La explicación vive en el encabezado de la tarjeta ("Voz"); aquí
            solo la etiqueta del switch, para no repetir la misma frase. */}
        <p className="text-sm font-medium text-foreground">{t('voice.enable')}</p>
        <Switch
          checked={value.voice_enabled}
          onCheckedChange={(c) => set({ voice_enabled: c })}
        />
      </div>

      {value.voice_enabled && (
        <>
          {/* AI-assisted setup — describe it in words, we fill the form. */}
          {workspaceId && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <div className="mb-1 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium text-foreground">{t('voice.setupTitle')}</p>
              </div>
              <p className="mb-2 text-xs text-muted-foreground">{t('voice.setupHint')}</p>
              <Textarea
                className="min-h-16 bg-background text-foreground"
                placeholder={t('voice.setupPlaceholder')}
                value={setupText}
                onChange={(e) => setSetupText(e.target.value)}
              />
              <div className="mt-2 flex justify-end">
                <Button size="sm" onClick={aiSetup} disabled={setupLoading || !setupText.trim()}>
                  {setupLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Sparkles className="mr-1 h-3.5 w-3.5" />
                      {t('voice.setupApply')}
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Voice picker */}
          <div>
            <p className="mb-1 text-sm font-medium text-foreground">{t('voice.voiceLabel')}</p>
            <p className="mb-2 text-xs text-muted-foreground">{t('voice.voicePickHint')}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {CURATED_VOICES.map((v) => {
                const selected = value.voice_id === v.voice_id;
                return (
                  <div
                    key={v.voice_id}
                    className={cn(
                      'flex items-center justify-between rounded-lg border px-3 py-2',
                      selected
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-muted/40',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => set({ voice_id: v.voice_id })}
                      className="flex-1 text-left"
                    >
                      <p className="text-sm text-foreground">{v.label}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {v.locale} · {v.gender === 'female' ? '♀' : '♂'}
                      </p>
                    </button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => preview(v.voice_id)}
                    >
                      {previewing === v.voice_id ? (
                        <Square className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Greeting */}
          <div>
            <p className="mb-1 text-sm font-medium text-foreground">{t('voice.greeting')}</p>
            <p className="mb-2 text-xs text-muted-foreground">{t('voice.greetingHint')}</p>
            <Textarea
              className="min-h-16 bg-muted text-foreground"
              value={value.voice_greeting}
              onChange={(e) => set({ voice_greeting: e.target.value })}
            />
          </div>

          {/* Objectives */}
          <div>
            <p className="mb-1 text-sm font-medium text-foreground">{t('voice.objectives')}</p>
            <p className="mb-2 text-xs text-muted-foreground">{t('voice.objectivesHint')}</p>
            <div className="space-y-3">
              {OBJECTIVE_TYPES.map(({ type, labelKey }) => {
                const obj = value.voice_objectives[type];
                return (
                  <div key={type} className="rounded-lg border border-border bg-muted/40 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm text-foreground">{t(labelKey)}</p>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        {t('voice.objEnabled')}
                        <Switch
                          checked={obj?.enabled ?? false}
                          onCheckedChange={(c) => setObjective(type, { enabled: c })}
                        />
                      </label>
                    </div>
                    {obj?.enabled && (
                      <div className="space-y-2">
                        <Textarea
                          className="min-h-14 bg-background text-foreground"
                          placeholder={t('voice.objPlaceholder')}
                          value={obj?.objective ?? ''}
                          onChange={(e) => setObjective(type, { objective: e.target.value })}
                        />
                        <Textarea
                          className="min-h-12 bg-background text-foreground"
                          placeholder={t('voice.extraInstructions')}
                          value={obj?.extra_instructions ?? ''}
                          onChange={(e) =>
                            setObjective(type, { extra_instructions: e.target.value })
                          }
                        />
                      </div>
                    )}
                    {/* Upsell — only on order confirmation. */}
                    {type === 'order_confirmation' && obj?.enabled && (
                      <div className="mt-3 rounded-md border border-border/60 bg-background p-2.5">
                        <label className="flex items-center justify-between">
                          <span className="text-xs font-medium text-foreground">
                            {t('voice.upsellLabel')}
                          </span>
                          <Switch
                            checked={obj?.upsell?.enabled ?? false}
                            onCheckedChange={(c) => setUpsell({ enabled: c })}
                          />
                        </label>
                        {obj?.upsell?.enabled && (
                          <div className="mt-2 space-y-2">
                            <Textarea
                              className="min-h-12 bg-muted text-foreground"
                              placeholder={t('voice.upsellOfferPlaceholder')}
                              value={obj?.upsell?.offer_text ?? ''}
                              onChange={(e) => setUpsell({ offer_text: e.target.value })}
                            />
                            <Input
                              className="bg-muted text-foreground"
                              placeholder={t('voice.upsellDiscountPlaceholder')}
                              value={obj?.upsell?.discount ?? ''}
                              onChange={(e) => setUpsell({ discount: e.target.value })}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* AI decides when to call */}
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/40 p-3">
            <div>
              <p className="text-sm font-medium text-foreground">{t('voice.aiDecides')}</p>
              <p className="text-xs text-muted-foreground">{t('voice.aiDecidesHint')}</p>
            </div>
            <Switch
              checked={value.voice_ai_decides}
              onCheckedChange={(c) => set({ voice_ai_decides: c })}
            />
          </div>

          {/* Calling hours */}
          <div>
            <p className="mb-1 text-sm font-medium text-foreground">{t('voice.callingHours')}</p>
            <p className="mb-2 text-xs text-muted-foreground">{t('voice.callingHoursHint')}</p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                {t('voice.from')}
                <Input
                  type="time"
                  className="w-28 bg-muted text-foreground"
                  value={value.voice_calling_hours.start}
                  onChange={(e) =>
                    set({
                      voice_calling_hours: { ...value.voice_calling_hours, start: e.target.value },
                    })
                  }
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                {t('voice.to')}
                <Input
                  type="time"
                  className="w-28 bg-muted text-foreground"
                  value={value.voice_calling_hours.end}
                  onChange={(e) =>
                    set({
                      voice_calling_hours: { ...value.voice_calling_hours, end: e.target.value },
                    })
                  }
                />
              </label>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {DAY_KEYS.map(({ day, key }) => {
                const on = value.voice_calling_hours.days.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs',
                      on
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {t(key)}
                  </button>
                );
              })}
            </div>
            {noDays ? (
              <p className="mt-2 text-xs text-destructive">{t('voice.hoursNoDays')}</p>
            ) : crossesMidnight ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {t('voice.hoursOvernight')}
              </p>
            ) : null}
          </div>

          {/* Opciones avanzadas — ocultas por defecto para no abrumar. */}
          <div className="border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {showAdvanced ? '−' : '+'} {t('voice.advanced')}
            </button>
            {showAdvanced && (
              <div className="mt-3 space-y-4">
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    {t('voice.customVoiceId')}
                  </p>
                  <Input
                    className="bg-muted text-foreground"
                    placeholder={t('voice.customVoiceId')}
                    value={
                      value.voice_id && !CURATED_VOICES.some((v) => v.voice_id === value.voice_id)
                        ? value.voice_id
                        : ''
                    }
                    onChange={(e) => set({ voice_id: e.target.value.trim() || null })}
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      {t('voice.maxDuration')}
                    </p>
                    <Input
                      type="number"
                      min={30}
                      max={1800}
                      className="bg-muted text-foreground"
                      value={value.voice_max_call_seconds}
                      onChange={(e) =>
                        set({
                          voice_max_call_seconds:
                            Number(e.target.value) || DEFAULT_MAX_CALL_SECONDS,
                        })
                      }
                    />
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      {t('voice.retries')}
                    </p>
                    <Input
                      type="number"
                      min={0}
                      max={5}
                      className="bg-muted text-foreground"
                      value={value.voice_max_retries}
                      onChange={(e) => set({ voice_max_retries: Number(e.target.value) || 0 })}
                    />
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      {t('voice.retryDelay')}
                    </p>
                    <Input
                      type="number"
                      min={15}
                      max={1440}
                      className="bg-muted text-foreground"
                      value={value.voice_retry_delay_minutes}
                      onChange={(e) =>
                        set({
                          voice_retry_delay_minutes:
                            Number(e.target.value) || DEFAULT_RETRY_DELAY_MINUTES,
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
