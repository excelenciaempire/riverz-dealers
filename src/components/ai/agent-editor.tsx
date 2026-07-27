'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocalizedRouter } from '@/hooks/use-localized-router';
import Image from 'next/image';
import { toast } from 'sonner';
import {
  Loader2,
  Send,
  Sparkles,
  X,
  Eye,
  EyeOff,
  Search,
  Package,
  Briefcase,
  Radio,
  PhoneCall,
  Settings as SettingsIcon,
  ChevronDown,
  ChevronRight,
  Check,
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
import {
  VoiceSettings,
  initialVoiceState,
  type VoiceState,
} from '@/components/ai/voice-settings';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT, useLocale } from '@/hooks/use-locale';
import type { TFn } from '@/lib/i18n/translate';
import type {
  AiAgent,
  AiProductScope,
  AiResponseMode,
  AiScope,
  AiTone,
  BusinessHours,
  ShopifyProductSummary,
} from '@/lib/ai/types';
import { MIN_DEBOUNCE_SECONDS } from '@/lib/ai/types';
import type { AgentSummary } from '@/app/(dashboard)/asistente/page';
import type { Channel } from '@/types';

// label/hint son claves i18n resueltas con t() en el render.
const TONES: { value: AiTone; label: string; hint: string }[] = [
  { value: 'friendly', label: 'assistant.toneFriendly', hint: 'assistant.toneFriendlyHint' },
  { value: 'formal', label: 'assistant.toneFormal', hint: 'assistant.toneFormalHint' },
  { value: 'casual', label: 'assistant.toneCasual', hint: 'assistant.toneCasualHint' },
  { value: 'concise', label: 'assistant.toneConcise', hint: 'assistant.toneConciseHint' },
];

// Modelo fijo: Haiku es la mejor relación calidad/costo y la decisión
// no aporta valor al merchant; lo elegimos por ellos. Si en el futuro
// queremos exponerlo, vuelve a ser una constante con varios valores.
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

// El persona por defecto sigue el idioma del merchant (su locale de UI): un
// merchant de habla inglesa arranca con un persona en inglés. Guardamos ambas
// variantes para reconocer "el persona sigue siendo el default" sin importar
// el idioma con que se sembró (ver isDefaultPersona).
const DEFAULT_PERSONAS: Record<'es' | 'en', string> = {
  es: 'Eres un asistente de atención al cliente. Respondes con calidez y vas directo al grano.',
  en: 'You are a customer-support assistant. You reply warmly and get straight to the point.',
};

function defaultPersona(locale: string): string {
  return DEFAULT_PERSONAS[locale === 'en' ? 'en' : 'es'];
}

/** True if the persona is still an untouched default (any locale) or empty —
 *  i.e. safe to overwrite when the merchant picks a product. */
function isDefaultPersona(persona: string): boolean {
  const s = persona.trim();
  return s === '' || s === DEFAULT_PERSONAS.es || s === DEFAULT_PERSONAS.en;
}

// `icon` es la ruta del logo de la marca; los canales sin logo propio
// (las llamadas) se dibujan con un ícono de la librería.
const CHANNELS: { value: Channel; label: string; icon: string | null }[] = [
  { value: 'whatsapp', label: 'WhatsApp', icon: '/channels/whatsapp.svg' },
  { value: 'instagram', label: 'Instagram', icon: '/channels/instagram.svg' },
  { value: 'messenger', label: 'Messenger', icon: '/channels/messenger.svg' },
  { value: 'gmail', label: 'Gmail', icon: '/channels/gmail.svg' },
  { value: 'outlook', label: 'Outlook', icon: '/channels/microsoftoutlook.svg' },
  { value: 'mercadolibre', label: 'Mercado Libre', icon: '/channels/mercadolibre.svg' },
];

/**
 * Las llamadas son un canal más para el runtime (`pickVoiceAgent` acepta
 * scope='workspace' o el canal 'voice'), pero no se ofrecía aquí: un agente
 * puesto en "Solo algunos" quedaba excluido de las llamadas aunque tuviera
 * la voz activada. Sólo aparece si la voz está encendida — no tiene sentido
 * elegir el canal de llamadas para un agente que no llama.
 */
const VOICE_CHANNEL: { value: Channel; label: string; icon: string | null } = {
  value: 'voice',
  label: 'nav.voice',
  icon: null,
};

// label es una clave i18n resuelta con t() en el render.
const LANGUAGES: { code: string; label: string }[] = [
  { code: 'es', label: 'assistant.languageSpanish' },
  { code: 'en', label: 'assistant.languageEnglish' },
  { code: 'pt', label: 'assistant.languagePortuguese' },
  { code: 'fr', label: 'assistant.languageFrench' },
];

// label/hint son claves i18n resueltas con t() en el render.
const RESPONSE_MODES: { value: AiResponseMode; label: string; hint: string }[] = [
  {
    value: 'single',
    label: 'assistant.responseModeSingle',
    hint: 'assistant.responseModeSingleHint',
  },
  {
    value: 'multi',
    label: 'assistant.responseModeMulti',
    hint: 'assistant.responseModeMultiHint',
  },
  {
    value: 'dynamic',
    label: 'assistant.responseModeDynamic',
    hint: 'assistant.responseModeDynamicHint',
  },
];

// label es una clave i18n resuelta con t() en el render. El offset UTC va
// en la traducción porque la ciudad cambia entre idiomas.
const TIMEZONES: { value: string; label: string }[] = [
  { value: 'America/Bogota', label: 'assistant.tzBogota' },
  { value: 'America/Mexico_City', label: 'assistant.tzMexicoCity' },
  { value: 'America/Lima', label: 'assistant.tzLima' },
  { value: 'America/Santiago', label: 'assistant.tzSantiago' },
  { value: 'America/Buenos_Aires', label: 'assistant.tzBuenosAires' },
  { value: 'America/Caracas', label: 'assistant.tzCaracas' },
  { value: 'America/Guayaquil', label: 'assistant.tzQuito' },
  { value: 'America/La_Paz', label: 'assistant.tzLaPaz' },
  { value: 'America/Asuncion', label: 'assistant.tzAsuncion' },
  { value: 'America/Montevideo', label: 'assistant.tzMontevideo' },
  { value: 'America/Sao_Paulo', label: 'assistant.tzSaoPaulo' },
  { value: 'America/Panama', label: 'assistant.tzPanama' },
  { value: 'America/Costa_Rica', label: 'assistant.tzSanJose' },
  { value: 'America/Guatemala', label: 'assistant.tzGuatemala' },
  { value: 'America/El_Salvador', label: 'assistant.tzSanSalvador' },
  { value: 'America/Tegucigalpa', label: 'assistant.tzTegucigalpa' },
  { value: 'America/Managua', label: 'assistant.tzManagua' },
  { value: 'America/Santo_Domingo', label: 'assistant.tzSantoDomingo' },
  { value: 'America/Havana', label: 'assistant.tzHavana' },
  { value: 'America/Puerto_Rico', label: 'assistant.tzSanJuan' },
];

