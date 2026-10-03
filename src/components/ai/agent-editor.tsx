'use client';

import { useEffect, useState } from 'react';

import Image from 'next/image';
import Link from '@/components/i18n/locale-link';
import { toast } from 'sonner';
import { Loader2, Sparkles, X, Plus, Briefcase, Radio, SlidersHorizontal, Settings as SettingsIcon, ChevronDown, ChevronRight } from 'lucide-react';
import { AgentStats } from '@/components/ai/agent-stats';
import { MODELO_POR_DEFECTO } from '@/lib/ai/esfuerzo';

import { ReglasPanel } from '@/components/ai/reglas-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT, useLocale } from '@/hooks/use-locale';

import { ToolSwitchboard, type Disponibilidad } from './tool-switchboard';
import { ToolContextPolicies } from './tool-context-policies';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { DocumentSources } from './document-sources';

import { limpiarPersona } from '@/lib/ai/persona-limpia';
import type { AgentTools } from '@/lib/ai/toolbox';

import type { AiAgent, AiResponseMode, AiScope, AiTone, BusinessHours } from '@/lib/ai/types';
import { MIN_DEBOUNCE_SECONDS } from '@/lib/ai/types';

import { type AgentPermissions, type AgentRole } from '@/lib/ai/roles';

import type { AgentSummary } from '@/app/(dashboard)/asistente/page';
import type { Channel } from '@/types';
import { AvisoEscalada } from '@/components/ai/aviso-escalada';

/** "shopify" → "Shopify". Los nombres propios se escriben como se escriben.
 *  Mismo mapa que la pantalla de Productos: un canal nombrado distinto en cada
 *  pantalla deja de parecer el mismo producto. */


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
  es: 'Eres el asistente de un vendedor de carros. Ayudas a elegir una unidad disponible, coordinar visitas y dar seguimiento. Respondes con calidez y vas directo al grano.',
  en: 'You assist a car salesperson. Help buyers choose available vehicles, arrange visits and follow up. Reply warmly and get straight to the point.',
};

function defaultPersona(locale: string): string {
  return DEFAULT_PERSONAS[locale === 'en' ? 'en' : 'es'];
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
  { value: 'webchat', label: 'nav.webchat', icon: '/channels/webchat.svg' },
];

