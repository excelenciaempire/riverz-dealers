'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Play, Square, Sparkles, Loader2, PhoneCall } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { VoiceStatusLine } from '@/components/voice/voice-status-line';
import { useT, useLocale } from '@/hooks/use-locale';
import { useVoiceReadiness } from '@/hooks/use-voice-readiness';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { cn } from '@/lib/utils';
import type { VoiceCallingHours, VoiceCallType, VoiceObjectives } from '@/types';
import {
  type CuratedVoice,
  DEFAULT_CALLING_HOURS,
  DEFAULT_GREETINGS,
  DEFAULT_MAX_CALL_SECONDS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_OBJECTIVES,
  DEFAULT_RETRY_DELAY_MINUTES,
} from '@/lib/voice/constants';
import { VOICE_TYPE_KEY } from '@/lib/voice/labels';

export interface VoiceState {
  voice_enabled: boolean;
  voice_ai_decides: boolean;
  voice_id: string | null;
  voice_greeting: string;
  voice_system_prompt: string;
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
  voice_system_prompt?: string | null;
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
    voice_system_prompt: agent?.voice_system_prompt ?? '',
    voice_objectives: agent?.voice_objectives ?? {},
    voice_max_call_seconds: agent?.voice_max_call_seconds ?? DEFAULT_MAX_CALL_SECONDS,
    voice_calling_hours: agent?.voice_calling_hours ?? DEFAULT_CALLING_HOURS,
    voice_max_retries: agent?.voice_max_retries ?? DEFAULT_MAX_RETRIES,
    voice_retry_delay_minutes:
      agent?.voice_retry_delay_minutes ?? DEFAULT_RETRY_DELAY_MINUTES,
  };
}

/**
 * Los cuatro momentos en que este agente puede hablar por teléfono.
 *
 * Las etiquetas salen de `VOICE_TYPE_KEY`, el mismo mapa que usa el registro
 * de llamadas: antes había un juego de nombres acá y otro allá para los mismos
 * cinco conceptos, así que agregar un tipo obligaba a acordarse de las dos
 * listas y "Seguimiento" podía llamarse distinto según la pantalla.
 */
const OBJECTIVE_TYPES: { type: VoiceCallType; labelKey: string }[] = [
  'order_confirmation',
  'cart_recovery',
  'followup',
  'inbound',
].map((type) => ({
  type: type as VoiceCallType,
  labelKey: VOICE_TYPE_KEY[type as VoiceCallType],
}));

/** Cuántas veces vuelve a marcar si no contestan. Lo único de la vieja
 *  sección "Avanzado" que es una decisión del negocio y no de ingeniería. */
