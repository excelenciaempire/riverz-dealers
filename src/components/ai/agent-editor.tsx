'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalizedRouter } from '@/hooks/use-localized-router';
import Image from 'next/image';
import Link from '@/components/i18n/locale-link';
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
  Plus,
  Briefcase,
  Radio,
  SlidersHorizontal,
  Settings as SettingsIcon,
  ChevronDown,
  ChevronRight,
  Check,
  CheckCheck,
  RotateCcw,
} from 'lucide-react';
import { AgentStats } from '@/components/ai/agent-stats';
import { MODELO_POR_DEFECTO } from '@/lib/ai/esfuerzo';
import { ReglasPanel } from '@/components/ai/reglas-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  MEDIOS_PAGO,
  mediosDeclarados,
  type MedioDePago,
} from '@/lib/ai/medios-pago';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT, useLocale } from '@/hooks/use-locale';
import { ToolSwitchboard, type Disponibilidad } from './tool-switchboard';
import {
  REGLAS_POR_DEFECTO,
  type ReglasDeCobro,
} from '@/lib/payments/reglas-de-cobro';
import { limpiarPersona } from '@/lib/ai/persona-limpia';
import type { AgentTools } from '@/lib/ai/toolbox';
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
import { idsDelGrupo } from '@/lib/products/agrupar';
import {
  AGENT_ROLES,
  type AgentPermissions,
  type AgentRole,
} from '@/lib/ai/roles';
import { roleTemplate } from '@/lib/ai/role-templates';
import type { AgentSummary } from '@/app/(dashboard)/asistente/page';
import type { Channel } from '@/types';
import { AvisoEscalada } from '@/components/ai/aviso-escalada';

/** "shopify" → "Shopify". Los nombres propios se escriben como se escriben.
 *  Mismo mapa que la pantalla de Productos: un canal nombrado distinto en cada
 *  pantalla deja de parecer el mismo producto. */
const CANAL: Record<string, string> = {
  shopify: 'Shopify',
  mercadolibre: 'Mercado Libre',
  tiendanube: 'Tiendanube',
  woocommerce: 'WooCommerce',
};

// label/hint son claves i18n resueltas con t() en el render.
const TONES: { value: AiTone; label: string; hint: string }[] = [
  {
    value: 'friendly',
    label: 'assistant.toneFriendly',
    hint: 'assistant.toneFriendlyHint',
  },
  {
    value: 'formal',
    label: 'assistant.toneFormal',
    hint: 'assistant.toneFormalHint',
  },
  {
    value: 'casual',
    label: 'assistant.toneCasual',
    hint: 'assistant.toneCasualHint',
  },
  {
    value: 'concise',
    label: 'assistant.toneConcise',
    hint: 'assistant.toneConciseHint',
  },
];

// Modelo fijo: la decisión no aporta valor al comercio, la tomamos por él. Lo
// que cambió es cuál. Estuvo en Haiku 4.5 por costo hasta que se midió lo que
// escribía: con una lista larga de reglas se le escapan las últimas, y las
// últimas son las que le prohíben afirmar lo que no le consta.
const DEFAULT_MODEL = MODELO_POR_DEFECTO;

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
  {
    value: 'outlook',
    label: 'Outlook',
    icon: '/channels/microsoftoutlook.svg',
  },
  {
    value: 'mercadolibre',
    label: 'Mercado Libre',
    icon: '/channels/mercadolibre.svg',
  },
  { value: 'webchat', label: 'nav.webchat', icon: '/channels/webchat.svg' },
];

// label es una clave i18n resuelta con t() en el render.
const LANGUAGES: { code: string; label: string }[] = [
  { code: 'es', label: 'assistant.languageSpanish' },
  { code: 'en', label: 'assistant.languageEnglish' },
  { code: 'pt', label: 'assistant.languagePortuguese' },
  { code: 'fr', label: 'assistant.languageFrench' },
];

// label/hint son claves i18n resueltas con t() en el render.
/** Sufijo de la clave i18n de cada rol y permiso, para no repetir el mapa. */
const ROLE_KEY: Record<AgentRole, string> = {
  general: 'General',
  ventas: 'Sales',
  postventa: 'Aftersale',
  recuperacion: 'Recovery',
  retencion: 'Retention',
};

/**
 * Cuanta correa tiene el asistente.
 *
 * `auto` es lo de siempre: contesta y manda. `approval` escribe la respuesta
 * igual —con el mismo contexto y las mismas herramientas— pero la deja en la
 * bandeja para que una persona la envie con un clic. Es el punto medio entre
 * tener el asistente apagado y confiarle el chat entero.
 */
const AUTONOMY_MODES: {
  value: 'auto' | 'approval';
  label: string;
  hint: string;
}[] = [
  {
    value: 'auto',
    label: 'assistant.autonomyAuto',
    hint: 'assistant.autonomyAutoHint',
  },
  {
    value: 'approval',
    label: 'assistant.autonomyApproval',
    hint: 'assistant.autonomyApprovalHint',
  },
];

