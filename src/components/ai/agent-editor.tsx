'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2,
  Send,
  Sparkles,
  X,
  KeyRound,
  Eye,
  EyeOff,
  Search,
  Package,
  Briefcase,
  Radio,
  Settings as SettingsIcon,
  Globe,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Wand2,
  CheckCheck,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import type {
  AiAgent,
  AiProductScope,
  AiResponseMode,
  AiScope,
  AiTone,
  BusinessHours,
  ShopifyProductSummary,
} from '@/lib/ai/types';
import type { AgentSummary } from '@/app/(dashboard)/asistente/page';
import type { Channel } from '@/types';

const TONES: { value: AiTone; label: string; hint: string }[] = [
  { value: 'friendly', label: 'Cercano', hint: 'Cálido, conversacional, frases cortas.' },
  { value: 'formal', label: 'Formal', hint: 'Profesional, distancia respetuosa.' },
  { value: 'casual', label: 'Coloquial', hint: 'Directo, modismos suaves.' },
  { value: 'concise', label: 'Breve', hint: 'Una o dos frases, sin rodeos.' },
];

// Modelo fijo: Haiku es la mejor relación calidad/costo y la decisión
// no aporta valor al merchant; lo elegimos por ellos. Si en el futuro
// queremos exponerlo, vuelve a ser una constante con varios valores.
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

const CHANNELS: { value: Channel; label: string }[] = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'messenger', label: 'Messenger' },
  { value: 'gmail', label: 'Gmail' },
  { value: 'outlook', label: 'Outlook' },
];

const LANGUAGES: { code: string; label: string }[] = [
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'Inglés' },
  { code: 'pt', label: 'Portugués' },
  { code: 'fr', label: 'Francés' },
];

const LANGUAGE_LABELS = Object.fromEntries(LANGUAGES.map((l) => [l.code, l.label]));

const RESPONSE_MODES: { value: AiResponseMode; label: string; hint: string }[] = [
  {
    value: 'single',
    label: 'Un solo mensaje',
    hint: 'Una respuesta completa por turno.',
  },
  {
    value: 'multi',
    label: 'Varios mensajes cortos',
    hint: 'Parte la respuesta en mensajes naturales.',
  },
  {
    value: 'dynamic',
    label: 'Dinámico',
    hint: 'El asistente decide según el contenido.',
  },
];

const RESPONSE_MODE_LABELS = Object.fromEntries(
  RESPONSE_MODES.map((m) => [m.value, m.label]),
);

const TIMEZONES: { value: string; label: string }[] = [
  { value: 'America/Bogota', label: 'Bogotá (UTC-5)' },
  { value: 'America/Mexico_City', label: 'Ciudad de México (UTC-6)' },
  { value: 'America/Lima', label: 'Lima (UTC-5)' },
  { value: 'America/Santiago', label: 'Santiago (UTC-4)' },
  { value: 'America/Buenos_Aires', label: 'Buenos Aires (UTC-3)' },
  { value: 'America/Caracas', label: 'Caracas (UTC-4)' },
  { value: 'America/Guayaquil', label: 'Quito (UTC-5)' },
  { value: 'America/La_Paz', label: 'La Paz (UTC-4)' },
  { value: 'America/Asuncion', label: 'Asunción (UTC-3)' },
  { value: 'America/Montevideo', label: 'Montevideo (UTC-3)' },
  { value: 'America/Sao_Paulo', label: 'São Paulo (UTC-3)' },
  { value: 'America/Panama', label: 'Panamá (UTC-5)' },
  { value: 'America/Costa_Rica', label: 'San José (UTC-6)' },
  { value: 'America/Guatemala', label: 'Guatemala (UTC-6)' },
  { value: 'America/El_Salvador', label: 'San Salvador (UTC-6)' },
  { value: 'America/Tegucigalpa', label: 'Tegucigalpa (UTC-6)' },
  { value: 'America/Managua', label: 'Managua (UTC-6)' },
  { value: 'America/Santo_Domingo', label: 'Santo Domingo (UTC-4)' },
  { value: 'America/Havana', label: 'La Habana (UTC-5)' },
  { value: 'America/Puerto_Rico', label: 'San Juan (UTC-4)' },
];

const TIMEZONE_LABELS = Object.fromEntries(TIMEZONES.map((t) => [t.value, t.label]));

const WEEK_DAYS: { value: 0 | 1 | 2 | 3 | 4 | 5 | 6; short: string; long: string }[] = [
  { value: 1, short: 'Lun', long: 'Lunes' },
  { value: 2, short: 'Mar', long: 'Martes' },
  { value: 3, short: 'Mié', long: 'Miércoles' },
  { value: 4, short: 'Jue', long: 'Jueves' },
  { value: 5, short: 'Vie', long: 'Viernes' },
  { value: 6, short: 'Sáb', long: 'Sábado' },
  { value: 0, short: 'Dom', long: 'Domingo' },
];

function readBusinessHours(bh: BusinessHours | null | undefined): {
  enabled: boolean;
  start: string;
  end: string;
  timezone: string;
  days: number[];
} {
  if (!bh || !bh.windows) {
    return {
      enabled: false,
      start: '09:00',
      end: '18:00',
      timezone: 'America/Bogota',
      days: [1, 2, 3, 4, 5],
    };
  }
  const dayKeys = Object.keys(bh.windows ?? {})
    .map((k) => Number(k))
    .filter((k) => Number.isInteger(k));
  let start = '09:00';
  let end = '18:00';
  for (const k of dayKeys) {
    const win = bh.windows[k as 0 | 1 | 2 | 3 | 4 | 5 | 6]?.[0];
    if (win && /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(win)) {
      const [a, b] = win.split('-');
      start = a;
      end = b;
      break;
    }
  }
  return {
    enabled: dayKeys.length > 0,
    start,
    end,
    timezone: bh.timezone || 'America/Bogota',
    days: dayKeys.length > 0 ? dayKeys : [1, 2, 3, 4, 5],
  };
}