const RETRY_CHOICES: { retries: number; labelKey: string }[] = [
  { retries: 0, labelKey: 'voice.retriesNone' },
  { retries: 1, labelKey: 'voice.retriesOnce' },
  { retries: 2, labelKey: 'voice.retriesTwice' },
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

/** ¿El horario o los reintentos difieren del default? Entonces se abre solo. */
function tocado(v: VoiceState): boolean {
  const h = v.voice_calling_hours;
  return (
    v.voice_ai_decides ||
    v.voice_max_retries !== DEFAULT_MAX_RETRIES ||
    h.start !== DEFAULT_CALLING_HOURS.start ||
    h.end !== DEFAULT_CALLING_HOURS.end ||
    h.days.length !== DEFAULT_CALLING_HOURS.days.length
  );
}

/**
 * La pestaña de Llamadas de un agente.
 *
 * Al prender el interruptor aparecían diez decisiones de golpe: una línea de
 * datos, la caja de setup con IA, la de llamada de prueba, cuatro voces, el
 * saludo, cuatro objetivos con interruptor y caja de texto, el upsell anidado,
 * «la IA decide», dos horas más siete días, y tres opciones de reintento.
 * Todo con el mismo peso, para algo cuyos valores por defecto ya funcionan.
 *
 * Ahora son tres alturas: qué se escucha (siempre), qué dice en cada tipo de
 * llamada (plegado, con el guion por defecto a la vista) y cuándo insiste
 * (plegado, se abre solo si alguien lo tocó). Las dos acciones —armarlo con IA
 * y probarlo— quedan en las puntas: la primera es el camino corto, la segunda
 * es lo último que uno hace.
 *
 * Y dos controles dejaron de mentir. Los interruptores de objetivo NO
 * disparaban nada: `voice_objectives[tipo].enabled` no lo lee nadie desde que
 * el nodo del lienzo quedó como única vía automática. Y el selector de voz
 * ofrecía voces de ElevenLabs mientras la plataforma sintetiza con otro
 * proveedor, así que la elección se descartaba y las cuatro sonaban igual.
 */
export function VoiceSettings({
  value,
  onChange,
  language,
  workspaceId,
  agentId,
}: {
  value: VoiceState;
  onChange: (v: VoiceState) => void;
  language: string;
  workspaceId?: string;
  /** null en un agente que todavía no se guardó: sin id no se puede llamar. */
  agentId?: string | null;
}) {
  const t = useT();
  const { locale } = useLocale();
  const fetchWithCsrf = useFetchWithCsrf();
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState('');
  const [calling, setCalling] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [setupText, setSetupText] = useState('');
  const [setupLoading, setSetupLoading] = useState(false);
  const [voces, setVoces] = useState<CuratedVoice[] | null>(null);
  const [verVoces, setVerVoces] = useState(false);
  const [verGuiones, setVerGuiones] = useState(false);
  const [verCuando, setVerCuando] = useState(() => tocado(value));

  const { readiness, loading: cargandoEstado } = useVoiceReadiness(
    value.voice_enabled ? workspaceId : undefined,
    agentId,
  );

  // Las voces del proveedor que la plataforma tiene activo hoy. Sin esto el
  // selector ofrecía una elección que el motor descartaba.
  useEffect(() => {
    if (!workspaceId || !value.voice_enabled) return;
    let cancelado = false;
    (async () => {
      const res = await fetch(`/api/voice/voices?workspace_id=${workspaceId}`, {
        cache: 'no-store',
      });
      if (!res.ok || cancelado) return;
      const json = (await res.json()) as { voices: CuratedVoice[] };
      if (!cancelado) setVoces(json.voices ?? []);
    })();
    return () => {
      cancelado = true;
    };
  }, [workspaceId, value.voice_enabled]);

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
      // Lo que la IA escribió se abre a la vista: aplicar algo que no se ve es
      // pedirle al comercio que confíe sin mirar.
      setVerGuiones(true);
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

  async function testCall() {
    if (!workspaceId || !agentId || !testPhone.trim()) return;
    setCalling(true);
    try {
      const res = await fetchWithCsrf('/api/voice/test-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          agent_id: agentId,
          phone: testPhone.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        // El motivo viene del mismo control que frena las llamadas reales
        // (kill switch, sin número, opt-out): mostrarlo tal cual es más útil
        // que un "error" genérico.
        toast.error(json.error ?? t('voice.callFailed'));
        return;
      }
      toast.success(t('voice.testCallQueued'));
    } finally {
      setCalling(false);
    }
  }

  function setObjective(
    type: VoiceCallType,
    patch: { objective?: string; extra_instructions?: string },
  ) {
    const prev = value.voice_objectives[type] ?? { enabled: true, objective: '' };
    set({
      voice_objectives: {
        ...value.voice_objectives,
        // `enabled` se sigue guardando en true por compatibilidad con lo que ya
        // está en la base; NADIE lo lee. El guion es lo que manda.
        [type]: { ...prev, enabled: true, ...patch },
      },
    });
  }

  function setUpsell(patch: { enabled?: boolean; offer_text?: string; discount?: string }) {
    const oc = value.voice_objectives.order_confirmation ?? { enabled: true, objective: '' };
    const prevUpsell = oc.upsell ?? { enabled: false };
    set({
      voice_objectives: {
        ...value.voice_objectives,
        order_confirmation: { ...oc, enabled: true, upsell: { ...prevUpsell, ...patch } },
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

  const idioma = language === 'en' || locale === 'en' ? 'en' : 'es';
  const vozElegida = (voces ?? []).find((v) => v.voice_id === value.voice_id);

  if (!value.voice_enabled) return <div />;

  return (
    <div className="space-y-6">
      {/* Si este agente puede atender el teléfono, y si no, por qué. Antes acá
          había una línea de datos que sólo sabía decir el número: si el agente
          estaba pausado o no había número, se callaba. */}
      <VoiceStatusLine readiness={readiness} loading={cargandoEstado} />

      {/* Armarlo hablando. Es el camino corto, así que va primero: estaba en el
          medio del formulario, después de la caja de probar. */}
      {workspaceId && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="mb-1 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent-ink" />
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

      {/* ── Cómo suena ── */}
      {voces !== null && voces.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-medium text-foreground">{t('voice.voiceLabel')}</p>
          {/* Una fila con la elegida, no cuatro tarjetas apiladas. */}
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2">
            <span className="text-sm text-foreground">
              {vozElegida ? vozElegida.label : t('voice.voiceDefault')}
            </span>
            <button
              type="button"
              onClick={() => setVerVoces((v) => !v)}
              className="text-xs text-accent-ink hover:underline"
            >
              {t('voice.numberChange')}
            </button>
          </div>
          {verVoces && (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {voces.map((v) => {
                const selected = value.voice_id === v.voice_id;
                return (
                  <div
                    key={v.voice_id}
                    className={cn(
                      'flex items-center justify-between rounded-lg border px-3 py-2',
                      selected ? 'border-primary bg-primary/5' : 'border-border bg-muted/40',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        set({ voice_id: v.voice_id });
                        setVerVoces(false);
                      }}
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
          )}
        </div>
      )}
      {voces !== null && voces.length === 0 && (
        // Sin curaduría para el proveedor activo no se dibuja un selector falso.
        <p className="text-xs text-muted-foreground">{t('voice.voicePlatform')}</p>
      )}

      <div>
        <p className="mb-1 text-sm font-medium text-foreground">{t('voice.greeting')}</p>
        <p className="mb-2 text-xs text-muted-foreground">{t('voice.greetingHint')}</p>
        <Textarea
          className="min-h-16 bg-muted text-foreground"
          // El placeholder muestra el saludo que YA usa el worker cuando esto
          // está vacío. Un recuadro en blanco hacía pensar que no saluda.
          placeholder={DEFAULT_GREETINGS[idioma]}
          value={value.voice_greeting}
          onChange={(e) => set({ voice_greeting: e.target.value })}
        />
      </div>

      {/* ── Qué dice en cada tipo de llamada. Plegado: tiene guiones que
             funcionan y casi nadie los toca. ── */}
      <Plegable
        titulo={t('voice.objectives')}
        ayuda={t('voice.objectivesHint')}
        abierto={verGuiones}
        alternar={() => setVerGuiones((v) => !v)}
      >
        <div className="space-y-3">
          {OBJECTIVE_TYPES.map(({ type, labelKey }) => {
            const obj = value.voice_objectives[type];
            return (
              <div key={type} className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="mb-2 text-sm text-foreground">{t(labelKey)}</p>
                <Textarea
                  className="min-h-14 bg-background text-foreground"
                  // El guion por defecto, a la vista. Antes había que prender un
                  // interruptor para ver una caja vacía y adivinar qué escribir.
                  placeholder={DEFAULT_OBJECTIVES[type][idioma]}
                  value={obj?.objective ?? ''}
                  onChange={(e) => setObjective(type, { objective: e.target.value })}
                />
                {/* Sólo si YA tiene algo escrito: los agentes viejos no pierden
                    lo que cargaron, pero nadie empieza a llenar dos cajas. */}
                {(obj?.extra_instructions ?? '').trim() !== '' && (
                  <Textarea
                    className="mt-2 min-h-12 bg-background text-foreground"
                    placeholder={t('voice.extraInstructions')}
                    value={obj?.extra_instructions ?? ''}
                    onChange={(e) => setObjective(type, { extra_instructions: e.target.value })}
                  />
                )}
                {type === 'followup' && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {t('voice.objFollowupSharedDelay')}
                  </p>
                )}
                {/* El upsell sí hace algo: `context.ts` lo lee y le da al agente
                    la herramienta de editar el pedido. Por eso conserva su
                    interruptor, a diferencia de los de objetivo. */}
                {type === 'order_confirmation' && (
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
      </Plegable>

      {/* ── Cuándo insiste. Plegado, salvo que alguien ya lo haya tocado. ── */}
      <Plegable
        titulo={t('voice.whenGroup')}
        ayuda={t('voice.whenGroupHint')}
        abierto={verCuando}
        alternar={() => setVerCuando((v) => !v)}
      >
        <div className="space-y-5">
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
                      on ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
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
              <p className="mt-2 text-xs text-muted-foreground">{t('voice.hoursOvernight')}</p>
            ) : null}
          </div>

          <div>
            <p className="mb-1 text-sm font-medium text-foreground">{t('voice.retries')}</p>
            <p className="mb-2 text-xs text-muted-foreground">{t('voice.retriesHint')}</p>
            <div className="flex flex-wrap gap-1.5">
              {RETRY_CHOICES.map(({ retries, labelKey }) => {
                const on = value.voice_max_retries === retries;
                return (
                  <button
                    key={retries}
                    type="button"
                    onClick={() =>
                      set({
                        voice_max_retries: retries,
                        voice_retry_delay_minutes:
                          value.voice_retry_delay_minutes || DEFAULT_RETRY_DELAY_MINUTES,
                      })
                    }
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs',
                      on ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {t(labelKey)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Plegable>

      {/* Probarlo es lo último que uno hace, así que va último. */}
      {workspaceId && (
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="mb-2 text-sm font-medium text-foreground">{t('voice.testCall')}</p>
          {!agentId && (
            <p className="mb-2 text-xs text-muted-foreground">{t('voice.testCallSaveFirst')}</p>
          )}
          <div className="flex gap-2">
            <Input
              type="tel"
              className="bg-background text-foreground"
              placeholder={t('voice.testCallPlaceholder')}
              value={testPhone}
              disabled={!agentId}
              onChange={(e) => setTestPhone(e.target.value)}
            />
            <Button
              type="button"
              onClick={testCall}
              disabled={!agentId || calling || !testPhone.trim()}
            >
              {calling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <PhoneCall className="mr-1 h-3.5 w-3.5" />
                  {t('voice.testCall')}
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Bloque plegado. Mismo gesto que usa la tarjeta de comportamiento en /voz. */
function Plegable({
  titulo,
  ayuda,
  abierto,
  alternar,
  children,
}: {
  titulo: string;
  ayuda: string;
  abierto: boolean;
  alternar: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={alternar}
        className="flex w-full items-center gap-1.5 text-left"
      >
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${abierto ? 'rotate-180' : ''}`}
        />
        <span className="text-sm font-medium text-foreground">{titulo}</span>
      </button>
      <p className="ml-[22px] mt-0.5 text-xs text-muted-foreground">{ayuda}</p>
      {abierto && <div className="mt-3">{children}</div>}
    </div>
  );
}