const RESPONSE_MODES: { value: AiResponseMode; label: string; hint: string }[] =
  [
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
const WEEK_DAYS: {
  value: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  short: string;
  long: string;
}[] = [
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
  days: number[]
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
  /**
   * Pestaña con la que abre cuando se llega desde una acción contextual.
   */
  initialTab?: 'business' | 'tools' | 'reach' | 'advanced' | 'stats';
}

export function AgentEditor({
  workspaceId,
  agent,
  onClose,
  onSaved,
  initialTab,
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
    agent?.id ?? null
  );
  const editing = Boolean(currentAgentId);
  // `isNew` = el editor se abrió en modo "crear" (sin agente previo). Se
  // mantiene aunque la generación con IA persista el row a medio camino
  // —por eso NO usamos currentAgentId—, para seguir exigiendo producto.
  const isNew = !agent;

  const [name, setName] = useState(agent?.name ?? '');
  const [isActive, setIsActive] = useState(agent?.is_active ?? false);
  // Limpia de entrada. Un agente viejo trae "[object Object]" guardado en su
  // persona; el runner ya lo saca del prompt, pero el comercio lo LEIA en el
  // cuadro y no tenia forma de saber que era basura nuestra. Entrando limpia,
  // su proximo guardado la deja limpia tambien en la base.
  const [persona, setPersona] = useState(
    agent?.persona ? limpiarPersona(agent.persona) : defaultPersona(locale)
  );
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
    agent?.reply_when_assigned ?? false
  );
  const [escalateKeywords, setEscalateKeywords] = useState<string[]>(
    // Sólo lo que ES un pedido de hablar con una persona. "Reembolso" estaba en
    // esta lista y no es eso: es una consulta que el agente sabe atender, y
    // tenerla acá apagaba la IA de esa conversación —para siempre— con que el
    // cliente escribiera la palabra.
    agent?.escalate_keywords ?? ['humano', 'persona', 'agente']
  );
  const [escalateInput, setEscalateInput] = useState('');
  const [responseMode, setResponseMode] = useState<AiResponseMode>(
    agent?.response_mode ?? 'dynamic'
  );
  // Autonomia: responde solo o deja la respuesta para aprobar (migracion 170).
  const [requiresApproval, setRequiresApproval] = useState<boolean>(
    agent?.requires_approval ?? false
  );
  const [inboundDebounce, setInboundDebounce] = useState<number>(
    agent?.inbound_debounce_seconds ?? 15
  );
  const [burstMax, setBurstMax] = useState<number>(
    agent?.reply_burst_max ?? 20
  );
  const [escalateAfterMessages, setEscalateAfterMessages] = useState<number>(
    agent?.escalate_after_messages ?? 0
  );
  // Seguimiento inteligente: si el cliente no responde, el asistente
  // manda un mensaje contextual de seguimiento. Migration 079.
  const [followupEnabled, setFollowupEnabled] = useState<boolean>(
    agent?.followup_enabled ?? false
  );
  // Tope 23 h por cumplimiento Meta (ventana de 24 h). Agentes viejos con 24
  // se muestran como 23 y se corrigen al guardar.
  const [followupDelayHours, setFollowupDelayHours] = useState<number>(
    Math.min(23, agent?.followup_delay_hours ?? 23)
  );
  const [followupMaxCount, setFollowupMaxCount] = useState<number>(
    agent?.followup_max_count ?? 1
  );
  // Cierre de ventas: si está ON, el asistente arma y crea el pedido real
  // en Shopify. Migration 080. Requiere Shopify conectado con permiso de
  // pedidos (write_orders).
  const [puedeCrearPedidos, setPuedeCrearPedidos] = useState<boolean>(
    agent?.puede_crear_pedidos ?? false
  );
  // Cómo cierra la venta (migración 219). Elige entre lo que la pizarra ya
  // permite: con una sola de las dos herramientas prendida no hay nada que
  // elegir y el control no se muestra.
  const [cobroModo, setCobroModo] = useState<
    'checkout' | 'chat' | 'segun_pago'
  >(agent?.cobro_modo ?? 'segun_pago');
  // `null` no es la lista vacía: es "todavía no lo declaró". Con null el
  // agente no nombra ningún medio y no confirma contra entrega — pasa a una
  // persona. Es donde arranca todo asistente nuevo, y es el lado seguro.
  const [medios, setMedios] = useState<MedioDePago[] | null>(
    mediosDeclarados(agent?.medios_pago)
  );
  // Rol y permisos por acción (migración 164). `permissions` en null significa
  // "usá las columnas viejas": los agentes anteriores siguen igual hasta que
  // alguien toque uno de estos interruptores.
  const [role, setRole] = useState<AgentRole>(agent?.role ?? 'general');
  const [permissions, setPermissions] = useState<AgentPermissions | null>(
    agent?.permissions ?? null
  );
  // La correa por herramienta (migración 180). En null cada una hereda del
  // permiso viejo: aplicar esto no le cambió el agente a nadie.
  const [tools, setTools] = useState<AgentTools | null>(
    (agent?.tools as AgentTools | null) ?? null
  );
  // Qué de todo eso tiene HOY con qué hacerse en esta cuenta. La pizarra deja
  // prender todo igual —apagar algo de antemano o dejarlo listo para cuando se
  // conecte la tienda son las dos cosas razonables—, pero un interruptor
  // prendido que no hace nada y no dice por qué es peor que uno apagado.
  const [disponible, setDisponible] = useState<Disponibilidad>({
    tienda: false,
    shopify: false,
    cobro: false,
    descuento: false,
    voz: false,
  });
  /** Cuánto puede descontar el agente. Vive en la cuenta, no en el agente. */
  const [topeDescuento, setTopeDescuento] = useState(0);
  /** Con qué pruebas da un pedido por cobrado. También de la cuenta. */
  const [reglasCobro, setReglasCobro] =
    useState<ReglasDeCobro>(REGLAS_POR_DEFECTO);

  /**
   * Cambiar de rol trae su preset de permisos.
   *
   * Elegir "Postventa" y que el agente siga pudiendo crear pedidos sería el rol
   * como etiqueta y no como decisión. Quien quiera otra cosa mueve los
   * interruptores después: el preset es un punto de partida, no un candado.
   */
  const aplicarRol = (r: AgentRole) => {
    setRole(r);
    const preset = roleTemplate(r);
    if (preset) {
      setPermissions(preset.permissions);
      setPuedeCrearPedidos(preset.permissions.crear_pedidos === true);
      // La pizarra vuelve a heredar del preset. Dejarla como estaba haría que
      // elegir "Postventa" moviera los permisos por debajo y la pantalla
      // siguiera mostrando lo de antes.
      setTools(null);
    }
  };
  // Estado de la conexión Shopify para gatear "Cierre de ventas". null =
  // cargando. El cierre solo se puede activar con Shopify conectado; si no,
  // mostramos un botón "Vincular" que abre un popup sin salir del editor.
  const [shopifyConnected, setShopifyConnected] = useState<boolean | null>(
    null
  );
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
  const [hoursTimezone, setHoursTimezone] = useState<string>(
    initialBh.timezone
  );
  const [hoursDays, setHoursDays] = useState<number[]>(initialBh.days);
  // Modelo fijo, sin selector. El runner lee agent.model del registro;
  // mandamos siempre DEFAULT_MODEL en el payload de guardado.
  const [scope, setScope] = useState<AiScope>(agent?.scope ?? 'workspace');
  const [channels, setChannels] = useState<Channel[]>(
    (agent?.ai_agent_channels ?? []).map((c) => c.channel as Channel)
  );
  // Un asistente nuevo SIEMPRE arranca en "specific": se entrena a partir
  // del producto que elijas, así que la selección es obligatoria. Los
  // existentes conservan su scope guardado (incl. "all", por compatibilidad).
  const [productScope, setProductScope] = useState<AiProductScope>(
    agent ? (agent.product_scope ?? 'all') : 'specific'
  );
  const [selectedProducts, setSelectedProducts] = useState<string[]>(
    (agent?.ai_agent_products ?? []).map((p) => p.product_id)
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
  type TestTurn = {
    role: 'user' | 'assistant';
    chunks: string[];
    stamp: string;
    /** Qué herramientas usó para contestar. Es la mitad de lo que se quiere
     *  ver al probar: no sólo qué dijo, sino si fue a buscar el dato. */
    herramientas?: string[];
  };
  const [testHistory, setTestHistory] = useState<TestTurn[]>([]);
  const [testing, setTesting] = useState(false);
  const testScrollRef = useRef<HTMLDivElement>(null);

  const [showAdvancedPersona, setShowAdvancedPersona] = useState(false);
  // El panel "Probar" arranca cerrado para que el form tenga el ancho
  // completo; el botón del header lo abre on-demand.
  const [showTest, setShowTest] = useState(false);

  const [voiceAgentId, setVoiceAgentId] = useState(agent?.voice_agent_id ?? '');
  const [voiceCanPropose, setVoiceCanPropose] = useState(
    agent?.voice_ai_decides ?? false
  );

  type TabKey = 'business' | 'tools' | 'reach' | 'advanced' | 'stats';
  // `stats` sólo existe con el agente ya creado: entrar por un enlace viejo a
  // una pestaña que no está dibujada dejaba el modal en blanco.
  const [tab, setTab] = useState<TabKey>(
    initialTab && (initialTab !== 'stats' || agent?.id)
      ? initialTab
      : 'business'
  );
  const TABS: { key: TabKey; label: string; icon: typeof Briefcase }[] = [
    { key: 'business', label: t('assistant.tabBusiness'), icon: Briefcase },
    { key: 'tools', label: t('operation.toolsTitle'), icon: SlidersHorizontal },
    { key: 'reach', label: t('assistant.tabReach'), icon: Radio },
    { key: 'advanced', label: t('assistant.tabAdvanced'), icon: SettingsIcon },
    // Estadísticas no está en el rail: se entra por el botón de la tarjeta del
    // agente. El panel sigue existiendo (tab === 'stats').
  ];

  // Mapas valor→etiqueta para <SelectValue labels={...}>, resueltos con t()
  // porque las etiquetas base ahora son claves i18n.
  const LANGUAGE_LABELS = Object.fromEntries(
    LANGUAGES.map((l) => [l.code, t(l.label)])
  );
  const RESPONSE_MODE_LABELS = Object.fromEntries(
    RESPONSE_MODES.map((m) => [m.value, t(m.label)])
  );
  const AUTONOMY_LABELS = Object.fromEntries(
    AUTONOMY_MODES.map((m) => [m.value, t(m.label)])
  );
  const TIMEZONE_LABELS = Object.fromEntries(
    TIMEZONES.map((tz) => [tz.value, t(tz.label)])
  );
  /** El texto de cada modo de cobro, para que el selector no muestre el nombre
   *  interno de la columna. */
  const COBRO_LABELS = {
    segun_pago: t('operation.cobroSegunPago'),
    chat: t('operation.cobroChat'),
    checkout: t('operation.cobroCheckout'),
  };
  const ROLE_LABELS = Object.fromEntries(
    AGENT_ROLES.map((r) => [r, t(`operation.role${ROLE_KEY[r]}Name`)])
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
    setChannels((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  }

  function toggleHoursDay(d: number) {
    setHoursDays((prev) =>
      prev.includes(d)
        ? prev.filter((x) => x !== d)
        : [...prev, d].sort((a, b) => a - b)
    );
  }

  /**
   * Asignar un producto es asignarlo entero.
   *
   * Un producto vendido en varios lados tiene una fila por plataforma. Guardar
   * sólo la principal dejaba al agente autorizado a hablar de la de Shopify y
   * no de la de Mercado Libre: el mismo producto, partido según por dónde le
   * escribieran — justo lo que unificar vino a arreglar. Se guardan todas.
   */
  function toggleProduct(p: ShopifyProductSummary) {
    const ids = idsDelGrupo(p);
    setSelectedProducts((prev) => {
      if (ids.some((id) => prev.includes(id)))
        return prev.filter((x) => !ids.includes(x));
      const next = Array.from(new Set([...prev, ...ids]));
      // Primer producto de un asistente nuevo → preparar la plantilla y
      // disparar la investigación del producto (lo que antes era manual). Se
      // usa la principal: es la que tiene el conocimiento.
      if (prev.length === 0) void prefillFromProduct(p.id);
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
    setName(
      (cur) =>
        cur.trim() ||
        t('assistant.defaultAgentName', { title: p.title }).slice(0, 60)
    );
    // System prompt: lo arma el código a partir del producto (título +
    // cliente ideal + beneficios + objeciones si hay investigación). Solo
    // pisa el persona por defecto / vacío, nunca lo que el usuario escribió.
    setPersona((cur) =>
      isDefaultPersona(cur) ? buildPersonaFromProduct(p, locale) : cur
    );
    // "Información del negocio": SIEMPRE queda rellena al elegir el producto
    // (si está vacía) — con el resumen del producto cuando hay investigación,
    // o un andamiaje base (envíos/políticas/pagos) que el merchant edita. Así
    // las dos cajas quedan pre-armadas, nunca una llena y la otra en blanco.
    setKnowledge((cur) =>
      cur.trim()
        ? cur
        : buildBusinessInfoFromProduct(p, t) ||
          t('assistant.businessInfoPlaceholder')
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

  // Con qué cuenta HOY esta cuenta, para que la pizarra pueda decir por qué una
  // herramienta prendida todavía no va a hacer nada.
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/ai/agents/disponibilidad?workspace_id=${encodeURIComponent(workspaceId)}`
        );
        if (!res.ok) return;
        const json = (await res.json()) as Disponibilidad;
        if (!cancelled) setDisponible(json);
      } catch {
        // Si no se pudo saber, la pizarra sigue funcionando: lo único que se
        // pierde es la línea que explica qué falta conectar.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  // El tope de descuento. Es de la CUENTA y no del agente —el mismo margen
  // gobierna todos los canales— así que se guarda apenas se toca, sin esperar
  // al Guardar del agente: mezclarlo con el resto haría que "cancelar" en el
  // editor revirtiera algo que no es del agente.
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/ai/tope-descuento?workspace_id=${encodeURIComponent(workspaceId)}`
        );
        if (!res.ok) return;
        const json = (await res.json()) as { tope?: number };
        if (!cancelled) setTopeDescuento(Number(json.tope ?? 0));
      } catch {
        /* sin esto el campo arranca en 0, que es el valor real por defecto */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const guardarTope = useCallback(
    (n: number) => {
      setTopeDescuento(n);
      if (!workspaceId) return;
      void (async () => {
        try {
          const res = await fetchWithCsrf('/api/ai/tope-descuento', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspace_id: workspaceId, tope: n }),
          });
          if (!res.ok) throw new Error();
          // Cambiar el tope cambia si la herramienta se le ofrece o no al
          // agente, así que la disponibilidad se vuelve a mirar.
          setDisponible((d) => ({ ...d, descuento: n > 0 }));
        } catch {
          toast.error(t('assistant.updateError'));
        }
      })();
    },
    [workspaceId, fetchWithCsrf, t]
  );

  // Con qué pruebas se da un pedido por cobrado. También de la CUENTA, y por
  // el mismo motivo que el tope: es la política de cobro del negocio, no la
  // personalidad de un agente.
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/ai/cobro-comprobante?workspace_id=${encodeURIComponent(workspaceId)}`
        );
        if (!res.ok) return;
        const json = (await res.json()) as { reglas?: ReglasDeCobro };
        if (!cancelled && json.reglas) setReglasCobro(json.reglas);
      } catch {
        /* quedan las de siempre, que es lo que hace el servidor igual */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const guardarReglasCobro = useCallback(
    (r: ReglasDeCobro) => {
      setReglasCobro(r);
      if (!workspaceId) return;
      void (async () => {
        try {
          const res = await fetchWithCsrf('/api/ai/cobro-comprobante', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              workspace_id: workspaceId,
              exige_comprobante: r.exigeComprobante,
              un_solo_pendiente: r.unSoloPendiente,
              exige_referencia: r.exigeReferencia,
              tolerancia_pct: r.toleranciaPct,
            }),
          });
          if (!res.ok) throw new Error();
        } catch {
          toast.error(t('assistant.updateError'));
        }
      })();
    },
    [workspaceId, fetchWithCsrf, t]
  );

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
      'width=620,height=760'
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

  /**
   * Cuántos PRODUCTOS, no cuántas filas.
   *
   * Asignar el serum guarda cuatro ids —su fila y sus tres publicaciones—, así
   * que contar lo guardado decía "4 productos asignados" sobre uno solo. Se
   * cuenta contra el catálogo agrupado; lo que no esté en él (el catálogo
   * todavía no cargó, o el producto se borró) se cuenta como uno.
   */
  const productosAsignados = useMemo(() => {
    if (catalog.length === 0) return selectedProducts.length;
    const vistos = new Set<string>();
    let n = 0;
    for (const p of catalog) {
      const ids = idsDelGrupo(p);
      ids.forEach((id) => vistos.add(id));
      if (ids.some((id) => selectedProducts.includes(id))) n += 1;
    }
    return n + selectedProducts.filter((id) => !vistos.has(id)).length;
  }, [catalog, selectedProducts]);

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
      requires_approval: requiresApproval,
      inbound_debounce_seconds: inboundDebounce,
      reply_burst_max: burstMax,
      reply_when_assigned: replyWhenAssigned,
      // El horario es un único control: si está activado, sólo responde
      // dentro de la ventana (reply_outside_hours = false). Si no, 24/7.
      reply_outside_hours: !hoursEnabled,
      business_hours: buildBusinessHours(
        hoursEnabled,
        hoursStart,
        hoursEnd,
        hoursTimezone,
        hoursDays
      ),
      escalate_keywords: escalateKeywords,
      escalate_after_messages: escalateAfterMessages,
      followup_enabled: followupEnabled,
      followup_delay_hours: followupDelayHours,
      followup_max_count: followupMaxCount,
      puede_crear_pedidos: puedeCrearPedidos,
      cobro_modo: cobroModo,
      medios_pago: medios,
      role,
      permissions,
      tools,
      // El asistente sólo conserva el vínculo y el permiso para ofrecer una
      // llamada. Voz, guiones y operación pertenecen al perfil en Llamadas.
      voice_agent_id: voiceAgentId || null,
      voice_ai_decides: Boolean(voiceAgentId && voiceCanPropose),
      model: DEFAULT_MODEL,
      scope,
      // El canal de llamadas se guarda aunque la voz esté apagada.
      //
      // Antes se filtraba, con el argumento de no dejar un alcance que no
      // aplica. Pero el filtro corría al GUARDAR, así que apagar la voz un
      // momento —para probar algo, o sin querer— borraba la selección para
      // siempre, sin aviso, y al volver a encenderla el agente ya no atendía
      // el teléfono. Quién atiende una llamada lo decide `pickVoiceAgent`, que
      // ya exige `voice_enabled`: un canal guardado de más no hace nada, uno
      // borrado sí.
      channels: scope === 'channels' ? channels : [],
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
    toast.success(
      editing ? t('assistant.savedToast') : t('assistant.createdToast')
    );
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
        body: JSON.stringify({
          message: text,
          // El hilo de la prueba. Antes no se mandaba y el servidor trataba
          // cada mensaje como el primero: era imposible probar una
          // confirmación, un cambio de idea o cualquier cosa de dos turnos.
          historial: testHistory.map((turn) => ({
            role: turn.role,
            content: turn.chunks.join('\n'),
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? t('assistant.testFailed'));
      const reply: string = json.reply ?? '';
      const chunks: string[] =
        Array.isArray(json.chunks) && json.chunks.length > 0
          ? json.chunks
          : reply
            ? [reply]
            : [];
      setTestHistory((prev) => [
        ...prev,
        {
          role: 'assistant',
          chunks,
          stamp: nowStamp(),
          herramientas: Array.isArray(json.herramientas)
            ? json.herramientas
            : [],
        },
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
        className="border-border bg-card text-foreground grid max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-3xl lg:max-w-5xl"
        showCloseButton={false}
      >
        <div className="border-border flex items-start justify-between border-b px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 text-accent-ink flex size-9 items-center justify-center rounded-lg">
              <Sparkles className="size-4" />
            </div>
            <div>
              <DialogTitle className="text-foreground text-base font-semibold">
                {editing
                  ? name || t('assistant.assistant')
                  : t('assistant.newAgent')}
              </DialogTitle>
              <p className="text-muted-foreground text-xs">
                {t('assistant.editorSubtitle')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowTest((v) => !v)}
              className="border-border bg-background text-foreground hover:bg-accent hidden items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors sm:inline-flex"
              title={
                showTest
                  ? t('assistant.hideTestPanel')
                  : t('assistant.showTestPanel')
              }
            >
              {showTest ? (
                <EyeOff className="size-3.5" />
              ) : (
                <Eye className="size-3.5" />
              )}
              {showTest ? t('assistant.hideTest') : t('assistant.test')}
            </button>
            <label className="text-muted-foreground flex items-center gap-2 text-xs">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              {isActive ? t('assistant.active') : t('assistant.paused')}
            </label>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('assistant.close')}
              className="text-muted-foreground hover:bg-accent hover:text-foreground rounded p-1"
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
              ? // El panel de prueba suma ~520px de rieles fijos: solo a 3 columnas
                // desde lg (donde el diálogo ya es max-w-5xl y hay espacio).
                'lg:grid-cols-[180px_minmax(0,1fr)_340px]'
              : 'sm:grid-cols-[180px_minmax(0,1fr)]'
          )}
        >
          {/* Section nav rail */}
          <nav className="border-border bg-card/40 border-r p-2 sm:py-4">
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
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
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
                      <p className="text-accent-ink flex items-center gap-2 text-[11px]">
                        <Loader2 className="size-3.5 animate-spin" />
                        {t('assistant.preparingWithProduct')}
                      </p>
                    ) : (
                      <p className="text-muted-foreground text-[11px]">
                        {t('assistant.productNewHint')}
                      </p>
                    )
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <ScopeCard
                        active={productScope === 'all'}
                        onClick={() => setProductScope('all')}
                        title={t('assistant.wholeCatalog')}
                      />
                      <ScopeCard
                        active={productScope === 'specific'}
                        onClick={() => setProductScope('specific')}
                        title={t('assistant.someProducts')}
                      />
                    </div>
                  )}
                  {(isNew || productScope === 'specific') && (
                    <div className="mt-2 space-y-2">
                      <div className="relative">
                        <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
                        <Input
                          value={productSearch}
                          onChange={(e) => setProductSearch(e.target.value)}
                          placeholder={t('assistant.searchProduct')}
                          className="bg-background pl-8 text-sm"
                        />
                      </div>
                      <div className="border-border bg-background max-h-[280px] overflow-y-auto rounded-lg border">
                        {catalogLoading ? (
                          <div className="flex justify-center py-6">
                            <Loader2 className="text-muted-foreground size-4 animate-spin" />
                          </div>
                        ) : filteredCatalog.length === 0 ? (
                          <div className="text-muted-foreground space-y-3 px-3 py-6 text-center text-xs">
                            {catalog.length === 0 ? (
                              <>
                                <p>{t('assistant.noProductsYet')}</p>
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
                          <ul className="divide-border divide-y">
                            {filteredCatalog.map((p) => {
                              // Cuenta como asignado si lo está CUALQUIERA de
                              // sus publicaciones: quien asignó el producto
                              // antes de unificarlo tiene apuntada una sola
                              // fila, y el agente ya lo trata como el producto
                              // entero. Mostrarlo sin asignar sería mentirle.
                              const on = idsDelGrupo(p).some((id) =>
                                selectedProducts.includes(id)
                              );
                              return (
                                <li
                                  key={p.id}
                                  className={cn(
                                    'flex items-center gap-3 px-3 py-2',
                                    on && 'bg-primary/10'
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
                                    <div className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded">
                                      <Package className="size-3.5" />
                                    </div>
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <p className="text-foreground truncate text-sm">
                                      {p.title}
                                    </p>
                                    <p className="text-muted-foreground truncate text-[11px]">
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
                                    {/* En qué canales está y a cuánto en cada
                                        uno, igual que la tarjeta de Productos.
                                        Sólo cuando está unificado: para uno de
                                        un solo canal repetiría el precio. */}
                                    {(p.listings?.length ?? 0) > 1 ? (
                                      <div className="mt-1 flex flex-wrap gap-1">
                                        {p.listings!.map((l) => (
                                          <span
                                            key={l.id}
                                            title={l.title ?? undefined}
                                            className="border-border text-muted-foreground inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]"
                                          >
                                            <span className="text-foreground font-medium">
                                              {CANAL[l.platform] ?? l.platform}
                                            </span>
                                            {l.price_min != null
                                              ? `$${l.price_min}`
                                              : ''}
                                          </span>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                  {/* Botón explícito de asignación: la fila ya no
                                      togglea entera, así la selección es precisa. */}
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant={on ? 'default' : 'outline'}
                                    onClick={() => toggleProduct(p)}
                                    className={cn(
                                      'h-7 shrink-0 gap-1 px-2.5 text-xs',
                                      on
                                        ? 'bg-emerald-600 text-white hover:bg-emerald-600/90'
                                        : 'border-border text-foreground hover:bg-muted bg-transparent'
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
                      {/* Elegir "sólo algunos" y no elegir ninguno deja al
                          agente sin catálogo: no puede nombrar, cotizar ni
                          buscar un producto. Es coherente con lo que dice la
                          opción, pero pasa callado — y el agente contesta que
                          no tiene nada a la venta. */}
                      {!isNew && selectedProducts.length === 0 && (
                        <p className="text-foreground rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px]">
                          {t('assistant.scopeSpecificEmpty')}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-muted-foreground text-[11px]">
                          {productosAsignados === 1
                            ? t('assistant.productsAssignedOne', {
                                count: productosAsignados,
                              })
                            : t('assistant.productsAssignedOther', {
                                count: productosAsignados,
                              })}
                        </p>
                        <button
                          type="button"
                          onClick={goToCreateProduct}
                          className="text-accent-ink text-[11px] underline hover:opacity-80"
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
                <SectionCard title={t('assistant.identityTitle')}>
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
                              : 'border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground'
                          )}
                        >
                          {t(toneOption.label)}
                        </button>
                      ))}
                    </div>
                  </Field>
                  <Field label={t('assistant.languageLabel')}>
                    <Select
                      value={language}
                      onValueChange={(v) => setLanguage(v ?? 'es')}
                    >
                      <SelectTrigger className="bg-background w-full">
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
                      className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs"
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
                      className="bg-background resize-y font-mono text-xs leading-relaxed"
                    />
                  ) : (
                    <p className="border-border bg-background/60 text-muted-foreground line-clamp-3 rounded-md border p-3 text-xs leading-relaxed">
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
                    className="bg-background resize-y font-mono text-xs leading-relaxed"
                  />
                </SectionCard>

                {/* Las reglas del negocio. Vivían en una tarjeta suelta debajo
                    de la lista de asistentes, así que se configuraba en un
                    lado lo que se leía en otro: quien abría el asistente para
                    ajustarlo no las veía, y quien las escribía afuera no sabía
                    a qué asistente le hablaba. Van acá, en "Mi negocio", que
                    es de lo que son. */}
                <SectionCard title={t('reglas.title')} hint={t('reglas.hint')}>
                  <ReglasPanel />
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
                    />
                    <ScopeCard
                      active={scope === 'channels'}
                      onClick={() => setScope('channels')}
                      title={t('assistant.someChannels')}
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
                              'flex items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors',
                              on
                                ? 'border-primary/60 bg-primary/10 text-foreground'
                                : 'border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground'
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
                            ) : null}
                            {/* Los canales son marcas y van literales; los que no
                            —llamadas, chat web— traen una clave i18n. Se
                            distinguían por si tenían logo, y eso se rompió el
                            día que uno sin marca tuvo ícono propio. */}
                            {c.label.includes('.') ? t(c.label) : c.label}
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
                    <Switch
                      checked={hoursEnabled}
                      onCheckedChange={setHoursEnabled}
                    />
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
                        <p className="text-muted-foreground text-[11px]">
                          {t('assistant.hoursOvernight')}
                        </p>
                      )}
                      <Field label={t('assistant.timezoneLabel')}>
                        <Select
                          value={hoursTimezone}
                          onValueChange={(v) =>
                            setHoursTimezone(v ?? 'America/Bogota')
                          }
                        >
                          <SelectTrigger className="bg-background w-full">
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
                                    : 'border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground'
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
              </>
            )}

            {tab === 'stats' && agent?.id && <AgentStats agentId={agent.id} />}

            {tab === 'tools' && (
              <>
                {/* Qué hace el agente y cuándo entrás vos. Tiene pestaña propia
                    porque es LA decisión del producto: estaba dentro de
                    "Avanzado", junto a la temperatura del modelo y los tiempos
                    de espera, y el comercio no la encontraba. */}
                <SectionCard
                  title={t('operation.toolsTitle')}
                  hint={t('operation.toolsHint')}
                >
                  <ToolSwitchboard
                    agent={{
                      permissions,
                      puede_crear_pedidos: puedeCrearPedidos,
                    }}
                    tools={tools}
                    onChange={setTools}
                    disponible={disponible}
                    tope={topeDescuento}
                    onTope={guardarTope}
                    reglas={reglasCobro}
                    onReglas={guardarReglasCobro}
                  />
                </SectionCard>

                <VoiceAgentLink
                  workspaceId={workspaceId}
                  agentId={currentAgentId}
                  value={voiceAgentId}
                  onChange={setVoiceAgentId}
                  canPropose={voiceCanPropose}
                  onCanProposeChange={setVoiceCanPropose}
                />

                {/* Cómo se cobra. Va debajo de la pizarra porque depende de
                    ella: sólo hay algo que elegir cuando el agente puede
                    tanto mandar a la caja como tomar el pedido. Con una sola
                    de las dos, la decisión ya está tomada. */}
                {(tools?.crear_checkout ?? 'auto') !== 'off' &&
                puedeCrearPedidos ? (
                  <SectionCard
                    title={t('operation.cobroTitle')}
                    hint={t('operation.cobroHint')}
                  >
                    <Select
                      value={cobroModo}
                      onValueChange={(v) =>
                        setCobroModo((v as typeof cobroModo) ?? 'segun_pago')
                      }
                    >
                      <SelectTrigger className="bg-background w-full">
                        {/* Con `labels`: sin ellas el disparador pinta el valor
                            crudo de la columna ("segun_pago"), que es el nombre
                            interno y no le dice nada a nadie. */}
                        <SelectValue labels={COBRO_LABELS} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="segun_pago">
                          {t('operation.cobroSegunPago')}
                        </SelectItem>
                        <SelectItem value="chat">
                          {t('operation.cobroChat')}
                        </SelectItem>
                        <SelectItem value="checkout">
                          {t('operation.cobroCheckout')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </SectionCard>
                ) : null}

                {/* Con qué se puede pagar. Va acá y no adentro del bloque de
                    arriba porque no depende de la caja: hay comercios que
                    cobran a la caja Y aceptan pago al recibir.

                    Sin marcar nada NO significa "ninguno": significa que
                    todavía no lo dijo, y ahí el asistente calla y pasa a una
                    persona. Forzar una respuesta al crear el asistente sería
                    peor — el que apura marca cualquier cosa, y prometer un
                    medio de pago que no existe es exactamente el error que
                    esto vino a arreglar. */}
                {puedeCrearPedidos ? (
                  <SectionCard
                    title={t('operation.mediosTitle')}
                    hint={t('operation.mediosHint')}
                  >
                    <div className="grid gap-2 sm:grid-cols-2">
                      {MEDIOS_PAGO.map((m) => {
                        const puesto = medios?.includes(m) ?? false;
                        return (
                          <label
                            key={m}
                            className="border-border/60 bg-background flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"
                          >
                            <Switch
                              checked={puesto}
                              onCheckedChange={(v) =>
                                setMedios((prev) => {
                                  const base = prev ?? [];
                                  return v
                                    ? MEDIOS_PAGO.filter(
                                        (k) => k === m || base.includes(k)
                                      )
                                    : base.filter((k) => k !== m);
                                })
                              }
                            />
                            <span>
                              {t(
                                `operation.medio${m.charAt(0).toUpperCase()}${m.slice(1)}`
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </SectionCard>
                ) : null}

                {/* El rol va acá al lado: no habilita nada, decide a quién le
                    toca el mensaje cuando hay varios agentes en un canal. */}
                <SectionCard
                  title={t('operation.roleLabel')}
                  hint={t('operation.roleHint')}
                >
                  <Select
                    value={role}
                    onValueChange={(v) =>
                      aplicarRol((v as AgentRole) ?? 'general')
                    }
                  >
                    <SelectTrigger className="bg-background w-full">
                      <SelectValue labels={ROLE_LABELS} />
                    </SelectTrigger>
                    <SelectContent>
                      {AGENT_ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          <div className="flex flex-col">
                            <span className="text-foreground text-sm">
                              {t(`operation.role${ROLE_KEY[r]}Name`)}
                            </span>
                            <span className="text-muted-foreground text-[11px]">
                              {t(`operation.role${ROLE_KEY[r]}What`)}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SectionCard>
              </>
            )}

            {tab === 'advanced' && (
              <>
                {/* Rol y permisos (migración 164). El rol reparte el trabajo
                    cuando hay varios agentes en un canal; los permisos dicen
                    qué puede tocar este. */}
                <SectionCard title={t('assistant.responseBehaviorTitle')}>
                  <Field label={t('assistant.autonomyLabel')}>
                    <Select
                      value={requiresApproval ? 'approval' : 'auto'}
                      onValueChange={(v) =>
                        setRequiresApproval(v === 'approval')
                      }
                    >
                      <SelectTrigger className="bg-background w-full">
                        <SelectValue labels={AUTONOMY_LABELS} />
                      </SelectTrigger>
                      <SelectContent>
                        {AUTONOMY_MODES.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            <div className="flex flex-col">
                              <span className="text-foreground text-sm">
                                {t(m.label)}
                              </span>
                              <span className="text-muted-foreground text-[11px]">
                                {t(m.hint)}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field label={t('assistant.responseModeLabel')}>
                    <Select
                      value={responseMode}
                      onValueChange={(v) =>
                        setResponseMode((v as AiResponseMode) ?? 'single')
                      }
                    >
                      <SelectTrigger className="bg-background w-full">
                        <SelectValue labels={RESPONSE_MODE_LABELS} />
                      </SelectTrigger>
                      <SelectContent>
                        {RESPONSE_MODES.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            <div className="flex flex-col">
                              <span className="text-foreground text-sm">
                                {t(m.label)}
                              </span>
                              <span className="text-muted-foreground text-[11px]">
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
                            : MIN_DEBOUNCE_SECONDS
                        );
                      }}
                      className="bg-background"
                    />
                    <p className="text-muted-foreground text-[11px]">
                      {t('assistant.debounceHelp')}
                    </p>
                  </Field>

                  {/* El fusible contra un bucle. Estaba escrito en el código y
                      nadie podía moverlo: quien tiene conversaciones largas se
                      topaba con el freno sin saber que existía. */}
                  <Field label={t('assistant.burstLabel')}>
                    <Input
                      type="number"
                      min={0}
                      max={200}
                      value={burstMax}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        setBurstMax(
                          Number.isFinite(n)
                            ? Math.max(0, Math.min(200, n))
                            : 20
                        );
                      }}
                      className="bg-background"
                    />
                    <p className="text-muted-foreground text-[11px]">
                      {burstMax === 0
                        ? t('assistant.burstOff')
                        : t('assistant.burstHelp')}
                    </p>
                  </Field>
                </SectionCard>

                <SectionCard
                  title={t('assistant.escalationTitle')}
                  hint={t('assistant.escalationHint')}
                >
                  {/* Las palabras que escalan vivian en "Alcance", a dos
                      pestanas del "escalar despues de N mensajes": la misma
                      decision partida en dos lugares, y ninguno de los dos
                      mostraba la mitad que faltaba. */}
                  <Field label={t('assistant.escalateKeywordsLabel')}>
                    <div className="border-border bg-background flex flex-wrap gap-1.5 rounded-lg border p-2">
                      {escalateKeywords.map((kw) => (
                        <span
                          key={kw}
                          className="bg-primary/15 text-accent-ink inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs"
                        >
                          {kw}
                          <button
                            type="button"
                            onClick={() => toggleEscalate(kw)}
                            className="rounded hover:text-red-700 dark:hover:text-red-400"
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
                        className="text-foreground min-w-[140px] flex-1 bg-transparent px-1 text-xs focus:outline-none"
                      />
                    </div>
                  </Field>
                  <Field label={t('assistant.escalateAfterLabel')}>
                    <Input
                      type="number"
                      min={0}
                      value={escalateAfterMessages}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        setEscalateAfterMessages(
                          Number.isFinite(n) ? Math.max(0, n) : 0
                        );
                      }}
                      className="bg-background"
                    />
                    <p className="text-muted-foreground text-[11px]">
                      {t('assistant.escalateAfterHelp')}
                    </p>
                  </Field>
                  {/* A donde cae el aviso. Estaba resuelto en el codigo y no
                      se veia en ningun lado: se descubria el dia que hubiera
                      un caso urgente, que es el peor dia para descubrirlo. */}
                  <AvisoEscalada />
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
                                Number.isFinite(n)
                                  ? Math.max(1, Math.min(23, n))
                                  : 23
                              );
                            }}
                            className="bg-background"
                          />
                          <p className="text-muted-foreground text-[11px]">
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
                                Number.isFinite(n)
                                  ? Math.max(1, Math.min(5, n))
                                  : 1
                              );
                            }}
                            className="bg-background"
                          />
                          <p className="text-muted-foreground text-[11px]">
                            {t('assistant.followupMaxHelp')}
                          </p>
                        </Field>
                      </div>
                      <p className="text-muted-foreground text-[11px]">
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
                      <p className="text-muted-foreground text-[11px]">
                        {t('assistant.salesCloseConnectPrompt')}
                      </p>
                      {showLinkInput ? (
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Input
                            value={linkShop}
                            onChange={(e) => setLinkShop(e.target.value)}
                            onKeyDown={(e) =>
                              e.key === 'Enter' && linkShopify()
                            }
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
                        <p className="text-muted-foreground text-[11px]">
                          {t('assistant.linkingHint')}
                        </p>
                      )}
                    </div>
                  ) : null}
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
            <aside className="border-border bg-muted/30 flex min-h-0 flex-col overflow-hidden border-t sm:border-t-0 sm:border-l">
              <div className="border-border bg-card flex items-center justify-between gap-2 border-b px-4 py-3">
                <div className="min-w-0">
                  <p className="text-foreground text-xs font-semibold">
                    {t('assistant.testPanelTitle')}
                  </p>
                  <p className="text-muted-foreground text-[11px]">
                    {t('assistant.testPanelSubtitle')}
                  </p>
                </div>
                {testHistory.length > 0 && (
                  <button
                    type="button"
                    onClick={resetTestConversation}
                    className="border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[10px] transition-colors"
                    title={t('assistant.resetConversation')}
                  >
                    <RotateCcw className="size-3" />
                    {t('assistant.reset')}
                  </button>
                )}
              </div>
              {/* De acá para abajo los hex sueltos (#ece5dd, #111b21, #dcf8c6,
                #54656f…) y los `bg-white` son el cromo REAL de WhatsApp, no
                un descuido del sistema de temas: la prueba tiene que verse
                como el teléfono del cliente, así que no siguen el modo
                claro/oscuro ni se cambian por tokens. */}
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
                      turn.role === 'user' ? 'items-end' : 'items-start'
                    )}
                  >
                    {/* Sender label so it's unmistakable who is who: the
                      tester ("Tú", green) vs the assistant (its name, blue). */}
                    <span
                      className={cn(
                        'px-1 text-[10px] font-semibold',
                        turn.role === 'user'
                          ? 'text-[#1d7a45]'
                          : 'text-[#0a6ebd]'
                      )}
                    >
                      {turn.role === 'user'
                        ? t('assistant.you')
                        : name.trim() || t('assistant.assistant')}
                    </span>
                    {turn.chunks.length === 0 ? (
                      <div
                        className={cn(
                          'relative max-w-[85%] rounded-lg px-2 py-1.5 text-[13px] leading-snug shadow-sm',
                          turn.role === 'user'
                            ? 'rounded-br-none bg-[#dcf8c6] text-[#111b21]'
                            : 'border-border rounded-bl-none border bg-white text-[#111b21]'
                        )}
                      >
                        <span className="text-[#6b7280] italic">
                          {t('assistant.noReply')}
                        </span>
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
                                    isLast ? 'rounded-br-none' : ''
                                  )
                                : cn(
                                    'border-border border bg-white text-[#111b21]',
                                    isLast ? 'rounded-bl-none' : ''
                                  )
                            )}
                          >
                            <p className="pr-10 whitespace-pre-wrap">{chunk}</p>
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
                    {/* Con qué se ayudó para contestar. Sin esto no hay forma de
                      distinguir una respuesta buscada de una inventada, que es
                      justo lo que se viene a mirar acá. */}
                    {turn.role === 'assistant' &&
                      (turn.herramientas?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap gap-1 px-1">
                          {turn.herramientas!.map((h, hi) => (
                            <span
                              key={`${h}-${hi}`}
                              className="rounded bg-white/70 px-1.5 py-px font-mono text-[9px] text-[#54656f]"
                            >
                              {h}
                            </span>
                          ))}
                        </div>
                      )}
                  </div>
                ))}
                {testing && (
                  <div className="flex items-start">
                    <div className="border-border rounded-lg rounded-bl-none border bg-white px-3 py-2 text-[13px] leading-snug text-[#111b21] shadow-sm">
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
              <div className="border-border border-t bg-[#f0f0f0] p-2">
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

        <div className="border-border bg-card/60 flex items-center justify-end gap-2 border-t px-4 py-4 sm:px-6">
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
/**
 * Un ítem de la investigación del producto, como texto.
 *
 * La investigación NO siempre devuelve strings: las objeciones vienen como
 * `{objection, rebuttal}` y otras listas traen `{title, detail}`. Un `String(x)`
 * sobre eso escribe "[object Object]" — y ese texto termina DENTRO de la persona
 * del agente, o sea dentro del prompt. Pasó de verdad: el asesor de Serum Pilar
 * quedó con "Maneja con tacto estas objeciones comunes: [object Object];
 * [object Object]" y se quedó sin ninguna objeción que manejar.
 */
function researchText(x: unknown): string {
  if (typeof x === 'string') return x.trim();
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    // Se arma "objeción → respuesta" cuando vienen las dos mitades.
    const pick = (...keys: string[]) =>
      keys.map((k) => o[k]).find((v) => typeof v === 'string' && v.trim()) as
        | string
        | undefined;
    const head = pick(
      'objection',
      'objeción',
      'title',
      'titulo',
      'name',
      'text',
      'texto'
    );
    const tail = pick(
      'rebuttal',
      'response',
      'respuesta',
      'answer',
      'detail',
      'detalle'
    );
    if (head && tail) return `${head.trim()} → ${tail.trim()}`;
    if (head) return head.trim();
    if (tail) return tail.trim();
    const any = Object.values(o).find((v) => typeof v === 'string' && v.trim());
    return typeof any === 'string' ? any.trim() : '';
  }
  return x == null ? '' : String(x).trim();
}

function buildBusinessInfoFromProduct(p: ProductDetail, t: TFn): string {
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(researchText).filter(Boolean) : [];
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
    Array.isArray(v) ? v.map(researchText).filter(Boolean) : [];
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
      lines.push(
        en
          ? `Your typical customer: ${audience}.`
          : `Tu cliente típico: ${audience}.`
      );
    }
    const benefits = arr(sr.benefits ?? sr.desires).slice(0, 4);
    if (benefits.length) {
      lines.push(
        en
          ? `Lean on these benefits to convince: ${benefits.join('; ')}.`
          : `Apóyate en estos beneficios para convencer: ${benefits.join('; ')}.`
      );
    }
    const objections = arr(sr.objections).slice(0, 4);
    if (objections.length) {
      lines.push(
        en
          ? `Handle these common objections tactfully: ${objections.join('; ')}.`
          : `Maneja con tacto estas objeciones comunes: ${objections.join('; ')}.`
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

function Field({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
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
    <div className="border-border bg-card/40 space-y-3 rounded-2xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-foreground text-sm font-semibold">{title}</p>
          {hint && <p className="text-muted-foreground text-[11px]">{hint}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

/** El asistente de chat delega la llamada a un perfil creado en Llamadas. */
function VoiceAgentLink({
  workspaceId,
  agentId,
  value,
  onChange,
  canPropose,
  onCanProposeChange,
}: {
  workspaceId: string;
  agentId: string | null;
  value: string;
  onChange: (id: string) => void;
  canPropose: boolean;
  onCanProposeChange: (value: boolean) => void;
}) {
  const t = useT();
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/ai/agents?workspace_id=${workspaceId}`, {
        cache: 'no-store',
      });
      if (!res.ok || cancelled) {
        if (!cancelled) setLoading(false);
        return;
      }
      const json = (await res.json()) as {
        agents?: { id: string; name: string; voice_enabled?: boolean }[];
      };
      if (!cancelled) {
        setAgents(
          (json.agents ?? [])
            .filter((agent) => agent.voice_enabled && agent.id !== agentId)
            .map((agent) => ({ id: agent.id, name: agent.name }))
        );
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, agentId]);

  return (
    <SectionCard title={t('voice.linkTitle')} hint={t('voice.linkHint')}>
      {loading ? (
        <Loader2 className="text-muted-foreground size-4 animate-spin" />
      ) : agents.length === 0 ? (
        <Link
          href="/voz"
          className="border-border bg-background hover:bg-muted inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium text-foreground transition-colors"
        >
          <Plus className="size-4" />
          {t('voice.linkCreate')}
        </Link>
      ) : (
        <>
          <select
            value={value}
            onChange={(event) => {
              const next = event.target.value;
              onChange(next);
              if (!next) onCanProposeChange(false);
            }}
            className="border-border bg-background text-foreground h-9 w-full rounded-lg border px-2.5 text-sm"
          >
            <option value="">{t('voice.linkNone')}</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          {value && (
            <ToggleRow
              checked={canPropose}
              onChange={onCanProposeChange}
              title={t('voice.linkPropose')}
              hint={t('voice.linkProposeHint')}
            />
          )}
        </>
      )}
    </SectionCard>
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
  hint?: string;
}) {
  return (
    <label className="border-border bg-background flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5">
      <div>
        <p className="text-foreground text-sm">{title}</p>
        {hint && <p className="text-muted-foreground text-[11px]">{hint}</p>}
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
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-xl border px-3 py-2.5 text-left transition-colors',
        active
          ? 'border-primary/60 bg-primary/10'
          : 'border-border bg-background hover:border-foreground/30'
      )}
    >
      <p className="text-foreground text-sm font-medium">{title}</p>
      {hint && <p className="text-muted-foreground text-[11px]">{hint}</p>}
    </button>
  );
}