function buildBusinessHours(
  enabled: boolean,
  start: string,
  end: string,
  timezone: string,
  days: number[],
): BusinessHours | null {
  if (!enabled || days.length === 0) return null;
  const window = `${start}-${end}`;
  const windows: BusinessHours['windows'] = {};
  for (const d of days) {
    windows[d as 0 | 1 | 2 | 3 | 4 | 5 | 6] = [window];
  }
  return { timezone, windows };
}

interface AgentEditorProps {
  workspaceId: string;
  agent: AgentSummary | null;
  onClose: () => void;
  onSaved: (saved: AgentSummary) => void | Promise<void>;
  /** Insert/refresh sin cerrar el editor — lo usa la generación con IA
   *  porque el usuario sigue editando después de la creación. */
  onAgentUpserted?: (saved: AgentSummary) => void | Promise<void>;
}

export function AgentEditor({
  workspaceId,
  agent,
  onClose,
  onSaved,
  onAgentUpserted,
}: AgentEditorProps) {
  const fetchWithCsrf = useFetchWithCsrf();
  // Persistimos el id del agente "en edición" en estado local porque
  // la generación con IA crea el row a medio camino. Inicialmente es
  // el agente que entró por props (null cuando es "Nuevo"), pero al
  // generar lo levantamos al id devuelto para que el botón Guardar
  // haga PATCH en lugar de POST otro registro.
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(
    agent?.id ?? null,
  );
  const editing = Boolean(currentAgentId);
  const hasApiKey = agent?.has_api_key ?? false;

  const [name, setName] = useState(agent?.name ?? '');
  const [isActive, setIsActive] = useState(agent?.is_active ?? false);
  const [persona, setPersona] = useState(
    agent?.persona ??
      'Eres un asistente de atención al cliente. Respondes con calidez y vas directo al grano.',
  );
  const [knowledge, setKnowledge] = useState(agent?.knowledge ?? '');
  const [knowledgeUrl, setKnowledgeUrl] = useState(agent?.knowledge_url ?? '');
  const [knowledgeSyncedAt, setKnowledgeSyncedAt] = useState<string | null>(
    agent?.knowledge_synced_at ?? null,
  );
  const [syncingKnowledge, setSyncingKnowledge] = useState(false);
  const [showKnowledgePreview, setShowKnowledgePreview] = useState(false);
  const [language, setLanguage] = useState(agent?.language ?? 'es');
  const [tone, setTone] = useState<AiTone>(agent?.tone ?? 'friendly');
  // max_response_chars y reply_delay_seconds dejan de ser editables
  // desde la UI: el primero se controla con la instrucción del persona
  // (Claude respeta el largo); el segundo se duplicaba con
  // inbound_debounce_seconds. Conservamos los valores del agente para
  // no perderlos al guardar, pero ya no exponemos sliders.
  const maxChars = agent?.max_response_chars ?? 500;
  const delaySec = agent?.reply_delay_seconds ?? 0;
  const [contextMessages, setContextMessages] = useState(agent?.context_messages ?? 10);
  const [replyWhenAssigned, setReplyWhenAssigned] = useState(
    agent?.reply_when_assigned ?? false,
  );
  const [replyOutsideHours, setReplyOutsideHours] = useState(
    agent?.reply_outside_hours ?? true,
  );
  const [escalateKeywords, setEscalateKeywords] = useState<string[]>(
    agent?.escalate_keywords ?? ['humano', 'agente', 'reembolso'],
  );
  const [escalateInput, setEscalateInput] = useState('');
  const [responseMode, setResponseMode] = useState<AiResponseMode>(
    agent?.response_mode ?? 'single',
  );
  const [inboundDebounce, setInboundDebounce] = useState<number>(
    agent?.inbound_debounce_seconds ?? 15,
  );
  const [escalateAfterMessages, setEscalateAfterMessages] = useState<number>(
    agent?.escalate_after_messages ?? 0,
  );
  const initialBh = readBusinessHours(agent?.business_hours);
  const [hoursEnabled, setHoursEnabled] = useState<boolean>(initialBh.enabled);
  const [hoursStart, setHoursStart] = useState<string>(initialBh.start);
  const [hoursEnd, setHoursEnd] = useState<string>(initialBh.end);
  const [hoursTimezone, setHoursTimezone] = useState<string>(initialBh.timezone);
  const [hoursDays, setHoursDays] = useState<number[]>(initialBh.days);
  // Modelo fijo, sin selector. El runner lee agent.model del registro;
  // mandamos siempre DEFAULT_MODEL en el payload de guardado.
  const [scope, setScope] = useState<AiScope>(agent?.scope ?? 'workspace');
  const [channels, setChannels] = useState<Channel[]>(
    (agent?.ai_agent_channels ?? []).map((c) => c.channel as Channel),
  );
  const [productScope, setProductScope] = useState<AiProductScope>(
    agent?.product_scope ?? 'all',
  );
  const [selectedProducts, setSelectedProducts] = useState<string[]>(
    (agent?.ai_agent_products ?? []).map((p) => p.product_id),
  );
  const [catalog, setCatalog] = useState<ShopifyProductSummary[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  const [saving, setSaving] = useState(false);
  const [testMessage, setTestMessage] = useState('');
  // El preview es una conversación multi-turno tipo WhatsApp. Cada
  // turno guarda los chunks individuales para que el modo "multi"
  // (varios bubbles) se vea como en producción.
  type TestTurn = { role: 'user' | 'assistant'; chunks: string[]; stamp: string };
  const [testHistory, setTestHistory] = useState<TestTurn[]>([]);
  const [testing, setTesting] = useState(false);
  const testScrollRef = useRef<HTMLDivElement>(null);

  // Auto-generación con IA desde la URL del sitio. Lo concentramos en
  // la pestaña "Mi negocio" para que el primer paso de un usuario nuevo
  // sea "pegá tu URL → te armo el agente". El timer va rotando las
  // pistas de progreso así no se ve congelado durante el crawl + LLM.
  const [genUrl, setGenUrl] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genHint, setGenHint] = useState<string>('');
  const [showAdvancedPersona, setShowAdvancedPersona] = useState(false);

  type TabKey = 'business' | 'reach' | 'advanced';
  const [tab, setTab] = useState<TabKey>('business');
  const TABS: { key: TabKey; label: string; icon: typeof Briefcase }[] = [
    { key: 'business', label: 'Mi negocio', icon: Briefcase },
    { key: 'reach', label: 'Alcance', icon: Radio },
    { key: 'advanced', label: 'Avanzado', icon: SettingsIcon },
  ];

  // Rotación cosmetica de las pistas de "estamos haciendo X" mientras
  // dura la llamada al endpoint generate-from-url. No bloquea nada,
  // solo le da vida al loader que de otra forma se ve eterno.
  useEffect(() => {
    if (!generating) return;
    const hints = [
      'Indizando tu home…',
      'Leyendo políticas y FAQ…',
      'Escribiendo el tono del asistente…',
      'Ajustando reglas de escalamiento…',
      'Casi listo…',
    ];
    let i = 0;
    setGenHint(hints[0]);
    const t = setInterval(() => {
      i = (i + 1) % hints.length;
      setGenHint(hints[i]);
    }, 3500);
    return () => clearInterval(t);
  }, [generating]);

  async function generateFromUrl() {
    const url = genUrl.trim();
    if (!url) {
      toast.error('Pega la URL de tu tienda.');
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      toast.error('La URL debe empezar con https://');
      return;
    }
    setGenerating(true);
    try {
      const res = await fetchWithCsrf('/api/ai/agents/generate-from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, workspace_id: workspaceId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? 'No se pudo generar el asistente.');
        return;
      }
      const a = json.agent as AgentSummary;
      // Volcamos todo lo generado en el formulario; el usuario igual
      // puede tocar antes de guardar (o salir del editor y verlo en la
      // lista, ya quedó persistido).
      setName(a.name ?? '');
      setPersona(a.persona ?? '');
      setKnowledge(a.knowledge ?? '');
      setKnowledgeUrl(a.knowledge_url ?? url);
      setKnowledgeSyncedAt(a.knowledge_synced_at ?? new Date().toISOString());
      setTone((a.tone as AiTone) ?? 'friendly');
      setResponseMode((a.response_mode as AiResponseMode) ?? 'multi');
      setInboundDebounce(a.inbound_debounce_seconds ?? 15);
      setLanguage(a.language ?? 'es');
      setIsActive(Boolean(a.is_active));
      setCurrentAgentId(a.id);
      toast.success('Asistente generado. Revísalo y guarda los cambios.');
      // Notificamos al padre para que aparezca en la lista ya como
      // creado — el editor sigue abierto en modo "edición" del nuevo.
      // Usamos onAgentUpserted (no onSaved) porque onSaved cierra el
      // editor y queremos que el usuario revise lo generado.
      if (onAgentUpserted) {
        await onAgentUpserted(a);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al generar.');
    } finally {
      setGenerating(false);
      setGenHint('');
    }
  }

  function toggleEscalate(kw: string) {
    setEscalateKeywords((prev) => prev.filter((k) => k !== kw));
  }

  function addEscalate() {
    const v = escalateInput.trim().toLowerCase();
    if (!v) return;
    if (escalateKeywords.includes(v)) return;
    setEscalateKeywords((prev) => [...prev, v]);
    setEscalateInput('');
  }

  function toggleChannel(c: Channel) {
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  function toggleHoursDay(d: number) {
    setHoursDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b),
    );
  }

  function toggleProduct(id: string) {
    setSelectedProducts((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  // Load the synced Shopify catalog the first time the user expands
  // "Productos asignados" so we don't pull it for every editor open.
  useEffect(() => {
    if (productScope !== 'specific' || catalog.length > 0) return;
    let cancelled = false;
    (async () => {
      setCatalogLoading(true);
      try {
        const res = await fetch('/api/shopify/products');
        const json = await res.json();
        if (!cancelled && res.ok) {
          setCatalog((json.products ?? []) as ShopifyProductSummary[]);
        }
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productScope, catalog.length]);

  const filteredCatalog = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter((p) => p.title.toLowerCase().includes(q));
  }, [catalog, productSearch]);

  async function save() {
    if (!name.trim()) {
      toast.error('Falta el nombre');
      return;
    }
    if (inboundDebounce < 0 || inboundDebounce > 60) {
      toast.error('La espera debe estar entre 0 y 60 segundos');
      return;
    }
    if (escalateAfterMessages < 0) {
      toast.error('El escalamiento no puede ser negativo');
      return;
    }
    if (hoursEnabled) {
      if (hoursStart >= hoursEnd) {
        toast.error('La hora de inicio debe ser menor que la de fin');
        return;
      }
      if (hoursDays.length === 0) {
        toast.error('Elige al menos un día del horario');
        return;
      }
    }
    setSaving(true);
    const payload: Partial<AiAgent> & {
      workspace_id?: string;
      channels?: string[];
      product_ids?: string[];
      api_key?: string;
    } = {
      workspace_id: workspaceId,
      name: name.trim(),
      is_active: isActive,
      persona: persona.trim(),
      knowledge: knowledge.trim() || null,
      knowledge_url: knowledgeUrl.trim() || null,
      language,
      tone,
      max_response_chars: maxChars,
      reply_delay_seconds: delaySec,
      context_messages: contextMessages,
      response_mode: responseMode,
      inbound_debounce_seconds: inboundDebounce,
      reply_when_assigned: replyWhenAssigned,
      reply_outside_hours: replyOutsideHours,
      business_hours: buildBusinessHours(
        hoursEnabled,
        hoursStart,
        hoursEnd,
        hoursTimezone,
        hoursDays,
      ),
      escalate_keywords: escalateKeywords,
      escalate_after_messages: escalateAfterMessages,
      model: DEFAULT_MODEL,
      scope,
      channels: scope === 'channels' ? channels : [],
      product_scope: productScope,
      product_ids: productScope === 'specific' ? selectedProducts : [],
    };
    if (apiKey.trim()) payload.api_key = apiKey.trim();

    const url = currentAgentId
      ? `/api/ai/agents/${currentAgentId}`
      : '/api/ai/agents';
    const method = currentAgentId ? 'PATCH' : 'POST';
    const res = await fetchWithCsrf(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? 'No se pudo guardar');
      return;
    }
    toast.success(editing ? 'Guardado' : 'Asistente creado');
    if (json.agent) {
      const saved = json.agent as AgentSummary;
      setCurrentAgentId(saved.id);
      await onSaved(saved);
    } else if (agent) {
      await onSaved(agent);
    }
  }

  async function syncKnowledge() {
    if (!currentAgentId) {
      toast.error('Guarda el asistente antes de sincronizar.');
      return;
    }
    const url = knowledgeUrl.trim();
    if (!url) {
      toast.error('Pega la URL de tu tienda.');
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      toast.error('La URL debe empezar con https://');
      return;
    }
    setSyncingKnowledge(true);
    try {
      const res = await fetchWithCsrf(`/api/ai/agents/${currentAgentId}/sync-knowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 202) {
        toast.error(json.error ?? 'No se pudo sincronizar');
        return;
      }
      const pages = Number(json.pages_scraped ?? 0);
      const chars = Number(json.knowledge_chars ?? 0);
      if (json.agent?.knowledge != null) setKnowledge(json.agent.knowledge);
      if (json.agent?.knowledge_url) setKnowledgeUrl(json.agent.knowledge_url);
      if (json.knowledge_synced_at) setKnowledgeSyncedAt(json.knowledge_synced_at);
      if (pages > 0) {
        toast.success(
          `Sincronizado. ${pages} página${pages === 1 ? '' : 's'} indexada${pages === 1 ? '' : 's'} (${chars} caracteres).`,
        );
      } else {
        toast.message('Sincronización iniciada. Vuelve a intentar en un minuto.');
      }
      if (json.agent) {
        // En sync-knowledge no cerramos el editor (el usuario sigue
        // afinando). Usamos el callback de upsert para refrescar la
        // lista sin perder el contexto de edición.
        if (onAgentUpserted) {
          await onAgentUpserted(json.agent as AgentSummary);
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al sincronizar');
    } finally {
      setSyncingKnowledge(false);
    }
  }

  function formatSyncedAt(iso: string | null): string {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleString('es', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }

  function nowStamp(): string {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  async function runTest() {
    const text = testMessage.trim();
    if (!text) return;
    if (!currentAgentId) {
      toast.error('Guarda primero para probar.');
      return;
    }
    // Bubble del usuario inmediato — UX de chat real.
    setTestHistory((prev) => [
      ...prev,
      { role: 'user', chunks: [text], stamp: nowStamp() },
    ]);
    setTestMessage('');
    setTesting(true);
    try {
      const res = await fetchWithCsrf(`/api/ai/agents/${currentAgentId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falló');
      const reply: string = json.reply ?? '';
      const chunks: string[] = Array.isArray(json.chunks) && json.chunks.length > 0
        ? json.chunks
        : reply
          ? [reply]
          : [];
      setTestHistory((prev) => [
        ...prev,
        { role: 'assistant', chunks, stamp: nowStamp() },
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error');
    } finally {
      setTesting(false);
    }
  }

  function resetTestConversation() {
    setTestHistory([]);
    setTestMessage('');
  }

  // Auto-scroll del preview al llegar mensajes nuevos.
  useEffect(() => {
    requestAnimationFrame(() => {
      if (testScrollRef.current) {
        testScrollRef.current.scrollTop = testScrollRef.current.scrollHeight;
      }
    });
  }, [testHistory, testing]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="grid max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden border-border bg-card p-0 text-foreground sm:max-w-3xl lg:max-w-5xl"
        showCloseButton={false}
      >
        <div className="flex items-start justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="size-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-foreground">
                {editing ? name || 'Asistente' : 'Nuevo asistente'}
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                Responde automáticamente con el contexto completo de cada chat.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              {isActive ? 'Activo' : 'Pausado'}
            </label>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="grid min-h-0 gap-0 overflow-hidden sm:grid-cols-[180px_minmax(0,1fr)_320px]">
          {/* Section nav rail */}
          <nav className="border-r border-border bg-card/40 p-2 sm:py-4">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                    active
                      ? 'bg-primary/10 text-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <Icon className="size-4" />
                  {t.label}
                </button>
              );
            })}
          </nav>

          {/* Form column */}
          <div className="space-y-6 overflow-y-auto p-6">
            {tab === 'business' && (
              <>
                {/* Card de generación automática con IA. Es el primer
                    contacto del usuario nuevo con el editor: pegás tu URL
                    y la IA arma identidad + conocimiento + tono en un paso. */}
                <div className="relative overflow-hidden rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-5">
                  <div className="flex items-start gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                      <Wand2 className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">
                        Generar con IA desde mi web
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Pega la URL de tu tienda. Leemos tu sitio y armamos
                        identidad, tono y conocimiento en menos de un minuto.
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <div className="relative flex-1">
                      <Globe className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        type="url"
                        autoFocus={!editing}
                        value={genUrl}
                        onChange={(e) => setGenUrl(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !generating) {
                            e.preventDefault();
                            void generateFromUrl();
                          }
                        }}
                        placeholder="https://tutienda.com"
                        className="bg-background pl-8"
                        disabled={generating}
                      />
                    </div>
                    <Button
                      type="button"
                      onClick={generateFromUrl}
                      disabled={generating || !genUrl.trim()}
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      {generating ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Wand2 className="size-4" />
                      )}
                      {generating ? 'Generando…' : 'Generar asistente'}
                    </Button>
                  </div>
                  {generating && genHint && (
                    <p className="mt-2 text-[11px] text-muted-foreground">{genHint}</p>
                  )}
                  {!generating && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Vamos a leer tu home, políticas, FAQ y páginas de productos
                      (hasta 30 páginas). El proceso tarda unos 30 a 60 segundos.
                    </p>
                  )}
                </div>

                {/* Identidad: nombre + tono + idioma. El modelo lo
                    elegimos nosotros (Haiku) para no abrumar al usuario
                    con decisiones técnicas. */}
                <SectionCard
                  title="Identidad del asistente"
                  hint="Cómo se llama y qué tono usa. Edítalo si quieres."
                >
                  <Field label="Nombre del asistente">
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Pili"
                      className="bg-background"
                    />
                  </Field>
                  <Field label="Tono">
                    <div className="grid gap-2 sm:grid-cols-4">
                      {TONES.map((t) => (
                        <button
                          key={t.value}
                          type="button"
                          onClick={() => setTone(t.value)}
                          title={t.hint}
                          className={cn(
                            'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                            tone === t.value
                              ? 'border-primary/60 bg-primary/10 text-foreground'
                              : 'border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                          )}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Ajusta sutilmente el estilo. La personalidad real la define
                      lo que escribís más abajo en &quot;Cómo se presenta y actúa&quot;.
                    </p>
                  </Field>
                  <Field label="Idioma">
                    <Select value={language} onValueChange={(v) => setLanguage(v ?? 'es')}>
                      <SelectTrigger className="w-full bg-background">
                        <SelectValue labels={LANGUAGE_LABELS} />
                      </SelectTrigger>
                      <SelectContent>
                        {LANGUAGES.map((l) => (
                          <SelectItem key={l.code} value={l.code}>
                            {l.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </SectionCard>

                {/* Persona como acordeón: la mayoría confía en la IA. El
                    botón "Editar avanzado" expone el textarea para quien
                    quiera reescribir el system prompt entero. */}
                <SectionCard
                  title="Cómo se presenta y actúa"
                  hint="System prompt del asistente. Edítalo solo para afinar reglas o tono."
                  right={
                    <button
                      type="button"
                      onClick={() => setShowAdvancedPersona((v) => !v)}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {showAdvancedPersona ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronRight className="size-3.5" />
                      )}
                      Editar avanzado
                    </button>
                  }
                >
                  {showAdvancedPersona ? (
                    <Textarea
                      value={persona}
                      rows={10}
                      onChange={(e) => setPersona(e.target.value)}
                      placeholder="Eres Pili, asesora de Vitalú. Atiendes con calidez, una pregunta por turno, nunca admites ser IA."
                      className="resize-y bg-background font-mono text-xs leading-relaxed"
                    />
                  ) : (
                    <p className="line-clamp-3 rounded-md border border-border bg-background/60 p-3 text-xs leading-relaxed text-muted-foreground">
                      {persona.trim() || 'Sin definir. Genera con IA o toca "Editar avanzado".'}
                    </p>
                  )}
                </SectionCard>

                {/* Base de conocimiento. Sigue igual: URL + sincronizar
                    + preview, ahora dentro de "Mi negocio". */}
                <SectionCard
                  title="Base de conocimiento"
                  hint="Pega la URL de tu sitio y sincroniza. Indexamos tu home, políticas, FAQ y productos."
                >
                  <Field label="URL de tu tienda">
                    <div className="relative">
                      <Globe className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        type="url"
                        value={knowledgeUrl}
                        onChange={(e) => setKnowledgeUrl(e.target.value)}
                        placeholder="https://tutienda.com"
                        className="bg-background pl-8"
                      />
                    </div>
                  </Field>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Button
                      type="button"
                      onClick={syncKnowledge}
                      disabled={syncingKnowledge || !editing}
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      {syncingKnowledge ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <RefreshCw className="size-4" />
                      )}
                      Sincronizar desde mi web
                    </Button>
                    {knowledgeSyncedAt && (
                      <p className="text-[11px] text-muted-foreground">
                        Última sincronización: {formatSyncedAt(knowledgeSyncedAt)}
                      </p>
                    )}
                  </div>
                  {!editing && (
                    <p className="rounded-md border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
                      Guarda el asistente para sincronizar.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowKnowledgePreview((v) => !v)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {showKnowledgePreview ? (
                      <ChevronDown className="size-3.5" />
                    ) : (
                      <ChevronRight className="size-3.5" />
                    )}
                    Vista previa del conocimiento ({knowledge.length} caracteres)
                  </button>
                  {showKnowledgePreview && (
                    <div className="max-h-[260px] overflow-y-auto rounded-lg border border-border bg-background p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                      {knowledge.trim() ? (
                        <pre className="whitespace-pre-wrap break-words">
                          {knowledge.slice(0, 2000)}
                          {knowledge.length > 2000 && '\n\n…'}
                        </pre>
                      ) : (
                        <p className="italic">Sin contenido. Sincroniza tu web o pega info abajo.</p>
                      )}
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    Vuelve a sincronizar cuando cambies productos o precios.
                  </p>
                </SectionCard>

                <Field label="Información del negocio">
                  <Textarea
                value={knowledge}
                onChange={(e) => setKnowledge(e.target.value)}
                rows={6}
                placeholder={'Productos:\n- Crema antiarrugas $50.000\n- Sérum vitamina C $80.000\n\nPolíticas:\n- Envíos en 2 días hábiles\n- Devolución en 15 días'}
                className="resize-y bg-background font-mono text-xs leading-relaxed"
                  />
                </Field>

                <Field label="¿Sobre qué productos puede hablar?">
                  <div className="grid grid-cols-2 gap-2">
                    <ScopeCard
                      active={productScope === 'all'}
                      onClick={() => setProductScope('all')}
                      title="Todo el catálogo"
                      hint="Todos los productos sincronizados de Shopify."
                    />
                    <ScopeCard
                      active={productScope === 'specific'}
                      onClick={() => setProductScope('specific')}
                      title="Solo algunos"
                      hint="Elige los productos abajo."
                    />
                  </div>
                  {productScope === 'specific' && (
                    <div className="mt-2 space-y-2">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={productSearch}
                          onChange={(e) => setProductSearch(e.target.value)}
                          placeholder="Buscar producto…"
                          className="bg-background pl-8 text-sm"
                        />
                      </div>
                      <div className="max-h-[280px] overflow-y-auto rounded-lg border border-border bg-background">
                        {catalogLoading ? (
                          <div className="flex justify-center py-6">
                            <Loader2 className="size-4 animate-spin text-muted-foreground" />
                          </div>
                        ) : filteredCatalog.length === 0 ? (
                          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                            {catalog.length === 0
                              ? 'Sin productos sincronizados. Conecta Shopify primero.'
                              : 'Sin resultados.'}
                          </p>
                        ) : (
                          <ul className="divide-y divide-border">
                            {filteredCatalog.map((p) => {
                              const on = selectedProducts.includes(p.id);
                              return (
                                <li key={p.id}>
                                  <button
                                    type="button"
                                    onClick={() => toggleProduct(p.id)}
                                    className={cn(
                                      'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent/40',
                                      on && 'bg-primary/10',
                                    )}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={on}
                                      readOnly
                                      className="accent-primary"
                                    />
                                    {p.image_url ? (
                                      /* eslint-disable-next-line @next/next/no-img-element */
                                      <img
                                        src={p.image_url}
                                        alt=""
                                        className="size-8 shrink-0 rounded object-cover"
                                      />
                                    ) : (
                                      <div className="flex size-8 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                                        <Package className="size-3.5" />
                                      </div>
                                    )}
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm text-foreground">
                                        {p.title}
                                      </p>
                                      <p className="truncate text-[11px] text-muted-foreground">
                                        {[
                                          p.product_type,
                                          p.vendor,
                                          p.price_min != null
                                            ? p.price_min === p.price_max
                                              ? `$${p.price_min}`
                                              : `$${p.price_min}-${p.price_max}`
                                            : null,
                                        ]
                                          .filter(Boolean)
                                          .join(' · ')}
                                      </p>
                                    </div>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {selectedProducts.length} producto
                        {selectedProducts.length === 1 ? '' : 's'} asignado
                        {selectedProducts.length === 1 ? '' : 's'}.
                      </p>
                    </div>
                  )}
                </Field>
              </>
            )}

            {tab === 'reach' && (
              <>
                <Field label="¿En qué canales responde?">
              <div className="grid grid-cols-2 gap-2">
                <ScopeCard
                  active={scope === 'workspace'}
                  onClick={() => setScope('workspace')}
                  title="Todos los canales"
                  hint="Vale para todos los canales conectados."
                />
                <ScopeCard
                  active={scope === 'channels'}
                  onClick={() => setScope('channels')}
                  title="Solo algunos"
                  hint="Elige los canales abajo."
                />
              </div>
              {scope === 'channels' && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {CHANNELS.map((c) => {
                    const on = channels.includes(c.value);
                    return (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => toggleChannel(c.value)}
                        className={cn(
                          'rounded-lg border px-3 py-1.5 text-sm transition-colors',
                          on
                            ? 'border-primary/60 bg-primary/10 text-foreground'
                            : 'border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                        )}
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              )}
                </Field>

                {/* Rules toggles + escalation chips share the Alcance tab. */}
                <Field label="Reglas de respuesta">
                  <div className="space-y-2">
                    <ToggleRow
                      checked={replyWhenAssigned}
                      onChange={setReplyWhenAssigned}
                      title="Responder aunque haya agente asignado"
                      hint="Por defecto, si un humano está atendiendo, la IA calla."
                    />
                    <ToggleRow
                      checked={replyOutsideHours}
                      onChange={setReplyOutsideHours}
                      title="Responder fuera del horario"
                      hint="Apagá para que solo responda dentro del horario de oficina."
                    />
                  </div>
                </Field>

                <Field label="Pasar a un humano si el mensaje contiene…">
                  <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-background p-2">
                    {escalateKeywords.map((kw) => (
                      <span
                        key={kw}
                        className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-0.5 text-xs text-primary"
                      >
                        {kw}
                        <button
                          type="button"
                          onClick={() => toggleEscalate(kw)}
                          className="rounded hover:text-red-400"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                    <input
                      value={escalateInput}
                      onChange={(e) => setEscalateInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ',') {
                          e.preventDefault();
                          addEscalate();
                        }
                      }}
                      onBlur={addEscalate}
                      placeholder="humano, reembolso…"
                      className="min-w-[140px] flex-1 bg-transparent px-1 text-xs text-foreground focus:outline-none"
                    />
                  </div>
                </Field>
              </>
            )}

            {tab === 'advanced' && (
              <>
                <SectionCard
                  title="Comportamiento de respuesta"
                  hint="Cómo entrega la respuesta el asistente y cuánto espera antes de hablar."
                >
                  <Field label="Modo de respuesta">
                    <Select
                      value={responseMode}
                      onValueChange={(v) => setResponseMode((v as AiResponseMode) ?? 'single')}
                    >
                      <SelectTrigger className="w-full bg-background">
                        <SelectValue labels={RESPONSE_MODE_LABELS} />
                      </SelectTrigger>
                      <SelectContent>
                        {RESPONSE_MODES.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            <div className="flex flex-col">
                              <span className="text-sm text-foreground">{m.label}</span>
                              <span className="text-[11px] text-muted-foreground">
                                {m.hint}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">
                      {RESPONSE_MODES.find((m) => m.value === responseMode)?.hint}
                    </p>
                  </Field>

                  <Field label="Esperar antes de responder (segundos)">
                    <Input
                      type="number"
                      min={0}
                      max={60}
                      value={inboundDebounce}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        setInboundDebounce(Number.isFinite(n) ? Math.max(0, Math.min(60, n)) : 0);
                      }}
                      className="bg-background"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Espera X segundos antes de responder por si la clienta sigue
                      escribiendo otro mensaje. Recomendado: 15s para WhatsApp.
                    </p>
                  </Field>
                </SectionCard>

                <SectionCard
                  title="Escalamiento"
                  hint="Cuándo pasar la conversación a un agente humano."
                >
                  <Field label="Escalar a humano después de N mensajes">
                    <Input
                      type="number"
                      min={0}
                      value={escalateAfterMessages}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        setEscalateAfterMessages(Number.isFinite(n) ? Math.max(0, n) : 0);
                      }}
                      className="bg-background"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Cuando el asistente lleve N intercambios sin resolver, asigna la
                      conversación a un agente humano. 0 desactiva esta regla.
                    </p>
                  </Field>
                </SectionCard>

                <SectionCard
                  title="Horario de atención"
                  hint="Define cuándo está disponible para responder."
                  right={
                    <Switch checked={hoursEnabled} onCheckedChange={setHoursEnabled} />
                  }
                >
                  {hoursEnabled && (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Inicio">
                          <Input
                            type="time"
                            value={hoursStart}
                            onChange={(e) => setHoursStart(e.target.value)}
                            className="bg-background"
                          />
                        </Field>
                        <Field label="Fin">
                          <Input
                            type="time"
                            value={hoursEnd}
                            onChange={(e) => setHoursEnd(e.target.value)}
                            className="bg-background"
                          />
                        </Field>
                      </div>

                      <Field label="Zona horaria">
                        <Select
                          value={hoursTimezone}
                          onValueChange={(v) => setHoursTimezone(v ?? 'America/Bogota')}
                        >
                          <SelectTrigger className="w-full bg-background">
                            <SelectValue labels={TIMEZONE_LABELS} />
                          </SelectTrigger>
                          <SelectContent>
                            {TIMEZONES.map((t) => (
                              <SelectItem key={t.value} value={t.value}>
                                {t.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>

                      <Field label="Días">
                        <div className="grid grid-cols-7 gap-1.5">
                          {WEEK_DAYS.map((d) => {
                            const on = hoursDays.includes(d.value);
                            return (
                              <button
                                key={d.value}
                                type="button"
                                onClick={() => toggleHoursDay(d.value)}
                                title={d.long}
                                className={cn(
                                  'rounded-lg border px-1 py-1.5 text-xs transition-colors',
                                  on
                                    ? 'border-primary/60 bg-primary/10 text-foreground'
                                    : 'border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                                )}
                              >
                                {d.short}
                              </button>
                            );
                          })}
                        </div>
                      </Field>

                      <p className="text-[11px] text-muted-foreground">
                        Fuera de horario, el asistente responde con un mensaje de fuera
                        de servicio en lugar de generar respuesta.
                      </p>
                    </>
                  )}
                  {!hoursEnabled && (
                    <p className="text-[11px] text-muted-foreground">
                      El asistente responde a toda hora. Activa para limitar a un
                      horario.
                    </p>
                  )}
                </SectionCard>

                {/* Contexto: cuántos mensajes previos pasa al modelo. El
                    largo de la respuesta lo controla la persona y la
                    espera antes de responder ya se ajusta arriba con
                    "Esperar antes de responder". */}
                <SliderField
                  label="Mensajes de contexto"
                  value={contextMessages}
                  min={1}
                  max={30}
                  step={1}
                  suffix="últimos mensajes"
                  onChange={setContextMessages}
                />

                <Field label="API key propia (opcional)">
                  <div className="relative">
                    <KeyRound className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={
                        hasApiKey
                          ? '••••••••  (ya hay una key guardada)'
                          : 'sk-ant-...'
                      }
                      className="bg-background pl-8 pr-9 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Usa tu cuenta de Anthropic en vez de la del servidor.
                    Se guarda cifrada.
                  </p>
                </Field>
              </>
            )}
          </div>

          {/* Test column — conversación multi-turno tipo WhatsApp.
              El usuario tipea como cliente; el bot del editor responde
              y se ve igual que en producción (left bubbles blancas para
              asistente, right verdes para usuario, fondo beige con dots). */}
          <aside className="flex min-h-0 flex-col overflow-hidden border-t border-border bg-muted/30 sm:border-l sm:border-t-0">
            <div className="flex items-center justify-between gap-2 border-b border-border bg-card px-4 py-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground">
                  Probar el asistente
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Conversá con el bot como si fueras un cliente.
                </p>
              </div>
              {testHistory.length > 0 && (
                <button
                  type="button"
                  onClick={resetTestConversation}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title="Reiniciar conversación"
                >
                  <RotateCcw className="size-3" />
                  Reiniciar
                </button>
              )}
            </div>
            <div
              ref={testScrollRef}
              className="flex-1 space-y-1.5 overflow-y-auto px-3 py-3"
              style={{
                backgroundColor: '#ece5dd',
                backgroundImage:
                  'radial-gradient(rgba(0,0,0,0.04) 1px, transparent 1px)',
                backgroundSize: '12px 12px',
              }}
            >
              {testHistory.length === 0 && !testing && (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-[#54656f]">
                  <Sparkles className="size-6" />
                  <p className="text-xs leading-snug">
                    Escribe un mensaje para empezar.
                  </p>
                </div>
              )}
              {testHistory.map((turn, ti) => (
                <div
                  key={ti}
                  className={cn(
                    'flex flex-col gap-1',
                    turn.role === 'user' ? 'items-end' : 'items-start',
                  )}
                >
                  {turn.chunks.length === 0 ? (
                    <div
                      className={cn(
                        'relative max-w-[85%] rounded-lg px-2 py-1.5 text-[13px] leading-snug shadow-sm',
                        turn.role === 'user'
                          ? 'rounded-br-none bg-[#dcf8c6] text-[#111b21]'
                          : 'rounded-bl-none border border-border bg-white text-[#111b21]',
                      )}
                    >
                      <span className="italic text-[#6b7280]">Sin respuesta.</span>
                    </div>
                  ) : (
                    turn.chunks.map((chunk, ci) => {
                      const isLast = ci === turn.chunks.length - 1;
                      return (
                        <div
                          key={ci}
                          className={cn(
                            'relative max-w-[85%] rounded-lg px-2 py-1.5 text-[13px] leading-snug shadow-sm',
                            turn.role === 'user'
                              ? cn(
                                  'bg-[#dcf8c6] text-[#111b21]',
                                  isLast ? 'rounded-br-none' : '',
                                )
                              : cn(
                                  'border border-border bg-white text-[#111b21]',
                                  isLast ? 'rounded-bl-none' : '',
                                ),
                          )}
                        >
                          <p className="whitespace-pre-wrap pr-10">{chunk}</p>
                          {isLast && (
                            <div className="flex items-center justify-end gap-1 text-[10px] text-[#667781]">
                              <span>{turn.stamp}</span>
                              {turn.role === 'user' && (
                                <CheckCheck className="size-3 text-[#53bdeb]" />
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              ))}
              {testing && (
                <div className="flex items-start">
                  <div className="rounded-lg rounded-bl-none border border-border bg-white px-3 py-2 text-[13px] leading-snug text-[#111b21] shadow-sm">
                    <span className="inline-flex gap-0.5">
                      <span className="size-1.5 animate-pulse rounded-full bg-[#54656f]" />
                      <span
                        className="size-1.5 animate-pulse rounded-full bg-[#54656f]"
                        style={{ animationDelay: '150ms' }}
                      />
                      <span
                        className="size-1.5 animate-pulse rounded-full bg-[#54656f]"
                        style={{ animationDelay: '300ms' }}
                      />
                    </span>
                  </div>
                </div>
              )}
              {!editing && (
                <p className="rounded-md border border-dashed border-[#b4b4a8] bg-white/60 px-3 py-2 text-[11px] text-[#54656f]">
                  Guarda el asistente antes de probarlo.
                </p>
              )}
            </div>
            <div className="border-t border-border bg-[#f0f0f0] p-2">
              <div className="flex items-end gap-2">
                <Textarea
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void runTest();
                    }
                  }}
                  rows={2}
                  placeholder="Hola, ¿tienen envío a Bogotá?"
                  className="min-h-[44px] resize-none rounded-2xl border border-[#dcdcdc] bg-white text-sm text-[#111b21]"
                  disabled={testing || !editing}
                />
                <Button
                  onClick={runTest}
                  disabled={testing || !editing || !testMessage.trim()}
                  className="size-10 shrink-0 rounded-full bg-[#25d366] p-0 text-white hover:bg-[#1ebe5a]"
                  aria-label="Enviar"
                >
                  <Send className="size-4" />
                </Button>
              </div>
            </div>
          </aside>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-card/60 px-6 py-4">
          <Button
            variant="outline"
            onClick={onClose}
            className="border-border text-foreground hover:bg-accent"
          >
            Cancelar
          </Button>
          <Button
            onClick={save}
            disabled={saving}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            Guardar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-foreground">{label}</Label>
      {children}
    </div>
  );
}

function SectionCard({
  title,
  hint,
  right,
  children,
}: {
  title: string;
  hint?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function ToggleRow({
  checked,
  onChange,
  title,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  hint: string;
}) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
      <div>
        <p className="text-sm text-foreground">{title}</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  hint?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-foreground">{label}</Label>
        <span className="text-xs tabular-nums text-foreground">
          {value} {suffix}
        </span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ScopeCard({
  active,
  onClick,
  title,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-xl border px-3 py-2.5 text-left transition-colors',
        active
          ? 'border-primary/60 bg-primary/10'
          : 'border-border bg-background hover:border-foreground/30',
      )}
    >
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </button>
  );
}