// label es una clave i18n resuelta con t() en el render.
const LANGUAGES: { code: string; label: string }[] = [
  { code: 'es', label: 'assistant.languageSpanish' },
  { code: 'en', label: 'assistant.languageEnglish' },
  { code: 'pt', label: 'assistant.languagePortuguese' },
  { code: 'fr', label: 'assistant.languageFrench' },
];

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

  // Cómo cierra la venta (migración 219). Elige entre lo que la pizarra ya
  // permite: con una sola de las dos herramientas prendida no hay nada que
  // elegir y el control no se muestra.

  // `null` no es la lista vacía: es "todavía no lo declaró". Con null el
  // agente no nombra ningún medio y no confirma contra entrega — pasa a una
  // persona. Es donde arranca todo asistente nuevo, y es el lado seguro.

  // Rol y permisos por acción (migración 164). `permissions` en null significa
  // "usá las columnas viejas": los agentes anteriores siguen igual hasta que
  // alguien toque uno de estos interruptores.
  const role: AgentRole = agent?.role ?? 'general';
  const permissions: AgentPermissions | null = agent?.permissions ?? null;
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

  /** Con qué pruebas da un pedido por cobrado. También de la cuenta. */


  /**
   * Cambiar de rol trae su preset de permisos.
   *
   * Elegir "Postventa" y que el agente siga pudiendo crear pedidos sería el rol
   * como etiqueta y no como decisión. Quien quiera otra cosa mueve los
   * interruptores después: el preset es un punto de partida, no un candado.
   */

  // Estado de la conexión Shopify para gatear "Cierre de ventas". null =
  // cargando. El cierre solo se puede activar con Shopify conectado; si no,
  // mostramos un botón "Vincular" que abre un popup sin salir del editor.

  // Sin la app pública aprobada no hay OAuth: se vincula desde la tarjeta
  // de Integraciones, con las credenciales de la app de la tienda.


  // Id del poll de conexión Shopify, para limpiarlo al desmontar (evita
  // un setInterval huérfano si se cierra el editor a mitad de la vinculación).

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


  // Al elegir el primer producto de un asistente nuevo, preparamos una
  // plantilla (persona + conocimiento) desde su info e investigación.


  const [saving, setSaving] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showAdvancedPersona, setShowAdvancedPersona] = useState(false);
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

  // Load the synced Shopify catalog the first time the user expands
  // "Productos asignados" so we don't pull it for every editor open.

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


  // Con qué pruebas se da un pedido por cobrado. También de la CUENTA, y por
  // el mismo motivo que el tope: es la política de cobro del negocio, no la
  // personalidad de un agente.


  // Estado de la conexión Shopify (gatea "Cierre de ventas").

  // Vincula Shopify desde un popup, sin que el usuario salga del editor. Al
  // detectar la conexión activa, habilita el cierre de ventas en el acto.


  // Limpia el poll de conexión Shopify si el editor se desmonta a media
  // vinculación (evita un setInterval huérfano golpeando /status).

  /**
   * Cuántos PRODUCTOS, no cuántas filas.
   *
   * Asignar el serum guarda cuatro ids —su fila y sus tres publicaciones—, así
   * que contar lo guardado decía "4 productos asignados" sobre uno solo. Se
   * cuenta contra el catálogo agrupado; lo que no esté en él (el catálogo
   * todavía no cargó, o el producto se borró) se cuenta como uno.
   */


  /** Redirige (misma pestaña) a crear un producto en la sección Productos. */


  async function save() {
    if (!name.trim()) {
      toast.error(t('assistant.nameRequired'));
      return;
    }
    // Al crear (incl. cuando se generó con IA desde la web), exigimos al
    // menos un producto: el asistente se entrena con su información. En
    // edición respetamos el scope ya guardado.

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
      api_key?: string;
      workspace_id?: string;
      channels?: string[];
      product_ids?: string[];
    } = {
      workspace_id: workspaceId,
      ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
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
      puede_crear_pedidos: (false),
      cobro_modo: null,
      medios_pago: null,
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
      product_scope: ('all'),
      product_ids: [],
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
            tab === 'stats'
              ? 'sm:grid-cols-1'
              : 'sm:grid-cols-[180px_minmax(0,1fr)]'
          )}
        >
          {/* Section nav rail */}
          {tab !== 'stats' && (
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
          )}

          {/* Form column */}
          <div className="space-y-6 overflow-y-auto p-4 sm:p-6">
            {tab === 'business' && (
              <>
                {/* Producto PRIMERO: elegirlo dispara la investigación y
                    puebla identidad, persona y conocimiento. Es el paso 1 del
                    flujo product-first. */}
                {((
                  <SectionCard
                    title={t('dealers.vehicles')}
                    hint={t('dealers.assistantInventoryHint')}
                  >
                    <Link
                      href="/concesionario?view=vehicles"
                      className="text-sm underline underline-offset-4"
                    >
                      {t('dealers.vehicles')}
                    </Link>
                  </SectionCard>
                ))}

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
                  {SHOW_RIVERZ_IMPROVEMENTS && currentAgentId && (
                    <DocumentSources
                      key={currentAgentId}
                      agentId={currentAgentId}
                    />
                  )}
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
                      puede_crear_pedidos: false,
                    }}
                    tools={tools}
                    onChange={setTools}
                    disponible={disponible}


                  />
                  {SHOW_RIVERZ_IMPROVEMENTS && currentAgentId && (
                    <ToolContextPolicies
                      key={currentAgentId}
                      agentId={currentAgentId}
                    />
                  )}
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


                {/* Con qué se puede pagar. Va acá y no adentro del bloque de
                    arriba porque no depende de la caja: hay comercios que
                    cobran a la caja Y aceptan pago al recibir.

                    Sin marcar nada NO significa "ninguno": significa que
                    todavía no lo dijo, y ahí el asistente calla y pasa a una
                    persona. Forzar una respuesta al crear el asistente sería
                    peor — el que apura marca cualquier cosa, y prometer un
                    medio de pago que no existe es exactamente el error que
                    esto vino a arreglar. */}


                {/* El rol va acá al lado: no habilita nada, decide a quién le
                    toca el mensaje cuando hay varios agentes en un canal. */}

              </>
            )}

            {tab === 'advanced' && (
              <>
                <SectionCard title={t('assistant.apiKeyTitle')}>
                  <Field label={t('assistant.apiKeyLabel')}>
                    <Input
                      type="password"
                      aria-label={t('assistant.apiKeyLabel')}
                      autoComplete="new-password"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder={
                        agent?.has_api_key
                          ? t('assistant.apiKeyPlaceholderSaved')
                          : 'sk-ant-…'
                      }
                    />
                    <p className="text-muted-foreground mt-1 text-xs">
                      {t('assistant.apiKeyHelp')}
                    </p>
                  </Field>
                </SectionCard>
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


              </>
            )}
          </div>
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
          className="border-border bg-background hover:bg-muted text-foreground inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors"
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
