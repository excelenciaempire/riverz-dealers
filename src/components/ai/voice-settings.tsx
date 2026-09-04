'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowRightLeft,
  ChevronDown,
  Gauge,
  Play,
  Square,
  Sparkles,
  Loader2,
  Megaphone,
  PhoneCall,
  PhoneIncoming,
  Plus,
  ShieldCheck,
  Timer,
} from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { VoiceStatusLine } from '@/components/voice/voice-status-line';
import { useT, useLocale } from '@/hooks/use-locale';
import { useVoiceReadiness } from '@/hooks/use-voice-readiness';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { cn } from '@/lib/utils';
import type {
  VoiceCallingHours,
  VoiceCallType,
  VoiceObjectives,
} from '@/types';
import {
  type CuratedVoice,
  DEFAULT_CALLING_HOURS,
  DEFAULT_GREETINGS,
  DEFAULT_MAX_CALL_SECONDS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_OBJECTIVES,
  DEFAULT_RETRY_DELAY_MINUTES,
} from '@/lib/voice/constants';
import {
  blockerCodeFromReason,
  VOICE_BLOCKED_KEY,
  VOICE_TYPE_KEY,
} from '@/lib/voice/labels';

export interface VoiceState {
  voice_enabled: boolean;
  voice_id: string | null;
  voice_greeting: string;
  voice_system_prompt: string;
  voice_objectives: VoiceObjectives;
  voice_max_call_seconds: number;
  voice_calling_hours: VoiceCallingHours;
  voice_max_retries: number;
  voice_retry_delay_minutes: number;
  voice_accepts_inbound: boolean;
  voice_transfer_number: string;
  voice_max_concurrent_calls: number;
  voice_reserved_inbound_slots: number;
  voice_max_campaign_concurrent: number;
  voice_dedupe_minutes: number;
  voice_monthly_minutes_limit: number;
  voice_recording_enabled: boolean;
  voice_recording_disclosure: boolean;
}

export type VoiceSettingsSection =
  | 'general'
  | 'voice'
  | 'operations'
  | 'schedule'
  | 'control'
  | 'scripts'
  | 'test';