// short/long son claves i18n resueltas con t() en el render.
const WEEK_DAYS: { value: 0 | 1 | 2 | 3 | 4 | 5 | 6; short: string; long: string }[] = [
  { value: 1, short: 'assistant.dayMonShort', long: 'assistant.dayMonLong' },
  { value: 2, short: 'assistant.dayTueShort', long: 'assistant.dayTueLong' },
  { value: 3, short: 'assistant.dayWedShort', long: 'assistant.dayWedLong' },
  { value: 4, short: 'assistant.dayThuShort', long: 'assistant.dayThuLong' },
  { value: 5, short: 'assistant.dayFriShort', long: 'assistant.dayFriLong' },
  { value: 6, short: 'assistant.daySatShort', long: 'assistant.daySatLong' },
  { value: 0, short: 'assistant.daySunShort', long: 'assistant.daySunLong' },
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
}: AgentEditorProps) {
  const t = useT();
  const { locale } = useLocale();
  const fetchWithCsrf = useFetchWithCsrf();
  const router = useLocalizedRouter();
  // Persistimos el id del agente "en edición" en estado local porque
  // la generación con IA crea el row a medio camino. Inicialmente es
  // el agente que entró por props (null cuando es "Nuevo"), pero al
  // generar lo levantamos al id devuelto para que el botón Guardar
  // haga PATCH en lugar de POST otro registro.
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(
    agent?.id ?? null,
  );
  const editing = Boolean(currentAgentId);
  // `isNew` = el editor se abrió en modo "crear" (sin agente previo). Se
  // mantiene aunque la generación con IA persista el row a medio camino
  // —por eso NO usamos currentAgentId—, para seguir exigiendo producto.
  const isNew = !agent;

  const [name, setName] = useState(agent?.name ?? '');
  const [isActive, setIsActive] = useState(agent?.is_active ?? false);
  const [persona, setPersona] = useState(agent?.persona ?? defaultPersona(locale));
  const [knowledge, setKnowledge] = useState(agent?.knowledge ?? '');
  // New agents default to the merchant's UI language; existing agents keep
  // whatever was saved.
  const [language, setLanguage] = useState(agent?.language ?? locale);
  const [tone, setTone] = useState<AiTone>(agent?.tone ?? 'friendly');
  // max_response_chars y reply_delay_seconds dejan de ser editables
  // desde la UI: el primero se controla con la instrucción del persona
  // (Claude respeta el largo); el segundo se duplicaba con
  // inbound_debounce_seconds. Conservamos los valores del agente para
  // no perderlos al guardar, pero ya no exponemos sliders.
  const maxChars = agent?.max_response_chars ?? 500;
  const delaySec = agent?.reply_delay_seconds ?? 0;
  // Contexto = toda la conversación (ya no es configurable; el runner usa
  // los últimos ~100 mensajes + el resumen). reply_outside_hours se deriva
  // del toggle "Horario de atención" al guardar.
  const [replyWhenAssigned, setReplyWhenAssigned] = useState(
    agent?.reply_when_assigned ?? false,
  );
  const [escalateKeywords, setEscalateKeywords] = useState<string[]>(
    agent?.escalate_keywords ?? ['humano', 'agente', 'reembolso'],
  );
  const [escalateInput, setEscalateInput] = useState('');
  const [responseMode, setResponseMode] = useState<AiResponseMode>(
    agent?.response_mode ?? 'dynamic',
  );
  const [inboundDebounce, setInboundDebounce] = useState<number>(
    agent?.inbound_debounce_seconds ?? 15,
  );
  const [escalateAfterMessages, setEscalateAfterMessages] = useState<number>(
    agent?.escalate_after_messages ?? 0,
  );
  // Seguimiento inteligente: si el cliente no responde, el asistente
  // manda un mensaje contextual de seguimiento. Migration 079.
  const [followupEnabled, setFollowupEnabled] = useState<boolean>(
    agent?.followup_enabled ?? false,
  );
  // Tope 23 h por cumplimiento Meta (ventana de 24 h). Agentes viejos con 24
  // se muestran como 23 y se corrigen al guardar.
  const [followupDelayHours, setFollowupDelayHours] = useState<number>(
    Math.min(23, agent?.followup_delay_hours ?? 23),
  );
  const [followupMaxCount, setFollowupMaxCount] = useState<number>(
    agent?.followup_max_count ?? 1,
  );
  // Cierre de ventas: si está ON, el asistente arma y crea el pedido real
  // en Shopify. Migration 080. Requiere Shopify conectado con permiso de
  // pedidos (write_orders).
  const [puedeCrearPedidos, setPuedeCrearPedidos] = useState<boolean>(
    agent?.puede_crear_pedidos ?? false,
  );
  // Estado de la conexión Shopify para gatear "Cierre de ventas". null =
  // cargando. El cierre solo se puede activar con Shopify conectado; si no,
  // mostramos un botón "Vincular" que abre un popup sin salir del editor.
  const [shopifyConnected, setShopifyConnected] = useState<boolean | null>(null);
  const [linkShop, setLinkShop] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linking, setLinking] = useState(false);
  // Id del poll de conexión Shopify, para limpiarlo al desmontar (evita
  // un setInterval huérfano si se cierra el editor a mitad de la vinculación).
  const linkTimerRef = useRef<number | null>(null);
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
  // Un asistente nuevo SIEMPRE arranca en "specific": se entrena a partir
  // del producto que elijas, así que la selección es obligatoria. Los
  // existentes conservan su scope guardado (incl. "all", por compatibilidad).
  const [productScope, setProductScope] = useState<AiProductScope>(
    agent ? (agent.product_scope ?? 'all') : 'specific',
  );
  const [selectedProducts, setSelectedProducts] = useState<string[]>(
    (agent?.ai_agent_products ?? []).map((p) => p.product_id),
  );
  const [catalog, setCatalog] = useState<ShopifyProductSummary[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  // Al elegir el primer producto de un asistente nuevo, preparamos una
  // plantilla (persona + conocimiento) desde su info e investigación.
  const [applyingProduct, setApplyingProduct] = useState(false);

  const [saving, setSaving] = useState(false);
  const [testMessage, setTestMessage] = useState('');
  // El preview es una conversación multi-turno tipo WhatsApp. Cada
  // turno guarda los chunks individuales para que el modo "multi"
  // (varios bubbles) se vea como en producción.
  type TestTurn = { role: 'user' | 'assistant'; chunks: string[]; stamp: string };
  const [testHistory, setTestHistory] = useState<TestTurn[]>([]);
  const [testing, setTesting] = useState(false);
  const testScrollRef = useRef<HTMLDivElement>(null);

  const [showAdvancedPersona, setShowAdvancedPersona] = useState(false);
  // El panel "Probar" arranca cerrado para que el form tenga el ancho
  // completo; el botón del header lo abre on-demand.
  const [showTest, setShowTest] = useState(false);

  // Voice AI config — one state object, edited by <VoiceSettings>.
  const [voice, setVoice] = useState<VoiceState>(initialVoiceState(agent ?? undefined));

  type TabKey = 'business' | 'reach' | 'voice' | 'advanced';
  const [tab, setTab] = useState<TabKey>('business');
  const TABS: { key: TabKey; label: string; icon: typeof Briefcase }[] = [
    { key: 'business', label: t('assistant.tabBusiness'), icon: Briefcase },
    { key: 'reach', label: t('assistant.tabReach'), icon: Radio },
    { key: 'voice', label: t('voice.tab'), icon: PhoneCall },
    { key: 'advanced', label: t('assistant.tabAdvanced'), icon: SettingsIcon },
  ];

  // Mapas valor→etiqueta para <SelectValue labels={...}>, resueltos con t()
  // porque las etiquetas base ahora son claves i18n.
  const LANGUAGE_LABELS = Object.fromEntries(
    LANGUAGES.map((l) => [l.code, t(l.label)]),
  );
  const RESPONSE_MODE_LABELS = Object.fromEntries(
    RESPONSE_MODES.map((m) => [m.value, t(m.label)]),
  );
  const TIMEZONE_LABELS = Object.fromEntries(
    TIMEZONES.map((tz) => [tz.value, t(tz.label)]),
  );

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
    setSelectedProducts((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      const next = [...prev, id];
      // Primer producto de un asistente nuevo → preparar la plantilla y
      // disparar la investigación del producto (lo que antes era manual).
      if (prev.length === 0) void prefillFromProduct(id);
      return next;
    });
  }

  /**
   * Plantilla de identidad del asistente a partir de un producto. Sólo pisa
   * lo que el usuario no tocó (nombre vacío, persona por defecto, "Información
   * del negocio" vacía). En cada conversación el runner igual inyecta el
   * producto completo (training_material + research); acá precargamos un
   * resumen breve en "Información del negocio" SOLO si está vacía, para que el
   * merchant vea el agente pre-armado sin duplicar la investigación completa.
   */
  function applyProductTemplate(p: ProductDetail) {
    setName((cur) => cur.trim() || t('assistant.defaultAgentName', { title: p.title }).slice(0, 60));
    // System prompt: lo arma el código a partir del producto (título +
    // cliente ideal + beneficios + objeciones si hay investigación). Solo
    // pisa el persona por defecto / vacío, nunca lo que el usuario escribió.
    setPersona((cur) =>
      isDefaultPersona(cur) ? buildPersonaFromProduct(p, locale) : cur,
    );
    // "Información del negocio": SIEMPRE queda rellena al elegir el producto
    // (si está vacía) — con el resumen del producto cuando hay investigación,
    // o un andamiaje base (envíos/políticas/pagos) que el merchant edita. Así
    // las dos cajas quedan pre-armadas, nunca una llena y la otra en blanco.
    setKnowledge((cur) =>
      cur.trim()
        ? cur
        : buildBusinessInfoFromProduct(p, t) || t('assistant.businessInfoPlaceholder'),
    );
  }

  async function prefillFromProduct(productId: string) {
    setApplyingProduct(true);
    try {
      const p = await fetchProductDetail(productId);
      if (!p) return;
      applyProductTemplate(p);
      // La investigación NO se dispara desde aquí: vive en el apartado de
      // Producto ("Generar investigación", que además lee las URLs y rellena
      // todo). El agente solo elige un producto ya enriquecido. Si todavía no
      // tiene investigación, lo sugerimos sin bloquear.
      if (p.ai_research_status === 'done') {
        toast.success(t('assistant.assistantReady'));
      } else {
        toast.message(t('assistant.productAssigned'), {
          description: t('assistant.productAssignedHint'),
        });
      }
    } catch {
      /* prefill best-effort: si falla, el usuario igual puede editar a mano */
    } finally {
      setApplyingProduct(false);
    }
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

  // Estado de la conexión Shopify (gatea "Cierre de ventas").
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/shopify/status', { cache: 'no-store' });
        const d = await res.json();
        if (!cancelled) setShopifyConnected(d?.connection?.status === 'active');
      } catch {
        if (!cancelled) setShopifyConnected(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Vincula Shopify desde un popup, sin que el usuario salga del editor. Al
  // detectar la conexión activa, habilita el cierre de ventas en el acto.
  function linkShopify() {
    const shop = linkShop.trim();
    if (!shop) {
      toast.error(t('assistant.shopDomainRequired'));
      return;
    }
    setLinking(true);
    if (linkTimerRef.current) window.clearInterval(linkTimerRef.current);
    const popup = window.open(
      `/api/shopify/install?shop=${encodeURIComponent(shop)}`,
      'shopify-connect',
      'width=620,height=760',
    );
    const started = Date.now();
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch('/api/shopify/status', { cache: 'no-store' });
        const d = await res.json();
        if (d?.connection?.status === 'active') {
          window.clearInterval(timer);
          setShopifyConnected(true);
          setLinking(false);
          setShowLinkInput(false);
          try {
            popup?.close();
          } catch {
            /* ignore */
          }
          toast.success(t('assistant.shopifyConnectedToast'));
          return;
        }
      } catch {
        /* sigue intentando */
      }
      if ((popup && popup.closed) || Date.now() - started > 180_000) {
        window.clearInterval(timer);
        setLinking(false);
      }
    }, 2000);
    linkTimerRef.current = timer;
  }

  // Limpia el poll de conexión Shopify si el editor se desmonta a media
  // vinculación (evita un setInterval huérfano golpeando /status).
  useEffect(() => {
    return () => {
      if (linkTimerRef.current) window.clearInterval(linkTimerRef.current);
    };
  }, []);

  const filteredCatalog = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter((p) => p.title.toLowerCase().includes(q));
  }, [catalog, productSearch]);

  /** Redirige (misma pestaña) a crear un producto en la sección Productos. */
  function goToCreateProduct() {
    router.push('/productos?new=1');
  }

  async function save() {
    if (!name.trim()) {
      toast.error(t('assistant.nameRequired'));
      return;
    }
    // Al crear (incl. cuando se generó con IA desde la web), exigimos al
    // menos un producto: el asistente se entrena con su información. En
    // edición respetamos el scope ya guardado.
    if (isNew && selectedProducts.length === 0) {
      setTab('business');
      setProductScope('specific');
      toast.error(t('assistant.productRequired'));
      return;
    }
    // "Solo algunos" sin ningún canal marcado guardaba un agente que no
    // responde en ninguna parte, y sin aviso: el detector de conflictos
    // también lo ignora (no ocupa ningún canal) y en Instagram deja el
    // hilo mudo. Es un estado inservible, así que lo bloqueamos.
    if (scope === 'channels' && channels.length === 0) {
      setTab('reach');
      toast.error(t('assistant.channelsRequired'));
      return;
    }
    if (inboundDebounce < 0 || inboundDebounce > 60) {
      toast.error(t('assistant.debounceRange'));
      return;
    }
    if (escalateAfterMessages < 0) {
      toast.error(t('assistant.escalateNegative'));
      return;
    }
    if (followupEnabled) {
      if (!(followupDelayHours > 0)) {
        toast.error(t('assistant.followupDelayInvalid'));
        return;
      }
      if (followupMaxCount < 1) {
        toast.error(t('assistant.followupCountInvalid'));
        return;
      }
    }
    // Un fin menor o igual que el inicio ya NO es un error: es turno noche
    // (22:00 → 02:00), que antes era inexpresable. Sólo exigimos días.
    if (hoursEnabled && hoursDays.length === 0) {
      toast.error(t('assistant.hoursDayRequired'));
      return;
    }
    // El horario de llamadas no se validaba en ningún lado: sin días se
    // guardaba y las llamadas dejaban de salir sin explicación.
    if (voice.voice_enabled && voice.voice_calling_hours.days.length === 0) {
      setTab('voice');
      toast.error(t('voice.hoursNoDays'));
      return;
    }
    setSaving(true);
    const payload: Partial<AiAgent> & {
      workspace_id?: string;
      channels?: string[];
      product_ids?: string[];
    } = {
      workspace_id: workspaceId,
      name: name.trim(),
      is_active: isActive,
      persona: persona.trim(),
      knowledge: knowledge.trim() || null,
      // Ya no editamos la URL de conocimiento a nivel agente (el producto es
      // la fuente); preservamos la que tuviera el agente para no borrarla.
      knowledge_url: agent?.knowledge_url ?? null,
      language,
      tone,
      max_response_chars: maxChars,
      reply_delay_seconds: delaySec,
      // Contexto = toda la conversación (el runner toma los últimos ~100 +
      // el resumen acumulado). Ya no es configurable; 100 es el tope que
      // usa loadContext, así que cualquier valor >= ese equivale a "todo".
      context_messages: 100,
      response_mode: responseMode,
      inbound_debounce_seconds: inboundDebounce,
      reply_when_assigned: replyWhenAssigned,
      // El horario es un único control: si está activado, sólo responde
      // dentro de la ventana (reply_outside_hours = false). Si no, 24/7.
      reply_outside_hours: !hoursEnabled,
      business_hours: buildBusinessHours(
        hoursEnabled,
        hoursStart,
        hoursEnd,
        hoursTimezone,
        hoursDays,
      ),
      escalate_keywords: escalateKeywords,
      escalate_after_messages: escalateAfterMessages,
      followup_enabled: followupEnabled,
      followup_delay_hours: followupDelayHours,
      followup_max_count: followupMaxCount,
      puede_crear_pedidos: puedeCrearPedidos,
      // Voice AI (migration 113 + 115)
      voice_enabled: voice.voice_enabled,
      voice_ai_decides: voice.voice_ai_decides,
      voice_id: voice.voice_id,
      voice_greeting: voice.voice_greeting.trim() || null,
      voice_system_prompt: voice.voice_system_prompt.trim() || null,
      voice_objectives: voice.voice_objectives,
      voice_max_call_seconds: voice.voice_max_call_seconds,
      voice_calling_hours: voice.voice_calling_hours,
      voice_max_retries: voice.voice_max_retries,
      voice_retry_delay_minutes: voice.voice_retry_delay_minutes,
      model: DEFAULT_MODEL,
      scope,
      // Si apagaron la voz, el canal de llamadas deja de tener sentido:
      // lo soltamos para no dejar un alcance que ya no aplica.
      channels:
        scope === 'channels'
          ? channels.filter((c) => c !== 'voice' || voice.voice_enabled)
          : [],
      product_scope: productScope,
      product_ids: productScope === 'specific' ? selectedProducts : [],
    };

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
      toast.error(json.error ?? t('assistant.saveError'));
      return;
    }
    toast.success(editing ? t('assistant.savedToast') : t('assistant.createdToast'));
    if (json.agent) {
      const saved = json.agent as AgentSummary;
      setCurrentAgentId(saved.id);
      await onSaved(saved);
    } else if (agent) {
      await onSaved(agent);
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
      toast.error(t('assistant.saveBeforeTest'));
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
      if (!res.ok) throw new Error(json.error ?? t('assistant.testFailed'));
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
      toast.error(t('assistant.genericError'));
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
        className="grid max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden border-border bg-card p-0 text-foreground sm:max-w-3xl lg:max-w-5xl"
        showCloseButton={false}
      >
        <div className="flex items-start justify-between border-b border-border px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="size-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-foreground">
                {editing ? name || t('assistant.assistant') : t('assistant.newAgent')}
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                {t('assistant.editorSubtitle')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowTest((v) => !v)}
              className="hidden items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent sm:inline-flex"
              title={showTest ? t('assistant.hideTestPanel') : t('assistant.showTestPanel')}
            >
              {showTest ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              {showTest ? t('assistant.hideTest') : t('assistant.test')}
            </button>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              {isActive ? t('assistant.active') : t('assistant.paused')}
            </label>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('assistant.close')}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div
          className={cn(
            // Debajo del breakpoint (móvil / zoom alto) las columnas se apilan:
            // el cuerpo debe poder scrollear o se recorta. En pantalla ancha
            // cada columna scrollea por dentro y el cuerpo queda fijo.
            'grid min-h-0 gap-0 overflow-y-auto sm:overflow-hidden',
            showTest
              // El panel de prueba suma ~520px de rieles fijos: solo a 3 columnas
              // desde lg (donde el diálogo ya es max-w-5xl y hay espacio).
              ? 'lg:grid-cols-[180px_minmax(0,1fr)_340px]'
              : 'sm:grid-cols-[180px_minmax(0,1fr)]',
          )}
        >
          {/* Section nav rail */}
          <nav className="border-r border-border bg-card/40 p-2 sm:py-4">
            {TABS.map((tabItem) => {
              const Icon = tabItem.icon;
              const active = tab === tabItem.key;
              return (
                <button
                  key={tabItem.key}
                  type="button"
                  onClick={() => setTab(tabItem.key)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                    active
                      ? 'bg-primary/10 text-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <Icon className="size-4" />
                  {tabItem.label}
                </button>
              );
            })}
          </nav>

          {/* Form column */}
          <div className="space-y-6 overflow-y-auto p-4 sm:p-6">
            {tab === 'business' && (
              <>
                {/* Producto PRIMERO: elegirlo dispara la investigación y
                    puebla identidad, persona y conocimiento. Es el paso 1 del
                    flujo product-first. */}
                <Field
                  label={
                    isNew
                      ? t('assistant.productFieldNew')
                      : t('assistant.productFieldEdit')
                  }
                >
                  {isNew ? (
                    applyingProduct ? (
                      <p className="flex items-center gap-2 text-[11px] text-primary">
                        <Loader2 className="size-3.5 animate-spin" />
                        {t('assistant.preparingWithProduct')}
                      </p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">
                        {t('assistant.productNewHint')}
                      </p>
                    )
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <ScopeCard
                        active={productScope === 'all'}
                        onClick={() => setProductScope('all')}
                        title={t('assistant.wholeCatalog')}
                        hint={t('assistant.wholeCatalogHint')}
                      />
                      <ScopeCard
                        active={productScope === 'specific'}
                        onClick={() => setProductScope('specific')}
                        title={t('assistant.someProducts')}
                        hint={t('assistant.someProductsHint')}
                      />
                    </div>
                  )}
                  {(isNew || productScope === 'specific') && (
                    <div className="mt-2 space-y-2">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={productSearch}
                          onChange={(e) => setProductSearch(e.target.value)}
                          placeholder={t('assistant.searchProduct')}
                          className="bg-background pl-8 text-sm"
                        />
                      </div>
                      <div className="max-h-[280px] overflow-y-auto rounded-lg border border-border bg-background">
                        {catalogLoading ? (
                          <div className="flex justify-center py-6">
                            <Loader2 className="size-4 animate-spin text-muted-foreground" />
                          </div>
                        ) : filteredCatalog.length === 0 ? (
                          <div className="space-y-3 px-3 py-6 text-center text-xs text-muted-foreground">
                            {catalog.length === 0 ? (
                              <>
                                <p>
                                  {t('assistant.noProductsYet')}
                                </p>
                                <Button
                                  type="button"
                                  onClick={goToCreateProduct}
                                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                                >
                                  <Package className="size-4" />
                                  {t('assistant.createNewProduct')}
                                </Button>
                              </>
                            ) : (
                              t('assistant.noResults')
                            )}
                          </div>
                        ) : (
                          <ul className="divide-y divide-border">
                            {filteredCatalog.map((p) => {
                              const on = selectedProducts.includes(p.id);
                              return (
                                <li
                                  key={p.id}
                                  className={cn(
                                    'flex items-center gap-3 px-3 py-2',
                                    on && 'bg-primary/10',
                                  )}
                                >
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
                                  {/* Botón explícito de asignación: la fila ya no
                                      togglea entera, así la selección es precisa. */}
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant={on ? 'default' : 'outline'}
                                    onClick={() => toggleProduct(p.id)}
                                    className={cn(
                                      'h-7 shrink-0 gap-1 px-2.5 text-xs',
                                      on
                                        ? 'bg-emerald-600 text-white hover:bg-emerald-600/90'
                                        : 'border-border bg-transparent text-foreground hover:bg-muted',
                                    )}
                                  >
                                    {on ? (
                                      <>
                                        <Check className="size-3.5" />
                                        {t('assistant.assigned')}
                                      </>
                                    ) : (
                                      t('assistant.assign')
                                    )}
                                  </Button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[11px] text-muted-foreground">
                          {selectedProducts.length === 1
                            ? t('assistant.productsAssignedOne', {
                                count: selectedProducts.length,
                              })
                            : t('assistant.productsAssignedOther', {
                                count: selectedProducts.length,
                              })}
                        </p>
                        <button
                          type="button"
                          onClick={goToCreateProduct}
                          className="text-[11px] text-accent-ink underline hover:opacity-80"
                        >
                          {t('assistant.notListedCreate')}
                        </button>
                      </div>
                    </div>
                  )}
                </Field>

                {/* Identidad: nombre + tono + idioma. El modelo lo
                    elegimos nosotros (Haiku) para no abrumar al usuario
                    con decisiones técnicas. */}
                <SectionCard
                  title={t('assistant.identityTitle')}
                >
                  <Field label={t('assistant.agentNameLabel')}>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t('assistant.agentNamePlaceholder')}
                      className="bg-background"
                    />
                  </Field>
                  <Field label={t('assistant.toneLabel')}>
                    <div className="grid gap-2 sm:grid-cols-4">
                      {TONES.map((toneOption) => (
                        <button
                          key={toneOption.value}
                          type="button"
                          onClick={() => setTone(toneOption.value)}
                          title={t(toneOption.hint)}
                          className={cn(
                            'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                            tone === toneOption.value
                              ? 'border-primary/60 bg-primary/10 text-foreground'
                              : 'border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                          )}
                        >
                          {t(toneOption.label)}
                        </button>
                      ))}
                    </div>
                  </Field>
                  <Field label={t('assistant.languageLabel')}>
                    <Select value={language} onValueChange={(v) => setLanguage(v ?? 'es')}>
                      <SelectTrigger className="w-full bg-background">
                        <SelectValue labels={LANGUAGE_LABELS} />
                      </SelectTrigger>
                      <SelectContent>
                        {LANGUAGES.map((l) => (
                          <SelectItem key={l.code} value={l.code}>
                            {t(l.label)}
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
                  title={t('assistant.personaTitle')}
                  hint={t('assistant.personaHint')}
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
                      {t('assistant.editAdvanced')}
                    </button>
                  }
                >
                  {showAdvancedPersona ? (
                    <Textarea
                      value={persona}
                      rows={10}
                      onChange={(e) => setPersona(e.target.value)}
                      placeholder={t('assistant.personaPlaceholder')}
                      className="resize-y bg-background font-mono text-xs leading-relaxed"
                    />
                  ) : (
                    <p className="line-clamp-3 rounded-md border border-border bg-background/60 p-3 text-xs leading-relaxed text-muted-foreground">
                      {persona.trim() || t('assistant.personaEmpty')}
                    </p>
                  )}
                </SectionCard>

                <SectionCard
                  title={t('assistant.businessInfoTitle')}
                  hint={t('assistant.businessInfoHint')}
                >
                  <Textarea
                    value={knowledge}
                    onChange={(e) => setKnowledge(e.target.value)}
                    rows={5}
                    placeholder={t('assistant.businessInfoPlaceholder')}
                    className="resize-y bg-background font-mono text-xs leading-relaxed"
                  />
                </SectionCard>

              </>
            )}

            {tab === 'reach' && (
              <>
                <Field label={t('assistant.channelsFieldLabel')}>
              <div className="grid grid-cols-2 gap-2">
                <ScopeCard
                  active={scope === 'workspace'}
                  onClick={() => setScope('workspace')}
                  title={t('assistant.allChannels')}
                  hint={t('assistant.allChannelsHint')}
                />
                <ScopeCard
                  active={scope === 'channels'}
                  onClick={() => setScope('channels')}
                  title={t('assistant.someChannels')}
                  hint={t('assistant.someChannelsHint')}
                />
              </div>
              {scope === 'channels' && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(voice.voice_enabled ? [...CHANNELS, VOICE_CHANNEL] : CHANNELS).map((c) => {
                    const on = channels.includes(c.value);
                    return (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => toggleChannel(c.value)}
                        className={cn(
                          'flex items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors',
                          on
                            ? 'border-primary/60 bg-primary/10 text-foreground'
                            : 'border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                        )}
                      >
                        {c.icon ? (
                          <Image
                            src={c.icon}
                            alt=""
                            width={16}
                            height={16}
                            className="shrink-0"
                          />
                        ) : (
                          <PhoneCall className="h-4 w-4 shrink-0" />
                        )}
                        {c.icon ? c.label : t(c.label)}
                      </button>
                    );
                  })}
                </div>
              )}
                </Field>

                {/* Rules toggles + escalation chips share the Alcance tab. */}
                <Field label={t('assistant.responseRulesLabel')}>
                  <ToggleRow
                    checked={replyWhenAssigned}
                    onChange={setReplyWhenAssigned}
                    title={t('assistant.replyWhenAssignedTitle')}
                    hint={t('assistant.replyWhenAssignedHint')}
                  />
                </Field>

                {/* Horario de atención — único control (antes estaba
                    partido entre este toggle y un bloque en "Avanzado").
                    Activarlo restringe las respuestas a la ventana. */}
                <SectionCard
                  title={t('assistant.businessHoursTitle')}
                  hint={t('assistant.businessHoursHint')}
                  right={
                    <Switch checked={hoursEnabled} onCheckedChange={setHoursEnabled} />
                  }
                >
                  {hoursEnabled && (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label={t('assistant.startLabel')}>
                          <Input
                            type="time"
                            value={hoursStart}
                            onChange={(e) => setHoursStart(e.target.value)}
                            className="bg-background"
                          />
                        </Field>
                        <Field label={t('assistant.endLabel')}>
                          <Input
                            type="time"
                            value={hoursEnd}
                            onChange={(e) => setHoursEnd(e.target.value)}
                            className="bg-background"
                          />
                        </Field>
                      </div>
                      {/* Fin <= inicio = turno noche. Se explica aquí para que
                          no parezca un dato mal cargado. */}
                      {hoursStart >= hoursEnd && (
                        <p className="text-[11px] text-muted-foreground">
                          {t('assistant.hoursOvernight')}
                        </p>
                      )}
                      <Field label={t('assistant.timezoneLabel')}>
                        <Select
                          value={hoursTimezone}
                          onValueChange={(v) => setHoursTimezone(v ?? 'America/Bogota')}
                        >
                          <SelectTrigger className="w-full bg-background">
                            <SelectValue labels={TIMEZONE_LABELS} />
                          </SelectTrigger>
                          <SelectContent>
                            {TIMEZONES.map((tz) => (
                              <SelectItem key={tz.value} value={tz.value}>
                                {t(tz.label)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label={t('assistant.daysLabel')}>
                        <div className="grid grid-cols-7 gap-1.5">
                          {WEEK_DAYS.map((d) => {
                            const on = hoursDays.includes(d.value);
                            return (
                              <button
                                key={d.value}
                                type="button"
                                onClick={() => toggleHoursDay(d.value)}
                                title={t(d.long)}
                                className={cn(
                                  'rounded-lg border px-1 py-1.5 text-xs transition-colors',
                                  on
                                    ? 'border-primary/60 bg-primary/10 text-foreground'
                                    : 'border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                                )}
                              >
                                {t(d.short)}
                              </button>
                            );
                          })}
                        </div>
                      </Field>
                    </>
                  )}
                </SectionCard>

                <Field label={t('assistant.escalateKeywordsLabel')}>
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
                      placeholder={t('assistant.escalateKeywordsPlaceholder')}
                      className="min-w-[140px] flex-1 bg-transparent px-1 text-xs text-foreground focus:outline-none"
                    />
                  </div>
                </Field>
              </>
            )}

            {tab === 'voice' && (
              // El encabezado de la tarjeta ES el interruptor: antes decía
              // "Voz · Permite que este agente haga y conteste llamadas" y
              // justo debajo repetía "Agente de voz" con el switch, dos veces
              // lo mismo. Ahora es una sola fila: qué es, qué hace y el
              // interruptor.
              <SectionCard
                title={t('voice.enable')}
                hint={t('voice.enableHint')}
                right={
                  <Switch
                    checked={voice.voice_enabled}
                    onCheckedChange={(c) => setVoice({ ...voice, voice_enabled: c })}
                  />
                }
              >
                <VoiceSettings
                  value={voice}
                  onChange={setVoice}
                  language={language}
                  workspaceId={workspaceId}
                />
              </SectionCard>
            )}

            {tab === 'advanced' && (
              <>
                <SectionCard
                  title={t('assistant.responseBehaviorTitle')}
                  hint={t('assistant.responseBehaviorHint')}
                >
                  <Field label={t('assistant.responseModeLabel')}>
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
                              <span className="text-sm text-foreground">{t(m.label)}</span>
                              <span className="text-[11px] text-muted-foreground">
                                {t(m.hint)}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field label={t('assistant.debounceLabel')}>
                    {/* El runner aplica un piso de 8s (agrupa ráfagas del
                        cliente), así que aceptar 0 aquí era mentir: se
                        esperaba igual. El mínimo de la UI = el real. */}
                    <Input
                      type="number"
                      min={MIN_DEBOUNCE_SECONDS}
                      max={60}
                      value={inboundDebounce}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        setInboundDebounce(
                          Number.isFinite(n)
                            ? Math.max(MIN_DEBOUNCE_SECONDS, Math.min(60, n))
                            : MIN_DEBOUNCE_SECONDS,
                        );
                      }}
                      className="bg-background"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {t('assistant.debounceHelp')}
                    </p>
                  </Field>
                </SectionCard>

                <SectionCard
                  title={t('assistant.escalationTitle')}
                  hint={t('assistant.escalationHint')}
                >
                  <Field label={t('assistant.escalateAfterLabel')}>
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
                      {t('assistant.escalateAfterHelp')}
                    </p>
                  </Field>
                </SectionCard>

                <SectionCard
                  title={t('assistant.followupTitle')}
                  hint={t('assistant.followupHint')}
                  right={
                    <Switch
                      checked={followupEnabled}
                      onCheckedChange={setFollowupEnabled}
                    />
                  }
                >
                  {followupEnabled && (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label={t('assistant.followupDelayLabel')}>
                          <Input
                            type="number"
                            min={1}
                            max={23}
                            value={followupDelayHours}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              // Tope 23 h: el follow-up es texto libre y Meta
                              // solo lo permite dentro de la ventana de 24 h
                              // desde el último mensaje del cliente.
                              setFollowupDelayHours(
                                Number.isFinite(n) ? Math.max(1, Math.min(23, n)) : 23,
                              );
                            }}
                            className="bg-background"
                          />
                          <p className="text-[11px] text-muted-foreground">
                            {t('assistant.followupDelayHelp')}
                          </p>
                        </Field>
                        <Field label={t('assistant.followupMaxLabel')}>
                          <Input
                            type="number"
                            min={1}
                            max={5}
                            value={followupMaxCount}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              setFollowupMaxCount(
                                Number.isFinite(n) ? Math.max(1, Math.min(5, n)) : 1,
                              );
                            }}
                            className="bg-background"
                          />
                          <p className="text-[11px] text-muted-foreground">
                            {t('assistant.followupMaxHelp')}
                          </p>
                        </Field>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {t('assistant.followupFootnote')}
                      </p>
                    </>
                  )}
                </SectionCard>

                <SectionCard
                  title={t('assistant.salesCloseTitle')}
                  hint={t('assistant.salesCloseHint')}
                  right={
                    <Switch
                      checked={puedeCrearPedidos}
                      // Solo se puede ACTIVAR con Shopify conectado. Si ya
                      // está activo, se puede desactivar siempre.
                      disabled={!shopifyConnected && !puedeCrearPedidos}
                      onCheckedChange={(v) => {
                        if (v && !shopifyConnected) {
                          toast.error(t('assistant.connectShopifyFirst'));
                          return;
                        }
                        setPuedeCrearPedidos(v);
                      }}
                    />
                  }
                >
                  {shopifyConnected === false && !puedeCrearPedidos ? (
                    <div className="space-y-2">
                      <p className="text-[11px] text-muted-foreground">
                        {t('assistant.salesCloseConnectPrompt')}
                      </p>
                      {showLinkInput ? (
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Input
                            value={linkShop}
                            onChange={(e) => setLinkShop(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && linkShopify()}
                            placeholder={t('assistant.shopDomainPlaceholder')}
                            className="bg-background"
                            disabled={linking}
                          />
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              size="sm"
                              onClick={linkShopify}
                              disabled={linking}
                            >
                              {linking ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                t('assistant.connect')
                              )}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setShowLinkInput(false)}
                              disabled={linking}
                              className="border-border"
                            >
                              {t('assistant.cancel')}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => setShowLinkInput(true)}
                        >
                          <Image
                            src="/channels/shopify.svg"
                            alt=""
                            width={16}
                            height={16}
                          />
                          {t('assistant.linkShopify')}
                        </Button>
                      )}
                      {linking && (
                        <p className="text-[11px] text-muted-foreground">
                          {t('assistant.linkingHint')}
                        </p>
                      )}
                    </div>
                  ) : (
                    puedeCrearPedidos && (
                      <p className="text-[11px] text-muted-foreground">
                        {t('assistant.salesCloseActiveHint')}
                      </p>
                    )
                  )}
                </SectionCard>
              </>
            )}
          </div>

          {/* Test column — conversación multi-turno tipo WhatsApp.
              El usuario tipea como cliente; el bot del editor responde
              y se ve igual que en producción (left bubbles blancas para
              asistente, right verdes para usuario, fondo beige con dots).
              Se puede ocultar con el botón "Ocultar prueba" del header. */}
          {showTest && (
          <aside className="flex min-h-0 flex-col overflow-hidden border-t border-border bg-muted/30 sm:border-l sm:border-t-0">
            <div className="flex items-center justify-between gap-2 border-b border-border bg-card px-4 py-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground">
                  {t('assistant.testPanelTitle')}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t('assistant.testPanelSubtitle')}
                </p>
              </div>
              {testHistory.length > 0 && (
                <button
                  type="button"
                  onClick={resetTestConversation}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title={t('assistant.resetConversation')}
                >
                  <RotateCcw className="size-3" />
                  {t('assistant.reset')}
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
                    {t('assistant.testEmptyPrompt')}
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
                  {/* Sender label so it's unmistakable who is who: the
                      tester ("Tú", green) vs the assistant (its name, blue). */}
                  <span
                    className={cn(
                      'px-1 text-[10px] font-semibold',
                      turn.role === 'user' ? 'text-[#1d7a45]' : 'text-[#0a6ebd]',
                    )}
                  >
                    {turn.role === 'user' ? t('assistant.you') : name.trim() || t('assistant.assistant')}
                  </span>
                  {turn.chunks.length === 0 ? (
                    <div
                      className={cn(
                        'relative max-w-[85%] rounded-lg px-2 py-1.5 text-[13px] leading-snug shadow-sm',
                        turn.role === 'user'
                          ? 'rounded-br-none bg-[#dcf8c6] text-[#111b21]'
                          : 'rounded-bl-none border border-border bg-white text-[#111b21]',
                      )}
                    >
                      <span className="italic text-[#6b7280]">{t('assistant.noReply')}</span>
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
                  {t('assistant.saveBeforeTestHint')}
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
                  placeholder={t('assistant.testInputPlaceholder')}
                  className="min-h-[44px] resize-none rounded-2xl border border-[#dcdcdc] bg-white text-sm text-[#111b21]"
                  disabled={testing || !editing}
                />
                <Button
                  onClick={runTest}
                  disabled={testing || !editing || !testMessage.trim()}
                  className="size-10 shrink-0 rounded-full bg-[#25d366] p-0 text-white hover:bg-[#1ebe5a]"
                  aria-label={t('assistant.send')}
                >
                  <Send className="size-4" />
                </Button>
              </div>
            </div>
          </aside>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-card/60 px-4 py-4 sm:px-6">
          <Button
            variant="outline"
            onClick={onClose}
            className="border-border text-foreground hover:bg-accent"
          >
            {t('assistant.cancel')}
          </Button>
          <Button
            onClick={save}
            disabled={saving}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t('assistant.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Subconjunto del producto que usamos para armar la plantilla del agente. */
interface ProductDetail {
  id: string;
  title: string;
  ai_research_status?: string | null;
  description?: string | null;
  structured_research?: Record<string, unknown> | null;
}

/**
 * Resumen corto del producto para precargar "Información del negocio" al
 * elegirlo en el editor del agente. Prioriza la investigación estructurada
 * (cliente ideal + beneficios); si no hay, cae a la descripción recortada.
 * Se mantiene breve a propósito: el runner ya inyecta el producto completo
 * en cada conversación, esto es solo para que el merchant lo vea pre-armado.
 */
function buildBusinessInfoFromProduct(p: ProductDetail, t: TFn): string {
  const arr = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.map((x) => String(x).trim()).filter(Boolean)
      : [];
  const sr =
    p.structured_research && typeof p.structured_research === 'object'
      ? (p.structured_research as Record<string, unknown>)
      : null;
  const lines: string[] = [];
  if (sr) {
    const audience = typeof sr.audience === 'string' ? sr.audience.trim() : '';
    if (audience) lines.push(t('assistant.idealCustomer', { value: audience }));
    const benefits = arr(sr.benefits ?? sr.desires).slice(0, 4);
    if (benefits.length) {
      lines.push(t('assistant.keyBenefits', { value: benefits.join('; ') }));
    }
  }
  if (lines.length === 0 && p.description) {
    const d = p.description.replace(/\s+/g, ' ').trim().slice(0, 400);
    if (d) lines.push(d);
  }
  return lines.join('\n');
}

/**
 * System prompt (persona) armado a partir del producto. Base = asesor de
 * ventas del producto; si el producto ya tiene investigación, inyecta el
 * cliente ideal, los beneficios y las objeciones para que el prompt salga
 * afinado desde el primer momento. Sigue el idioma del merchant (locale): un
 * merchant de habla inglesa obtiene la persona en inglés. Los valores de
 * investigación (audience/benefits/objections) ya se generan en ese idioma.
 */
function buildPersonaFromProduct(p: ProductDetail, locale: string): string {
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
  const sr =
    p.structured_research && typeof p.structured_research === 'object'
      ? (p.structured_research as Record<string, unknown>)
      : null;
  const en = locale === 'en';
  const lines: string[] = [
    en
      ? `You are an expert sales advisor for ${p.title}. You help customers warmly over ` +
        `WhatsApp: answer questions with the product info, handle objections honestly, and ` +
        `guide them to purchase (or repurchase) without pushing. One question per turn, ` +
        `short messages. Never admit to being an AI.`
      : `Eres un asesor de ventas experto en ${p.title}. Atiendes por WhatsApp ` +
        `con calidez: resuelves dudas con la información del producto, manejas ` +
        `objeciones con honestidad y guías a la compra (o recompra) sin presionar. ` +
        `Una pregunta por turno, mensajes cortos. Nunca admites ser una IA.`,
  ];
  if (sr) {
    const audience = typeof sr.audience === 'string' ? sr.audience.trim() : '';
    if (audience) {
      lines.push(en ? `Your typical customer: ${audience}.` : `Tu cliente típico: ${audience}.`);
    }
    const benefits = arr(sr.benefits ?? sr.desires).slice(0, 4);
    if (benefits.length) {
      lines.push(
        en
          ? `Lean on these benefits to convince: ${benefits.join('; ')}.`
          : `Apóyate en estos beneficios para convencer: ${benefits.join('; ')}.`,
      );
    }
    const objections = arr(sr.objections).slice(0, 4);
    if (objections.length) {
      lines.push(
        en
          ? `Handle these common objections tactfully: ${objections.join('; ')}.`
          : `Maneja con tacto estas objeciones comunes: ${objections.join('; ')}.`,
      );
    }
  }
  return lines.join(' ');
}

async function fetchProductDetail(id: string): Promise<ProductDetail | null> {
  try {
    const res = await fetch(`/api/products/${id}`);
    if (!res.ok) return null;
    const json = await res.json();
    return (json.product ?? null) as ProductDetail | null;
  } catch {
    return null;
  }
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