export function initialVoiceState(agent?: {
  voice_enabled?: boolean;
  voice_id?: string | null;
  voice_greeting?: string | null;
  voice_system_prompt?: string | null;
  voice_objectives?: VoiceObjectives | null;
  voice_max_call_seconds?: number;
  voice_calling_hours?: VoiceCallingHours | null;
  voice_max_retries?: number;
  voice_retry_delay_minutes?: number;
  voice_accepts_inbound?: boolean;
  voice_transfer_number?: string | null;
  voice_max_concurrent_calls?: number;
  voice_reserved_inbound_slots?: number;
  voice_max_campaign_concurrent?: number;
  voice_dedupe_minutes?: number;
  voice_monthly_minutes_limit?: number | null;
  voice_recording_enabled?: boolean;
  voice_recording_disclosure?: boolean;
}): VoiceState {
  return {
    voice_enabled: agent?.voice_enabled ?? false,
    voice_id: agent?.voice_id ?? null,
    voice_greeting: agent?.voice_greeting ?? '',
    voice_system_prompt: agent?.voice_system_prompt ?? '',
    voice_objectives: agent?.voice_objectives ?? {},
    voice_max_call_seconds:
      agent?.voice_max_call_seconds ?? DEFAULT_MAX_CALL_SECONDS,
    voice_calling_hours: agent?.voice_calling_hours ?? DEFAULT_CALLING_HOURS,
    voice_max_retries: agent?.voice_max_retries ?? DEFAULT_MAX_RETRIES,
    voice_retry_delay_minutes:
      agent?.voice_retry_delay_minutes ?? DEFAULT_RETRY_DELAY_MINUTES,
    voice_accepts_inbound: agent?.voice_accepts_inbound ?? false,
    voice_transfer_number: agent?.voice_transfer_number ?? '',
    voice_max_concurrent_calls: agent?.voice_max_concurrent_calls ?? 3,
    voice_reserved_inbound_slots: agent?.voice_reserved_inbound_slots ?? 0,
    voice_max_campaign_concurrent: agent?.voice_max_campaign_concurrent ?? 1,
    voice_dedupe_minutes: agent?.voice_dedupe_minutes ?? 15,
    voice_monthly_minutes_limit: agent?.voice_monthly_minutes_limit ?? 0,
    voice_recording_enabled: agent?.voice_recording_enabled ?? true,
    voice_recording_disclosure: agent?.voice_recording_disclosure ?? false,
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
  showReadiness = true,
  showTestCall = true,
  onBeforeTestCall,
  testCallDisabled = false,
  section,
}: {
  value: VoiceState;
  onChange: (v: VoiceState) => void;
  language: string;
  workspaceId?: string;
  /** null en un agente que todavía no se guardó: sin id no se puede llamar. */
  agentId?: string | null;
  /** Al crear, el estado global todavía no puede evaluar un agente sin id. */
  showReadiness?: boolean;
  /** Una llamada de prueba sólo tiene sentido después del primer guardado. */
  showTestCall?: boolean;
  /** Persiste los cambios para que la prueba use exactamente lo que se ve. */
  onBeforeTestCall?: () => Promise<boolean>;
  testCallDisabled?: boolean;
  /** Sección visible cuando el editor usa navegación lateral. */
  section?: VoiceSettingsSection;
}) {
  const t = useT();
  const { locale } = useLocale();
  const fetchWithCsrf = useFetchWithCsrf();
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState('');
  const [calling, setCalling] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const greetingRef = useRef<HTMLTextAreaElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const previewRequestRef = useRef<AbortController | null>(null);
  const [setupText, setSetupText] = useState('');
  const [setupLoading, setSetupLoading] = useState(false);
  const [verSetup, setVerSetup] = useState(false);
  const [voces, setVoces] = useState<CuratedVoice[] | null>(null);
  const [proveedorVoz, setProveedorVoz] = useState<string | null>(null);
  // Un perfil nuevo debe mostrar la biblioteca de inmediato; esconder la única
  // decisión pendiente detrás de «Cambiar» hace pensar que no existe.
  const [verVoces, setVerVoces] = useState(() => !value.voice_id);
  const [creandoVoz, setCreandoVoz] = useState(false);
  const [guardandoVoz, setGuardandoVoz] = useState(false);
  const [nombreVoz, setNombreVoz] = useState('');
  const [muestrasVoz, setMuestrasVoz] = useState<File[]>([]);
  const [consentimientoVoz, setConsentimientoVoz] = useState(false);
  const [verGuiones, setVerGuiones] = useState(false);
  const [verCuando, setVerCuando] = useState(() => tocado(value));
  const [verControl, setVerControl] = useState(false);
  const [capacity, setCapacity] = useState<{
    active: number;
    inbound_active: number;
    outbound_active: number;
    queued: number;
  } | null>(null);
  const [estadoBiblioteca, setEstadoBiblioteca] = useState<
    'fish' | 'fallback' | 'unavailable' | null
  >(null);
  const [busquedaVoz, setBusquedaVoz] = useState('');
  const [busquedaAplicada, setBusquedaAplicada] = useState('');
  const [paginaBiblioteca, setPaginaBiblioteca] = useState(1);
  const [masVoces, setMasVoces] = useState(false);
  const [cargandoVoces, setCargandoVoces] = useState(false);
  const [filtroGenero, setFiltroGenero] = useState<'all' | 'female' | 'male'>(
    'all'
  );
  const [filtroEstilo, setFiltroEstilo] = useState<
    | 'all'
    | 'conversational'
    | 'professional'
    | 'narration'
    | 'calm'
    | 'energetic'
  >('all');

  const { readiness, loading: cargandoEstado } = useVoiceReadiness(
    value.voice_enabled && showReadiness ? workspaceId : undefined,
    agentId
  );

  // Las voces del proveedor que la plataforma tiene activo hoy. Sin esto el
  // selector ofrecía una elección que el motor descartaba.
  const cargarVoces = useCallback(async () => {
    if (!workspaceId) return;
    setCargandoVoces(true);
    try {
      const params = new URLSearchParams({
        workspace_id: workspaceId,
        page: String(paginaBiblioteca),
      });
      if (busquedaAplicada) params.set('search', busquedaAplicada);
      const res = await fetch(`/api/voice/voices?${params}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        setEstadoBiblioteca('unavailable');
        return;
      }
      const json = (await res.json()) as {
        provider?: string;
        voices: CuratedVoice[];
        library_status?: 'fish' | 'fallback' | 'unavailable';
        has_more?: boolean;
      };
      setProveedorVoz(json.provider ?? null);
      setVoces(json.voices ?? []);
      setEstadoBiblioteca(json.library_status ?? null);
      setMasVoces(Boolean(json.has_more));
    } catch {
      setEstadoBiblioteca('unavailable');
    } finally {
      setCargandoVoces(false);
    }
  }, [workspaceId, paginaBiblioteca, busquedaAplicada]);

  useEffect(() => {
    void cargarVoces();
  }, [cargarVoces]);

  // Una voz propia puede tardar unos segundos en entrenar. Mientras este
  // editor siga abierto, refresca su estado hasta que se pueda escuchar.
  useEffect(() => {
    if (
      !voces?.some(
        (voice) => voice.state === 'created' || voice.state === 'training'
      )
    ) {
      return;
    }
    const timer = window.setTimeout(() => void cargarVoces(), 5000);
    return () => window.clearTimeout(timer);
  }, [voces, cargarVoces]);

  useEffect(
    () => () => {
      previewRequestRef.current?.abort();
      audioRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    },
    []
  );

  useEffect(() => {
    if (!workspaceId || !agentId) {
      setCapacity(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const params = new URLSearchParams({
          workspace_id: workspaceId,
          agent_id: agentId,
        });
        const response = await fetch(`/api/voice/capacity?${params}`, {
          cache: 'no-store',
        });
        if (!response.ok || cancelled) return;
        const json = (await response.json()) as {
          active: number;
          inbound_active: number;
          outbound_active: number;
          queued: number;
        };
        if (!cancelled) setCapacity(json);
      } catch {
        // Live counters are informational; keep the saved controls usable
        // during a transient network failure.
      }
    };
    void load();
    const timer = window.setInterval(load, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [agentId, workspaceId]);

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
        voice_greeting: string;
        objectives: VoiceObjectives;
      };
      onChange({
        ...value,
        voice_enabled: c.voice_enabled ?? true,
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

  async function preview(voice: CuratedVoice | string) {
    const voiceId = typeof voice === 'string' ? voice : voice.voice_id;
    const publicPreview = typeof voice === 'string' ? null : voice.preview_url;
    const stoppingSameVoice = previewing === voiceId;
    previewRequestRef.current?.abort();
    previewRequestRef.current = null;
    audioRef.current?.pause();
    audioRef.current = null;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
    setPreviewing(null);
    if (stoppingSameVoice) return;

    const controller = new AbortController();
    previewRequestRef.current = controller;
    setPreviewing(voiceId);
    try {
      let url = publicPreview;
      if (!url) {
        const res = await fetchWithCsrf('/api/voice/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspace_id: workspaceId,
            voice_id: voiceId,
            language,
          }),
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (!res.ok) {
          toast.error(t('voice.voicePreviewFailed'));
          setPreviewing(null);
          return;
        }
        const blob = await res.blob();
        url = URL.createObjectURL(blob);
        audioUrlRef.current = url;
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        if (audioRef.current === audio) {
          audioRef.current = null;
          setPreviewing(null);
        }
        if (audioUrlRef.current === url) {
          URL.revokeObjectURL(url);
          audioUrlRef.current = null;
        }
      };
      audio.onerror = () => {
        if (audioRef.current === audio) {
          audioRef.current = null;
          setPreviewing(null);
        }
        if (audioUrlRef.current === url) {
          URL.revokeObjectURL(url);
          audioUrlRef.current = null;
        }
        toast.error(t('voice.voicePreviewFailed'));
      };
      await audio.play();
    } catch {
      if (controller.signal.aborted) return;
      toast.error(t('voice.voicePreviewFailed'));
      setPreviewing(null);
    } finally {
      if (previewRequestRef.current === controller) {
        previewRequestRef.current = null;
      }
    }
  }

  async function crearVoz() {
    if (
      !workspaceId ||
      !nombreVoz.trim() ||
      !muestrasVoz.length ||
      !consentimientoVoz
    ) {
      toast.error(t('voice.voiceCloneInvalid'));
      return;
    }
    setGuardandoVoz(true);
    try {
      const form = new FormData();
      form.set('workspace_id', workspaceId);
      form.set('name', nombreVoz.trim());
      form.set('consent', 'true');
      muestrasVoz.forEach((file) => form.append('samples', file));
      const res = await fetchWithCsrf('/api/voice/voices', {
        method: 'POST',
        body: form,
      });
      const json = (await res.json().catch(() => null)) as {
        error?: string;
        voice?: CuratedVoice;
      } | null;
      if (!res.ok || !json?.voice) {
        toast.error(json?.error ?? t('voice.voiceCloneFailed'));
        return;
      }
      setVoces((actual) => [json.voice!, ...(actual ?? [])]);
      setNombreVoz('');
      setMuestrasVoz([]);
      setConsentimientoVoz(false);
      setCreandoVoz(false);
      if (json.voice.state === 'trained') {
        set({ voice_id: json.voice.voice_id });
        setVerVoces(false);
        toast.success(t('voice.voiceCreated'));
      } else {
        setVerVoces(true);
        toast.success(t('voice.voiceTrainingStarted'));
      }
    } finally {
      setGuardandoVoz(false);
    }
  }

  async function testCall() {
    if (
      !workspaceId ||
      !agentId ||
      !value.voice_enabled ||
      !value.voice_id ||
      !testPhone.trim()
    )
      return;
    setCalling(true);
    try {
      if (onBeforeTestCall && !(await onBeforeTestCall())) return;
      const res = await fetchWithCsrf('/api/voice/test-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          agent_id: agentId,
          phone: testPhone.trim(),
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        const reason = json?.error;
        toast.error(
          reason === 'motor_apagado'
            ? t('voice.testCallAccountPaused')
            : reason
              ? t(VOICE_BLOCKED_KEY[blockerCodeFromReason(reason)])
              : t('voice.callFailed')
        );
        return;
      }
      toast.success(t('voice.testCallQueued'));
    } catch {
      toast.error(t('voice.callFailed'));
    } finally {
      setCalling(false);
    }
  }

  function setObjective(
    type: VoiceCallType,
    patch: { objective?: string; extra_instructions?: string }
  ) {
    const prev = value.voice_objectives[type] ?? {
      enabled: true,
      objective: '',
    };
    set({
      voice_objectives: {
        ...value.voice_objectives,
        // `enabled` se sigue guardando en true por compatibilidad con lo que ya
        // está en la base; NADIE lo lee. El guion es lo que manda.
        [type]: { ...prev, enabled: true, ...patch },
      },
    });
  }

  function setUpsell(patch: {
    enabled?: boolean;
    offer_text?: string;
    discount?: string;
  }) {
    const oc = value.voice_objectives.order_confirmation ?? {
      enabled: true,
      objective: '',
    };
    const prevUpsell = oc.upsell ?? { enabled: false };
    set({
      voice_objectives: {
        ...value.voice_objectives,
        order_confirmation: {
          ...oc,
          enabled: true,
          upsell: { ...prevUpsell, ...patch },
        },
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
  const vozElegidaDisponible =
    !vozElegida || !vozElegida.state || vozElegida.state === 'trained';
  const vocesPropias = (voces ?? []).filter((v) => v.source === 'custom');
  const vocesBiblioteca = (voces ?? []).filter((v) => v.source !== 'custom');
  const vocesFiltradas = vocesBiblioteca.filter((voice) => {
    if (filtroGenero !== 'all' && voice.gender !== filtroGenero) return false;
    if (filtroEstilo === 'all') return true;
    return (voice.tags ?? []).some((tag) => tag.toLowerCase() === filtroEstilo);
  });

  function insertGreetingVariable(variable: string) {
    const token = `{{${variable}}}`;
    const input = greetingRef.current;
    const base = value.voice_greeting || DEFAULT_GREETINGS[idioma];
    if (base.includes(token)) return;
    const editingGreeting =
      value.voice_greeting && document.activeElement === input;
    const start = editingGreeting
      ? (input?.selectionStart ?? base.length)
      : base.length;
    const end = editingGreeting ? (input?.selectionEnd ?? start) : base.length;
    const next =
      base.slice(0, start) +
      (start > 0 && !/\s$/.test(base.slice(0, start)) ? ' ' : '') +
      token +
      base.slice(end);
    set({ voice_greeting: next });
    requestAnimationFrame(() => {
      greetingRef.current?.focus();
      const position = next.indexOf(token, start) + token.length;
      greetingRef.current?.setSelectionRange(position, position);
    });
  }

  return (
    <div className="space-y-6">
      {/* Si este agente puede atender el teléfono, y si no, por qué. Antes acá
          había una línea de datos que sólo sabía decir el número: si el agente
          estaba pausado o no había número, se callaba. */}
      {showReadiness && !section && (
        <VoiceStatusLine readiness={readiness} loading={cargandoEstado} />
      )}

      {/* Armarlo hablando. Es el camino corto, así que va primero: estaba en el
          medio del formulario, después de la caja de probar. */}
      {workspaceId && (!section || section === 'general') && (
        <div className="border-border overflow-hidden rounded-xl border">
          <button
            type="button"
            onClick={() => setVerSetup((current) => !current)}
            className="hover:bg-muted/30 flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left transition-colors"
          >
            <span className="flex items-center gap-2">
              <Sparkles className="text-accent-ink size-4" />
              <span className="text-foreground text-sm font-medium">
                {t('voice.setupTitle')}
              </span>
            </span>
            <ChevronDown
              className={`text-muted-foreground size-4 transition-transform ${verSetup ? 'rotate-180' : ''}`}
            />
          </button>
          {verSetup && (
            <div className="border-border bg-muted/20 border-t p-3.5">
              <Textarea
                className="bg-background text-foreground min-h-16"
                placeholder={t('voice.setupPlaceholder')}
                value={setupText}
                onChange={(e) => setSetupText(e.target.value)}
              />
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  onClick={aiSetup}
                  disabled={setupLoading || !setupText.trim()}
                >
                  {setupLoading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    t('voice.setupApply')
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Cómo suena ── */}
      {(!section || section === 'voice') && (
        <div>
          <p className="text-foreground mb-1 text-sm font-medium">
            {t('voice.voiceLabel')}
          </p>
          {/* El resumen sólo aporta valor después de elegir una voz. */}
          {value.voice_id && (
            <div className="border-border bg-muted/40 flex items-center justify-between rounded-lg border px-3 py-2">
              <span className="text-foreground text-sm">
                {vozElegida?.label ?? t('voice.voiceSelected')}
              </span>
              <span className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => preview(vozElegida ?? value.voice_id!)}
                  disabled={!vozElegidaDisponible}
                  className="gap-1.5"
                >
                  {previewing === value.voice_id ? (
                    <Square className="size-3.5" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
                  {previewing === value.voice_id
                    ? t('voice.voicePreviewStop')
                    : t('voice.voicePreview')}
                </Button>
                <button
                  type="button"
                  onClick={() => setVerVoces((v) => !v)}
                  className="text-accent-ink px-1.5 text-xs hover:underline"
                >
                  {verVoces ? t('common.close') : t('voice.numberChange')}
                </button>
              </span>
            </div>
          )}
          {verVoces && (
            <div className={value.voice_id ? 'mt-3 space-y-4' : 'space-y-4'}>
              {cargandoVoces && voces === null && (
                <div className="flex justify-center py-4">
                  <Loader2 className="text-muted-foreground size-4 animate-spin" />
                </div>
              )}
              {vocesPropias.length > 0 && (
                <VoiceList
                  title={t('voice.voiceCustom')}
                  voices={vocesPropias}
                  selectedId={value.voice_id}
                  previewingId={previewing}
                  onSelect={(id) => {
                    set({ voice_id: id });
                    setVerVoces(false);
                  }}
                  onPreview={preview}
                  trainingLabel={t('voice.voiceTraining')}
                  failedLabel={t('voice.voiceTrainingFailed')}
                />
              )}
              {vocesBiblioteca.length > 0 && (
                <div className="space-y-3">
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="flex gap-2">
                      <Input
                        className="bg-background text-foreground"
                        value={busquedaVoz}
                        onChange={(event) => setBusquedaVoz(event.target.value)}
                        placeholder={t('voice.voiceLibrarySearch')}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter') return;
                          event.preventDefault();
                          setPaginaBiblioteca(1);
                          setBusquedaAplicada(busquedaVoz.trim());
                        }}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setPaginaBiblioteca(1);
                          setBusquedaAplicada(busquedaVoz.trim());
                        }}
                      >
                        {t('voice.voiceLibrarySearchAction')}
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Select
                        value={filtroGenero}
                        onValueChange={(next) =>
                          setFiltroGenero(next as typeof filtroGenero)
                        }
                      >
                        <SelectTrigger
                          size="default"
                          className="bg-background h-9 min-w-28 text-xs"
                          aria-label={t('voice.voiceFilterGender')}
                        >
                          <SelectValue
                            labels={{
                              all: t('voice.voiceFilterAll'),
                              female: t('voice.voiceFilterFemale'),
                              male: t('voice.voiceFilterMale'),
                            }}
                          />
                        </SelectTrigger>
                        <SelectContent align="end">
                          <SelectItem value="all">
                            {t('voice.voiceFilterAll')}
                          </SelectItem>
                          <SelectItem value="female">
                            {t('voice.voiceFilterFemale')}
                          </SelectItem>
                          <SelectItem value="male">
                            {t('voice.voiceFilterMale')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <Select
                        value={filtroEstilo}
                        onValueChange={(next) =>
                          setFiltroEstilo(next as typeof filtroEstilo)
                        }
                      >
                        <SelectTrigger
                          size="default"
                          className="bg-background h-9 min-w-36 text-xs"
                          aria-label={t('voice.voiceFilterStyle')}
                        >
                          <SelectValue
                            labels={{
                              all: t('voice.voiceFilterAnyStyle'),
                              conversational: t(
                                'voice.voiceStyleConversational'
                              ),
                              professional: t('voice.voiceStyleProfessional'),
                              narration: t('voice.voiceStyleNarration'),
                              calm: t('voice.voiceStyleCalm'),
                              energetic: t('voice.voiceStyleEnergetic'),
                            }}
                          />
                        </SelectTrigger>
                        <SelectContent align="end">
                          <SelectItem value="all">
                            {t('voice.voiceFilterAnyStyle')}
                          </SelectItem>
                          <SelectItem value="conversational">
                            {t('voice.voiceStyleConversational')}
                          </SelectItem>
                          <SelectItem value="professional">
                            {t('voice.voiceStyleProfessional')}
                          </SelectItem>
                          <SelectItem value="narration">
                            {t('voice.voiceStyleNarration')}
                          </SelectItem>
                          <SelectItem value="calm">
                            {t('voice.voiceStyleCalm')}
                          </SelectItem>
                          <SelectItem value="energetic">
                            {t('voice.voiceStyleEnergetic')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {estadoBiblioteca === 'fallback' && (
                    <p className="text-muted-foreground text-xs">
                      {t('voice.voiceLibraryFallback')}
                    </p>
                  )}
                  {vocesFiltradas.length > 0 ? (
                    <VoiceList
                      title={
                        estadoBiblioteca === 'fish'
                          ? t('voice.voiceLibrary')
                          : t('voice.voiceAvailable')
                      }
                      voices={vocesFiltradas}
                      selectedId={value.voice_id}
                      previewingId={previewing}
                      onSelect={(id) => {
                        set({ voice_id: id });
                        setVerVoces(false);
                      }}
                      onPreview={preview}
                      trainingLabel={t('voice.voiceTraining')}
                      failedLabel={t('voice.voiceTrainingFailed')}
                    />
                  ) : (
                    <p className="text-muted-foreground py-5 text-center text-xs">
                      {t('voice.voiceLibraryNoResults')}
                    </p>
                  )}
                  {estadoBiblioteca === 'fish' && (
                    <div className="flex items-center justify-between gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={paginaBiblioteca === 1 || cargandoVoces}
                        onClick={() =>
                          setPaginaBiblioteca((page) => Math.max(1, page - 1))
                        }
                      >
                        {t('voice.voiceLibraryPrevious')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={!masVoces || cargandoVoces}
                        onClick={() => setPaginaBiblioteca((page) => page + 1)}
                      >
                        {t('voice.voiceLibraryNext')}
                      </Button>
                    </div>
                  )}
                </div>
              )}
              {estadoBiblioteca === 'unavailable' && (
                <div className="border-border rounded-lg border border-dashed p-3">
                  <p className="text-muted-foreground text-xs">
                    {t('voice.voiceLibraryUnavailable')}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="mt-1"
                    onClick={() => void cargarVoces()}
                  >
                    {t('voice.voiceLibraryRetry')}
                  </Button>
                </div>
              )}
              {!cargandoVoces &&
                estadoBiblioteca !== 'unavailable' &&
                voces !== null &&
                voces.length === 0 && (
                  <p className="text-muted-foreground py-2 text-xs">
                    {t('voice.voiceLibraryNoResults')}
                  </p>
                )}
              {proveedorVoz === 'fish' && (
                <div className="border-border rounded-lg border border-dashed p-3">
                  {!creandoVoz ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setCreandoVoz(true)}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      {t('voice.voiceCreate')}
                    </Button>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-foreground text-sm font-medium">
                        {t('voice.voiceCreateTitle')}
                      </p>
                      <Input
                        className="bg-background text-foreground"
                        value={nombreVoz}
                        onChange={(event) => setNombreVoz(event.target.value)}
                        placeholder={t('voice.voiceNamePlaceholder')}
                        maxLength={80}
                      />
                      <div>
                        <p className="text-foreground mb-1 text-xs font-medium">
                          {t('voice.voiceSamples')}
                        </p>
                        <Input
                          className="bg-background text-foreground"
                          type="file"
                          accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/ogg,audio/opus,.mp3,.wav,.m4a,.ogg,.opus"
                          multiple
                          onChange={(event) =>
                            setMuestrasVoz(
                              Array.from(event.target.files ?? []).slice(0, 3)
                            )
                          }
                        />
                        <p className="text-muted-foreground mt-1 text-xs">
                          {t('voice.voiceSamplesHint')}
                        </p>
                      </div>
                      <label className="text-muted-foreground flex items-start gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={consentimientoVoz}
                          onChange={(event) =>
                            setConsentimientoVoz(event.target.checked)
                          }
                          className="mt-0.5"
                        />
                        {t('voice.voiceConsent')}
                      </label>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={crearVoz}
                          disabled={
                            guardandoVoz ||
                            !nombreVoz.trim() ||
                            !muestrasVoz.length ||
                            !consentimientoVoz
                          }
                        >
                          {guardandoVoz ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            t('voice.voiceCreateAction')
                          )}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setCreandoVoz(false)}
                        >
                          {t('voice.voiceCancel')}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {(!section || section === 'general') && (
        <div>
          <p className="text-foreground mb-1 text-sm font-medium">
            {t('voice.greeting')}
          </p>
          <Textarea
            ref={greetingRef}
            className="bg-muted text-foreground min-h-16"
            value={value.voice_greeting}
            onChange={(e) => set({ voice_greeting: e.target.value })}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[
              ['contact_name', t('voice.variableContact')],
              ['business_name', t('voice.variableBusiness')],
              ['order_number', t('voice.variableOrder')],
              ['order_total', t('voice.variableTotal')],
              ['product_name', t('voice.variableProduct')],
              ['shipping_city', t('voice.variableCity')],
              ['tracking_number', t('voice.variableTracking')],
            ].map(([variable, label]) => (
              <button
                key={variable}
                type="button"
                title={`{{${variable}}}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertGreetingVariable(variable)}
                disabled={(
                  value.voice_greeting || DEFAULT_GREETINGS[idioma]
                ).includes(`{{${variable}}}`)}
                className="border-border bg-background text-muted-foreground hover:border-accent/50 hover:text-foreground rounded-md border px-2 py-1 text-[11px] transition-colors disabled:cursor-default disabled:opacity-40"
              >
                + {label}
              </button>
            ))}
          </div>
          <p className="text-muted-foreground mt-1.5 text-[11px]">
            {t('voice.variablesOptional')}
          </p>
        </div>
      )}

      {/* Estas decisiones cambian según quién atiende. No viven en la central
          general porque ventas y soporte pueden transferir a personas distintas
          y no todos los agentes deben recibir entrantes. */}
      {(!section || section === 'operations') && (
        <div className="border-border overflow-hidden rounded-xl border">
          {!section && (
            <div className="border-border bg-muted/20 border-b px-3.5 py-3">
              <p className="text-foreground text-sm font-medium">
                {t('voice.agentOperations')}
              </p>
            </div>
          )}
          <label className="border-border flex cursor-pointer items-start justify-between gap-4 border-b px-3.5 py-3">
            <span className="flex min-w-0 gap-2.5">
              <span className="bg-accent/10 text-accent-ink grid size-8 shrink-0 place-items-center rounded-lg">
                <PhoneIncoming className="size-4" />
              </span>
              <span>
                <span className="text-foreground block text-sm font-medium">
                  {t('voice.agentAcceptsInbound')}
                </span>
                <span className="text-muted-foreground mt-0.5 block text-xs">
                  {t('voice.agentAcceptsInboundHint')}
                </span>
              </span>
            </span>
            <Switch
              className="mt-1 shrink-0"
              checked={value.voice_accepts_inbound}
              onCheckedChange={(checked) =>
                set({ voice_accepts_inbound: checked })
              }
            />
          </label>
          <div className="grid gap-4 p-3.5 sm:grid-cols-2">
            <label className="block">
              <span className="text-foreground mb-1.5 flex items-center gap-2 text-xs font-medium">
                <ArrowRightLeft className="text-muted-foreground size-3.5" />
                {t('voice.agentTransferNumber')}
              </span>
              <Input
                type="tel"
                className="bg-background text-foreground"
                value={value.voice_transfer_number}
                onChange={(event) =>
                  set({ voice_transfer_number: event.target.value })
                }
                placeholder={t('voice.phoneNumberPlaceholder')}
              />
            </label>
            <label className="block">
              <span className="text-foreground mb-1.5 flex items-center gap-2 text-xs font-medium">
                <Timer className="text-muted-foreground size-3.5" />
                {t('voice.agentMaxDuration')}
              </span>
              <select
                value={value.voice_max_call_seconds}
                onChange={(event) =>
                  set({ voice_max_call_seconds: Number(event.target.value) })
                }
                className="border-border bg-background text-foreground h-9 w-full rounded-lg border px-2.5 text-sm"
              >
                <option value={180}>{t('voice.durationThreeMinutes')}</option>
                <option value={300}>{t('voice.durationFiveMinutes')}</option>
                <option value={600}>{t('voice.durationTenMinutes')}</option>
              </select>
            </label>
          </div>
        </div>
      )}

      {(!section || section === 'control') && (
        <Plegable
          titulo={t('voice.agentControlTitle')}
          ayuda={t('voice.agentControlHint')}
          abierto={section === 'control' || verControl}
          alternar={() => setVerControl((current) => !current)}
          ocultarEncabezado={section === 'control'}
        >
          <div className="space-y-3">
            {capacity && (
              <div className="border-border bg-muted/20 grid overflow-hidden rounded-xl border sm:grid-cols-3">
                <AgentMetric
                  icon={Activity}
                  label={t('voice.capacityInProgress')}
                  value={`${capacity.active} / ${value.voice_max_concurrent_calls}`}
                />
                <AgentMetric
                  icon={PhoneIncoming}
                  label={t('voice.typeInbound')}
                  value={String(capacity.inbound_active)}
                />
                <AgentMetric
                  icon={Timer}
                  label={t('voice.capacityQueued')}
                  value={String(capacity.queued)}
                />
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <AgentNumberField
                icon={Gauge}
                label={t('voice.capacityMaxTitle')}
                hint={t('voice.agentCapacityMaxHint')}
                value={value.voice_max_concurrent_calls}
                min={1}
                max={20}
                onChange={(next) => {
                  const max = Math.min(20, Math.max(1, next || 1));
                  set({
                    voice_max_concurrent_calls: max,
                    voice_reserved_inbound_slots: Math.min(
                      value.voice_reserved_inbound_slots,
                      Math.max(0, max - 1)
                    ),
                    voice_max_campaign_concurrent: Math.min(
                      value.voice_max_campaign_concurrent,
                      max
                    ),
                  });
                }}
              />
              <AgentNumberField
                icon={Megaphone}
                label={t('voice.capacityCampaignTitle')}
                hint={t('voice.capacityCampaignHint')}
                value={value.voice_max_campaign_concurrent}
                min={1}
                max={value.voice_max_concurrent_calls}
                onChange={(next) =>
                  set({
                    voice_max_campaign_concurrent: Math.min(
                      value.voice_max_concurrent_calls,
                      Math.max(1, next || 1)
                    ),
                  })
                }
              />
              <AgentNumberField
                icon={Timer}
                label={t('voice.monthlyLimit')}
                hint={t('voice.monthlyLimitHint')}
                value={value.voice_monthly_minutes_limit}
                min={0}
                onChange={(next) =>
                  set({ voice_monthly_minutes_limit: Math.max(0, next || 0) })
                }
              />

              <div className="border-border rounded-xl border p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex min-w-0 gap-2.5">
                    <ShieldCheck className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                    <span>
                      <span className="text-foreground block text-sm font-medium">
                        {t('voice.capacityDedupeTitle')}
                      </span>
                      <span className="text-muted-foreground mt-0.5 block text-xs">
                        {t('voice.capacityDedupeHint')}
                      </span>
                    </span>
                  </span>
                  <Switch
                    checked={value.voice_dedupe_minutes > 0}
                    onCheckedChange={(checked) =>
                      set({ voice_dedupe_minutes: checked ? 15 : 0 })
                    }
                  />
                </div>
                {value.voice_dedupe_minutes > 0 && (
                  <div className="mt-3 flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={1440}
                      value={value.voice_dedupe_minutes}
                      onChange={(event) =>
                        set({
                          voice_dedupe_minutes: Math.min(
                            1440,
                            Math.max(1, Number(event.target.value) || 1)
                          ),
                        })
                      }
                      className="w-24"
                    />
                    <span className="text-muted-foreground text-xs">
                      {t('voice.capacityMinutes')}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {value.voice_accepts_inbound && (
              <div className="border-border flex items-center justify-between gap-4 rounded-xl border p-3.5">
                <div className="flex min-w-0 gap-2.5">
                  <PhoneIncoming className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  <div>
                    <p className="text-foreground text-sm font-medium">
                      {t('voice.capacityReserveTitle')}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {t('voice.agentReserveHint')}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {value.voice_reserved_inbound_slots > 0 && (
                    <Input
                      type="number"
                      min={1}
                      max={Math.max(1, value.voice_max_concurrent_calls - 1)}
                      value={value.voice_reserved_inbound_slots}
                      onChange={(event) =>
                        set({
                          voice_reserved_inbound_slots: Math.min(
                            value.voice_max_concurrent_calls - 1,
                            Math.max(1, Number(event.target.value) || 1)
                          ),
                        })
                      }
                      className="w-20"
                    />
                  )}
                  <Switch
                    checked={value.voice_reserved_inbound_slots > 0}
                    onCheckedChange={(checked) =>
                      set({
                        voice_max_concurrent_calls: checked
                          ? Math.max(2, value.voice_max_concurrent_calls)
                          : value.voice_max_concurrent_calls,
                        voice_reserved_inbound_slots: checked ? 1 : 0,
                      })
                    }
                  />
                </div>
              </div>
            )}

            <div className="border-border overflow-hidden rounded-xl border">
              <label className="border-border flex cursor-pointer items-start justify-between gap-4 border-b px-3.5 py-3">
                <span>
                  <span className="text-foreground block text-sm font-medium">
                    {t('voice.recordingEnabled')}
                  </span>
                  <span className="text-muted-foreground mt-0.5 block text-xs">
                    {t('voice.recordingHint')}
                  </span>
                </span>
                <Switch
                  checked={value.voice_recording_enabled}
                  onCheckedChange={(checked) =>
                    set({
                      voice_recording_enabled: checked,
                      voice_recording_disclosure: checked
                        ? value.voice_recording_disclosure
                        : false,
                    })
                  }
                />
              </label>
              {value.voice_recording_enabled && (
                <label className="flex cursor-pointer items-start justify-between gap-4 px-3.5 py-3">
                  <span>
                    <span className="text-foreground block text-sm font-medium">
                      {t('voice.recordingDisclosure')}
                    </span>
                    <span className="text-muted-foreground mt-0.5 block text-xs">
                      {t('voice.recordingDisclosureHint')}
                    </span>
                  </span>
                  <Switch
                    checked={value.voice_recording_disclosure}
                    onCheckedChange={(checked) =>
                      set({ voice_recording_disclosure: checked })
                    }
                  />
                </label>
              )}
            </div>

            <div className="border-border bg-muted/20 rounded-xl border px-3.5 py-3">
              <p className="text-muted-foreground text-[11px] font-medium uppercase">
                {t('voice.capacityPriority')}
              </p>
              <p className="text-foreground mt-1.5 text-xs">
                {t('voice.agentPriorityOrder')}
              </p>
            </div>
          </div>
        </Plegable>
      )}

      {/* ── Qué dice en cada tipo de llamada. Plegado: tiene guiones que
             funcionan y casi nadie los toca. ── */}
      {(!section || section === 'scripts') && (
        <Plegable
          titulo={t('voice.objectives')}
          ayuda={t('voice.objectivesHint')}
          abierto={section === 'scripts' || verGuiones}
          alternar={() => setVerGuiones((v) => !v)}
          ocultarEncabezado={section === 'scripts'}
        >
          <div className="space-y-3">
            {OBJECTIVE_TYPES.map(({ type, labelKey }) => {
              const obj = value.voice_objectives[type];
              return (
                <div
                  key={type}
                  className="border-border bg-muted/40 rounded-lg border p-3"
                >
                  <p className="text-foreground mb-2 text-sm">{t(labelKey)}</p>
                  <Textarea
                    className="bg-background text-foreground min-h-14"
                    // El guion por defecto, a la vista. Antes había que prender un
                    // interruptor para ver una caja vacía y adivinar qué escribir.
                    placeholder={DEFAULT_OBJECTIVES[type][idioma]}
                    value={obj?.objective ?? ''}
                    onChange={(e) =>
                      setObjective(type, { objective: e.target.value })
                    }
                  />
                  {/* Sólo si YA tiene algo escrito: los agentes viejos no pierden
                    lo que cargaron, pero nadie empieza a llenar dos cajas. */}
                  {(obj?.extra_instructions ?? '').trim() !== '' && (
                    <Textarea
                      className="bg-background text-foreground mt-2 min-h-12"
                      placeholder={t('voice.extraInstructions')}
                      value={obj?.extra_instructions ?? ''}
                      onChange={(e) =>
                        setObjective(type, {
                          extra_instructions: e.target.value,
                        })
                      }
                    />
                  )}
                  {type === 'followup' && (
                    <p className="text-muted-foreground mt-2 text-[11px]">
                      {t('voice.objFollowupSharedDelay')}
                    </p>
                  )}
                  {/* El upsell sí hace algo: `context.ts` lo lee y le da al agente
                    la herramienta de editar el pedido. Por eso conserva su
                    interruptor, a diferencia de los de objetivo. */}
                  {type === 'order_confirmation' && (
                    <div className="border-border/60 bg-background mt-3 rounded-md border p-2.5">
                      <label className="flex items-center justify-between">
                        <span className="text-foreground text-xs font-medium">
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
                            className="bg-muted text-foreground min-h-12"
                            placeholder={t('voice.upsellOfferPlaceholder')}
                            value={obj?.upsell?.offer_text ?? ''}
                            onChange={(e) =>
                              setUpsell({ offer_text: e.target.value })
                            }
                          />
                          <Input
                            className="bg-muted text-foreground"
                            placeholder={t('voice.upsellDiscountPlaceholder')}
                            value={obj?.upsell?.discount ?? ''}
                            onChange={(e) =>
                              setUpsell({ discount: e.target.value })
                            }
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
      )}

      {/* ── Cuándo insiste. Plegado, salvo que alguien ya lo haya tocado. ── */}
      {(!section || section === 'schedule') && (
        <Plegable
          titulo={t('voice.whenGroup')}
          ayuda={t('voice.whenGroupHint')}
          abierto={section === 'schedule' || verCuando}
          alternar={() => setVerCuando((v) => !v)}
          ocultarEncabezado={section === 'schedule'}
        >
          <div className="space-y-5">
            <div>
              <p className="text-foreground mb-1 text-sm font-medium">
                {t('voice.callingHours')}
              </p>
              <p className="text-muted-foreground mb-2 text-xs">
                {t('voice.callingHoursHint')}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-muted-foreground flex items-center gap-2 text-xs">
                  {t('voice.from')}
                  <Input
                    type="time"
                    className="bg-muted text-foreground w-28"
                    value={value.voice_calling_hours.start}
                    onChange={(e) =>
                      set({
                        voice_calling_hours: {
                          ...value.voice_calling_hours,
                          start: e.target.value,
                        },
                      })
                    }
                  />
                </label>
                <label className="text-muted-foreground flex items-center gap-2 text-xs">
                  {t('voice.to')}
                  <Input
                    type="time"
                    className="bg-muted text-foreground w-28"
                    value={value.voice_calling_hours.end}
                    onChange={(e) =>
                      set({
                        voice_calling_hours: {
                          ...value.voice_calling_hours,
                          end: e.target.value,
                        },
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
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {t(key)}
                    </button>
                  );
                })}
              </div>
              {noDays ? (
                <p className="text-destructive mt-2 text-xs">
                  {t('voice.hoursNoDays')}
                </p>
              ) : crossesMidnight ? (
                <p className="text-muted-foreground mt-2 text-xs">
                  {t('voice.hoursOvernight')}
                </p>
              ) : null}
            </div>

            <div>
              <p className="text-foreground mb-1 text-sm font-medium">
                {t('voice.retries')}
              </p>
              <p className="text-muted-foreground mb-2 text-xs">
                {t('voice.retriesHint')}
              </p>
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
                            value.voice_retry_delay_minutes ||
                            DEFAULT_RETRY_DELAY_MINUTES,
                        })
                      }
                      className={cn(
                        'rounded-md px-2.5 py-1 text-xs',
                        on
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground'
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
      )}

      {/* Probarlo es lo último que uno hace, así que va último. */}
      {workspaceId && showTestCall && (!section || section === 'test') && (
        <div className="border-border bg-muted/40 rounded-lg border p-3">
          <p className="text-foreground mb-2 text-sm font-medium">
            {t('voice.testCall')}
          </p>
          {!agentId && (
            <p className="text-muted-foreground mb-2 text-xs">
              {t('voice.testCallSaveFirst')}
            </p>
          )}
          <div className="flex gap-2">
            <Input
              type="tel"
              className="bg-background text-foreground"
              placeholder={t('voice.testCallPlaceholder')}
              value={testPhone}
              disabled={!agentId}
              onChange={(e) => setTestPhone(e.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                void testCall();
              }}
            />
            <Button
              type="button"
              onClick={testCall}
              disabled={
                !agentId ||
                !value.voice_enabled ||
                !value.voice_id ||
                !vozElegidaDisponible ||
                calling ||
                testCallDisabled ||
                !testPhone.trim()
              }
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

function AgentMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
}) {
  return (
    <div className="border-border/70 px-3.5 py-3 sm:border-r sm:last:border-r-0">
      <p className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
        <Icon className="size-3.5" />
        {label}
      </p>
      <p className="text-foreground mt-1 text-lg font-semibold tabular-nums">
        {value}
      </p>
    </div>
  );
}

function AgentNumberField({
  icon: Icon,
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  icon: typeof Activity;
  label: string;
  hint: string;
  value: number;
  min: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="border-border flex items-start justify-between gap-3 rounded-xl border p-3.5">
      <span className="flex min-w-0 gap-2.5">
        <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <span>
          <span className="text-foreground block text-sm font-medium">
            {label}
          </span>
          <span className="text-muted-foreground mt-0.5 block text-xs">
            {hint}
          </span>
        </span>
      </span>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-20 shrink-0"
      />
    </label>
  );
}

/** Bloque plegado. Mismo gesto que usa la tarjeta de comportamiento en /voz. */
function VoiceList({
  title,
  voices,
  selectedId,
  previewingId,
  onSelect,
  onPreview,
  trainingLabel,
  failedLabel,
}: {
  title: string;
  voices: CuratedVoice[];
  selectedId: string | null;
  previewingId: string | null;
  onSelect: (id: string) => void;
  onPreview: (voice: CuratedVoice) => void;
  trainingLabel: string;
  failedLabel: string;
}) {
  const t = useT();
  return (
    <div>
      <p className="text-muted-foreground mb-2 text-xs font-medium">{title}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {voices.map((voice) => {
          const available = !voice.state || voice.state === 'trained';
          const selected = selectedId === voice.voice_id;
          return (
            <div
              key={voice.voice_id}
              className={cn(
                'flex items-center justify-between rounded-lg border px-3 py-2',
                selected
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-muted/40'
              )}
            >
              <button
                type="button"
                disabled={!available}
                onClick={() => onSelect(voice.voice_id)}
                className="flex-1 text-left disabled:cursor-not-allowed disabled:opacity-60"
              >
                <p className="text-foreground text-sm">{voice.label}</p>
                <p className="text-muted-foreground text-[11px]">
                  {available
                    ? voice.gender === 'neutral'
                      ? voice.locale
                      : `${voice.locale} · ${voice.gender === 'female' ? '♀' : '♂'}`
                    : voice.state === 'failed'
                      ? failedLabel
                      : trainingLabel}
                </p>
              </button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!available}
                onClick={() => onPreview(voice)}
                className="gap-1.5"
                aria-label={
                  previewingId === voice.voice_id
                    ? t('voice.voicePreviewStop')
                    : t('voice.voicePreview')
                }
              >
                {previewingId === voice.voice_id ? (
                  <Square className="size-3.5" />
                ) : (
                  <Play className="size-3.5" />
                )}
                <span className="hidden lg:inline">
                  {previewingId === voice.voice_id
                    ? t('voice.voicePreviewStop')
                    : t('voice.voicePreview')}
                </span>
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Plegable({
  titulo,
  ayuda,
  abierto,
  alternar,
  ocultarEncabezado = false,
  children,
}: {
  titulo: string;
  ayuda: string;
  abierto: boolean;
  alternar: () => void;
  ocultarEncabezado?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      {!ocultarEncabezado && (
        <>
          <button
            type="button"
            onClick={alternar}
            className="flex w-full items-center gap-1.5 text-left"
          >
            <ChevronDown
              className={`text-muted-foreground h-4 w-4 shrink-0 transition-transform ${abierto ? 'rotate-180' : ''}`}
            />
            <span className="text-foreground text-sm font-medium">
              {titulo}
            </span>
          </button>
          <p className="text-muted-foreground mt-0.5 ml-[22px] text-xs">
            {ayuda}
          </p>
        </>
      )}
      {abierto && (
        <div className={ocultarEncabezado ? '' : 'mt-3'}>{children}</div>
      )}
    </div>
  );
}
