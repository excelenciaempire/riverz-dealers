'use client';
import { VoiceNoteEditor } from '@/components/voice/voice-note-editor';
import type { VoiceNoteConfig } from '@/lib/voice-notes/types';

import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  insertAt,
  getAt,
  contieneCid,
  mapAtPath,
  removeAt,
  moveAt,
  type ParentScope,
  type StepPath,
} from './step-tree';
import Image from 'next/image';
import Link from '@/components/i18n/locale-link';
import { useLocalizedRouter } from '@/hooks/use-localized-router';
import { toast } from 'sonner';
import {
  ArrowLeft,
  AlertTriangle,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  GripVertical,
  Hourglass,
  Zap,
  Loader2,
  ArrowRight,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  BarChart3,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import type {
  AutomationStepType,
  AutomationTriggerType,
  KeywordMatchTriggerConfig,
  MessageTemplate,
  Profile,
  Tag as ContactTag,
} from '@/types';
import type { ContactSegment } from '@/lib/segments/types';
import { createClient } from '@/lib/supabase/client';
import { useActiveConnections } from '@/hooks/use-active-connections';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useWorkspace } from '@/hooks/use-workspace';
import { useT } from '@/hooks/use-locale';
import type { TFn } from '@/lib/i18n/translate';
import { cn } from '@/lib/utils';
import { BranchFan, HEAD_H, LINE, STEP_META } from './lienzo-piezas';
import { AbTestResults } from './ab-test-results';
import { WhatsappPreview } from '@/components/templates/whatsapp-preview';
import {
  extractVariables,
  type TemplateButtonInput,
} from '@/lib/whatsapp/template-components';
import {
  DATA_POINTS,
  templateDataPoints,
  conditionDataPoints,
  dataPointById,
  type DataPoint,
} from '@/lib/automations/data-points';
import {
  TIME_DP_ID,
  cfgDeDato,
  datoDeCfg,
} from '@/lib/automations/condition-config';
import {
  validateStepsForActivation,
  validateTriggerForActivation,
  type ValidationIssue,
} from '@/lib/automations/validate';
import {
  compileSwitch,
  collapseSwitch,
  type SwitchData,
  type StepShape,
} from '@/lib/automations/switch-compile';
import type { TemplateHeaderType } from '@/lib/whatsapp/template-components';

/** Approved templates, shared with the send_template editor + the phone
 *  preview without threading props through the recursive step tree. */
const TemplatesContext = createContext<MessageTemplate[]>([]);
const AutomationIdContext = createContext<string | null>(null);
const InvalidStepContext = createContext<string | null>(null);

/** Saved contact segments — used by the audience picker on the trigger
 *  card and by the `in_segment` condition subject inside the step tree. */
const SegmentsContext = createContext<ContactSegment[]>([]);

/** The workspace's tags. Powers every "pick a tag" dropdown (add/remove
 *  tag steps, the tag_added trigger, the tag_presence condition) so the
 *  user chooses a name instead of pasting a raw id. */
const TagsContext = createContext<ContactTag[]>([]);

/** Lets a deep TagSelect add a freshly-created tag to the shared list so it
 *  renders + stays selected without a full reload. */
const TagsMutateContext = createContext<((tag: ContactTag) => void) | null>(
  null
);

/** Team members. Powers the agent picker when a conversation is assigned
 *  to a specific person — name in the menu, user id under the hood. */
const AgentsContext = createContext<Profile[]>([]);

/** Etiquetas de las ofertas configuradas del workspace (de
 *  shopify_products.allowed_offers + workspace_checkout_config.offers).
 *  Powers the `offer_chosen` condition dropdown so el merchant elige la
 *  oferta exacta en vez de tipearla. */
const OffersContext = createContext<string[]>([]);

/** Títulos de los productos sincronizados de Shopify (shopify_products.title).
 *  Powers el dropdown de la condición `last_product` para que el merchant elija
 *  de sus productos reales en vez de tipear el nombre. */
const ProductsContext = createContext<string[]>([]);

/** The automation's trigger type, so each step can filter data points to what
 *  that trigger actually exposes (e.g. tracking_* only after fulfillment). */
const PLATFORM_LABEL: Record<string, string> = {
  shopify: 'Shopify',
  tiendanube: 'Tiendanube',
  woocommerce: 'WooCommerce',
};

const TriggerContext = createContext<AutomationTriggerType>(
  'shopify_order_created'
);

/** True when this automation calls somewhere. The call result (contestó,
 *  no contestó, resumen) then becomes available to conditions and template
 *  variables regardless of the trigger — that's what lets "llamar; si no
 *  contesta, mandar WhatsApp" be ONE automation. */
const HasVoiceCallContext = createContext<boolean>(false);

/** Does any step in the tree place a call? Branches and switch cases count —
 *  a call inside a path still seeds the result for everything after it. */
function treeHasVoiceCall(steps: BuilderStep[]): boolean {
  return steps.some((s) => {
    if (s.step_type === 'voice_call') return true;
    if (
      s.branches &&
      (treeHasVoiceCall(s.branches.yes) || treeHasVoiceCall(s.branches.no))
    )
      return true;
    const cases = s.switchData?.cases ?? [];
    if (cases.some((c) => treeHasVoiceCall(c.steps ?? []))) return true;
    return treeHasVoiceCall(s.switchData?.elseSteps ?? []);
  });
}

/**
 * La rama «si no contesta», armada desde la propia tarjeta de la llamada.
 *
 * Esperar el resultado sólo sirve para decidir después, y decidir pedía saber
 * que existía un nodo «Condición» y adivinar cuál de los datos era el
 * resultado de la llamada. Nadie iba a hacerlo, así que la llamada quedaba
 * siendo un tiro al aire.
 */
interface RamaLlamada {
  /** ¿El paso siguiente ya es la bifurcación por el resultado? */
  yaTiene: (cid: string) => boolean;
  /** Arma la bifurcación justo después de esa tarjeta. */
  armar: (cid: string) => void;
}

const RamaLlamadaContext = createContext<RamaLlamada | null>(null);

/**
 * Recorre TODAS las listas del árbol —tronco, ramas sí/no y cada camino de
 * una condición— aplicando `fn`. Es la forma de tocar el vecino de una
 * tarjeta sin conocer su ruta: el editor sólo sabe su propio `cid`.
 */
function mapListas(
  steps: BuilderStep[],
  fn: (lista: BuilderStep[]) => BuilderStep[]
): BuilderStep[] {
  return fn(steps).map((s) => ({
    ...s,
    branches: s.branches
      ? { yes: mapListas(s.branches.yes, fn), no: mapListas(s.branches.no, fn) }
      : s.branches,
    switchData: s.switchData
      ? {
          ...s.switchData,
          cases: s.switchData.cases.map((c) => ({
            ...c,
            steps: mapListas(c.steps ?? [], fn),
          })),
          elseSteps: mapListas(s.switchData.elseSteps ?? [], fn),
        }
      : s.switchData,
  }));
}

/** El paso que viene justo después de `cid`, esté donde esté en el árbol. */
function vecinoSiguiente(
  steps: BuilderStep[],
  cid: string
): BuilderStep | null {
  const i = steps.findIndex((s) => s.cid === cid);
  if (i >= 0) return steps[i + 1] ?? null;
  for (const s of steps) {
    const listas = [
      s.branches?.yes,
      s.branches?.no,
      ...(s.switchData?.cases ?? []).map((c) => c.steps),
      s.switchData?.elseSteps,
    ];
    for (const l of listas) {
      if (!l) continue;
      const hit = vecinoSiguiente(l, cid);
      if (hit) return hit;
      if (l.some((x) => x.cid === cid)) return null;
    }
  }
  return null;
}

/** ¿Es ése el nodo que bifurca por cómo salió la llamada? */
function esRamaDeLlamada(step: BuilderStep | null): boolean {
  return Boolean(
    step &&
    step.step_type === 'switch' &&
    step.switchData?.dpId === 'call_status'
  );
}

/**
 * La bifurcación por el resultado: un camino para «contestó» y el resto —sin
 * respuesta, ocupado, buzón, o directamente no se llamó— cayendo en «en otro
 * caso», que es donde queda el mensaje. La plantilla la elige el comercio en
 * la tarjeta que se inserta: armamos la forma, no el texto.
 */
function ramaSiNoContesta(nuevoId: () => string): BuilderStep {
  return {
    cid: nuevoId(),
    step_type: 'switch',
    step_config: {},
    switchData: {
      dpId: 'call_status',
      cases: [
        {
          ckey: nuevoId(),
          cfg: {
            subject: 'context_var',
            operand: 'call_status',
            op: 'eq',
            value: 'completed',
            value2: undefined,
          },
          steps: [],
        },
      ],
      elseSteps: [
        {
          cid: nuevoId(),
          step_type: 'send_template',
          step_config: blankConfig('send_template'),
        },
      ],
    },
  };
}

/** Live count of contacts currently parked at each wait step, keyed by the
 *  persisted step id. Only populated when editing a saved automation; empty
 *  during template previews / new drafts (nothing is waiting yet). */
const WaitingCountsContext = createContext<Record<string, number>>({});

/**
 * El paso que se está arrastrando.
 *
 * Vive en un contexto y no en props porque quien lo levanta (la tarjeta) y
 * quien lo recibe (cada "+ Añadir") están en ramas distintas del árbol, a
 * veces con tres condiciones de por medio.
 *
 * Se usa el arrastre nativo del navegador y no coordenadas propias: el lienzo
 * tiene zoom, y el navegador ya resuelve qué hay debajo del puntero sin que
 * haya que convertir píxeles de pantalla a píxeles de CSS — la misma cuenta
 * que ya se equivocó una vez con las líneas del abanico.
 */
/**
 * El asa por la que se agarra una tarjeta.
 *
 * Va con eventos de puntero y NO con el arrastre nativo del navegador. Se
 * probó con el nativo y no arranca en este lienzo: entre el botón de la
 * cabecera, la captura de puntero del lienzo que se mueve y la escala CSS, el
 * `dragstart` no llega a dispararse con el mouse — disparado por código
 * andaba, que es lo que hizo creer que estaba listo.
 *
 * Con punteros no hay nada que negociar: se escucha en la ventana mientras
 * dura el gesto y se busca el hueco por posición. Las coordenadas del puntero
 * y las de `getBoundingClientRect` están las dos en píxeles de pantalla, así
 * que el zoom del lienzo no entra en la cuenta.
 */
function Asa({ onTake }: { onTake: () => void; cid?: string }) {
  const t = useT();
  const arrastre = useContext(DragContext);
  return (
    <span
      data-drag-handle
      onPointerDown={(e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        e.preventDefault();
        e.stopPropagation();
        onTake();
        arrastre.apuntar(e.clientX, e.clientY);
      }}
      aria-label={t('automations.dragHandle')}
      className="text-muted-foreground hover:text-foreground absolute top-0 left-2 z-10 flex h-[78px] w-5 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
    >
      <GripVertical className="h-4 w-4" aria-hidden />
    </span>
  );
}

interface Arrastre {
  cid: string;
  /** Para no dejar caer un paso dentro de sí mismo. */
  step: BuilderStep;
  /**
   * De dónde salió. Hay dos formas de vivir en el lienzo y no se mezclan:
   * los pasos del árbol se direccionan por camino, y los de los carriles de
   * una condición multi-camino por (carril, posición) dentro de esa tarjeta.
   *
   * Un hueco sólo acepta lo que sabe recibir. Cruzar de un mundo al otro no
   * se ofrece: es preferible que no haya dónde soltar a que la tarjeta
   * aparezca en un lugar que nadie pidió.
   */
  origen:
    | { kind: 'arbol'; path: StepPath }
    | { kind: 'carril'; owner: string; lane: string; index: number };
}
const DragContext = createContext<{
  arrastrando: Arrastre | null;
  tomar: (a: Arrastre | null) => void;
  /** Empieza el gesto en estas coordenadas de pantalla. */
  apuntar: (x: number, y: number) => void;
  /** Cada hueco se anota para poder encontrarlo por posición. */
  registrar: (
    id: string,
    fn: { current: (() => void) | undefined },
    etiqueta: { current: string | undefined }
  ) => void;
  olvidar: (id: string) => void;
  /** El hueco bajo el puntero ahora mismo. */
  activo: string | null;
}>({
  arrastrando: null,
  tomar: () => {},
  apuntar: () => {},
  registrar: () => {},
  olvidar: () => {},
  activo: null,
});

/** Friendly sample values for the inline template preview (so {{n}} renders a
 *  realistic value instead of a placeholder once mapped to a data point). */
const SAMPLE_BY_VAR: Record<string, string> = {
  customer_name: 'María',
  order_name: '#1042',
  order_number: '1042',
  total_price: '49.900',
  currency: 'ARS',
  offer_units: '3',
  offer_chosen: '3+1 gratis',
  item_count: '1',
  first_item: 'Serum Pilar',
  tracking_number: 'AR123456789',
  tracking_url: 'https://andreani.com/seguimiento',
  tracking_company: 'Andreani',
  order_status_url: 'https://pilar.co/pedido/1042',
  checkout_url: 'https://pilar.co/carrito',
  subtotal_price: '45.900',
  total_discounts: '4.000',
  financial_status: 'paid',
  fulfillment_status: 'fulfilled',
  shipping_address: 'Av. Corrientes 1234',
  shipping_city: 'Buenos Aires',
  shipping_province: 'CABA',
  shipping_zip: '1043',
  shipping_country: 'Argentina',
  contact_first_name: 'María',
  contact_last_name: 'González',
  contact_email: 'maria@correo.com',
  contact_phone: '+54 9 11 1234 5678',
  last_product: 'Serum Pilar',
};

// ------------------------------------------------------------
// Types (builder-local — mirror the flattened rows we POST)
// ------------------------------------------------------------

/** Builder-only step types: the real engine types + the `switch` sugar node
 *  that compiles to nested binary conditions on save (see switch-compile.ts). */
export type BuilderStepType = AutomationStepType | 'switch';

// El mapa de estilos por tipo de paso y el abanico de ramas viven en
// `lienzo-piezas.tsx`: el chat que opera la cuenta dibuja la misma
// automatización y tiene que dibujar las mismas tarjetas. Con una copia en cada
// lado se separaban el día que alguien tocara un color.

export interface BuilderStep {
  /** Client id; the API assigns real UUIDs server-side. */
  cid: string;
  /** Persisted automation_steps.id, kept only when loaded from the server so
   *  live "waiting" counts can be mapped onto wait nodes. Absent for new steps
   *  and dropped on the next save (steps are deleted + reinserted). */
  serverId?: string;
  step_type: BuilderStepType;
  step_config: Record<string, unknown>;
  branches?: { yes: BuilderStep[]; no: BuilderStep[] };
  /** Multi-case "Varios caminos según un dato" data — only on `switch` steps.
   *  Compiled to a nested binary-condition spine by toApiSteps; never reaches
   *  the wire. */
  switchData?: SwitchData<BuilderStep>;
}

export interface BuilderInitial {
  id?: string;
  name: string;
  description: string;
  trigger_type: AutomationTriggerType;
  trigger_config: Record<string, unknown>;
  audience_segment_id?: string | null;
  is_active: boolean;
  steps: BuilderStep[];
}

/**
 * El flujo entero como texto, para comparar contra lo último que se guardó.
 * Se listan los campos a mano —y no el objeto suelto— para que un dato que
 * el editor use de adorno no cuente como cambio sin guardar.
 */
function snapshot(s: BuilderInitial): string {
  return JSON.stringify({
    name: s.name,
    description: s.description ?? '',
    trigger_type: s.trigger_type,
    trigger_config: s.trigger_config ?? {},
    audience_segment_id: s.audience_segment_id ?? null,
    is_active: s.is_active,
    steps: s.steps,
  });
}

interface BuilderValidationIssue extends ValidationIssue {
  cid?: string;
  trigger?: boolean;
}

/** Validate before compiling the visual switch, preserving its card id. */
function firstBuilderStepIssue(
  steps: BuilderStep[]
): BuilderValidationIssue | null {
  for (const step of steps) {
    if (step.step_type === 'switch') {
      const data = step.switchData;
      if (!data || data.cases.length === 0) {
        return {
          cid: step.cid,
          path: 'steps.condition',
          message: 'condition subject is required',
          key: 'automations.issueSinDato',
        };
      }
      for (const item of data.cases) {
        const issue = validateStepsForActivation([
          { step_type: 'condition', step_config: item.cfg },
        ])[0];
        if (issue) return { ...issue, cid: step.cid };
        const nested = firstBuilderStepIssue(item.steps ?? []);
        if (nested) return nested;
      }
      const otherwise = firstBuilderStepIssue(data.elseSteps ?? []);
      if (otherwise) return otherwise;
      continue;
    }

    const issue = validateStepsForActivation([
      { step_type: step.step_type, step_config: step.step_config },
    ])[0];
    if (issue) return { ...issue, cid: step.cid };

    if (step.branches) {
      const yes = firstBuilderStepIssue(step.branches.yes);
      if (yes) return yes;
      const no = firstBuilderStepIssue(step.branches.no);
      if (no) return no;
    }
  }
  return null;
}

// ------------------------------------------------------------
// Step metadata — one source of truth for icon + label + border color
// ------------------------------------------------------------

// `send_message` se ofrece sólo como nota de voz. Meta no permite texto libre
// fuera de la ventana de 24 horas, pero este paso sólo permite configurar
// un audio reutilizable o generado con Fish.
// Webhook is for equipos que conectan Make, Zapier o n8n. No se propone por
// defecto en las plantillas, pero sí se ofrece cuando el comercio lo busca.
// `update_contact_field` is likewise NOT offered — it overwrites a core
// contact field (name/email/company) with a fixed value, which is rarely what
// a merchant wants and can clobber real data; tags already cover state. The
// type + editor stay so any legacy automation keeps loading + running it.
// `condition` (the old binary Sí/No) is NOT offered on its own: the `switch`
// node IS the unified "Condición" — one card that holds N filtered paths + an
// "en otro caso". A 1-path switch is exactly a Sí/No. The `condition` type +
// renderer stay so any legacy binary condition keeps loading + running; on the
// next load a flat one folds into the unified card (see collapseSwitch).
const ADDABLE_STEPS: BuilderStepType[] = [
  'send_message',
  'send_template',
  'send_webhook',
  'voice_call',
  'assign_conversation',
  'wait',
  'switch',
  'close_conversation',
  // Etiquetar al final: no aplica ninguna etiqueta por defecto — el usuario la
  // escribe (crea una nueva) o elige una existente en el editor del paso.
  'add_tag',
  'remove_tag',
];

// Steps offered INSIDE a switch case / "en otro caso" lane. Cases hold a flat
// list of actions only — no nested branching — so the switch card stays
// self-contained (edited via switchData, not the canvas path system). A
// merchant who needs logic inside a case uses a standalone "Condición" instead.
const LEAF_STEPS: BuilderStepType[] = [
  'send_message',
  'send_template',
  // La llamada es una acción más, sin ramas: no había motivo para que el menú
  // de un camino ofreciera menos que el del lienzo. Lo único que no se puede
  // meter acá es otra Condición.
  'voice_call',
  'assign_conversation',
  'wait',
  'close_conversation',
  'add_tag',
  'remove_tag',
];

function stepTitleKey(step: BuilderStep): string {
  return step.step_type === 'send_message' && step.step_config.voice_only
    ? 'automations.stepSendVoiceNote'
    : STEP_META[step.step_type].label;
}

// Selectable triggers are intentionally limited to Shopify events +
// "tag added". The other trigger types still exist in the engine/types
// (so any legacy automation keeps firing and renders its label via
// TRIGGER_META), they're just not offered when building a new one.
// `label` holds an i18n key, resolved with t() inside the trigger card.
const TRIGGER_OPTIONS: { value: AutomationTriggerType; label: string }[] = [
  // Conversación / contacto (los despacha el webhook de entrada). Antes solo
  // vivían en el fallback y no se ofrecían al crear — ahora seleccionables.
  { value: 'new_contact_created', label: 'automations.triggerNewContact' },
  { value: 'first_inbound_message', label: 'automations.triggerFirstInbound' },
  { value: 'new_message_received', label: 'automations.triggerNewMessage' },
  { value: 'keyword_match', label: 'automations.triggerKeywordMatch' },
  {
    value: 'conversation_assigned',
    label: 'automations.triggerConversationAssigned',
  },
  { value: 'tag_added', label: 'automations.triggerTagAdded' },
  {
    value: 'shopify_order_created',
    label: 'automations.triggerShopifyOrderCreated',
  },
  { value: 'shopify_order_paid', label: 'automations.triggerShopifyOrderPaid' },
  {
    value: 'shopify_order_fulfilled',
    label: 'automations.triggerShopifyOrderFulfilled',
  },
  {
    value: 'shopify_order_delivered',
    label: 'automations.triggerShopifyOrderDelivered',
  },
  {
    value: 'shopify_order_cancelled',
    label: 'automations.triggerShopifyOrderCancelled',
  },
  {
    value: 'shopify_order_refunded',
    label: 'automations.triggerShopifyOrderRefunded',
  },
  {
    value: 'shopify_abandoned_checkout',
    label: 'automations.triggerShopifyAbandonedCheckout',
  },
  { value: 'payment_rejected', label: 'automations.triggerPaymentRejected' },
  {
    value: 'voice_call_completed',
    label: 'automations.triggerVoiceCallCompleted',
  },
];

// Friendly labels for trigger types NOT in the selectable list (legacy /
// cron-driven). Without these, editing an existing automation with such a
// trigger showed the raw enum in the header and the dropdown fell back to the
// first option ("Tag added"), which read like the trigger had silently
// changed.
const TRIGGER_LABEL_FALLBACK: Record<string, string> = {
  post_delivery_feedback: 'automations.triggerPostDeliveryFeedback',
  customer_inactive: 'automations.triggerCustomerInactive',
  keyword_match: 'automations.triggerKeywordMatch',
  time_based: 'automations.triggerTimeBased',
  new_message_received: 'automations.triggerNewMessage',
  first_inbound_message: 'automations.triggerFirstInbound',
  new_contact_created: 'automations.triggerNewContact',
  conversation_assigned: 'automations.triggerConversationAssigned',
};

/** Friendly label for any trigger type, incl. legacy/non-selectable ones. */
function triggerLabel(type: AutomationTriggerType, t: TFn): string {
  const opt = TRIGGER_OPTIONS.find((o) => o.value === type);
  if (opt) return t(opt.label);
  const fb = TRIGGER_LABEL_FALLBACK[type];
  return fb ? t(fb) : type;
}

/**
 * Segunda línea de la tarjeta del disparador: qué configuración tiene, igual
 * que la tarjeta de acción muestra el nombre de la plantilla. Devuelve null
 * para los disparadores que no configuran nada.
 */
function triggerSummary(
  type: AutomationTriggerType,
  config: Record<string, unknown>
): string | null {
  if (type === 'keyword_match') {
    const words = Array.isArray(config?.keywords)
      ? (config.keywords as string[])
      : [];
    return words.length ? words.join(', ') : null;
  }
  return null;
}

/**
 * Sub-bar between the header and the canvas. Lets the user scope the
 * whole automation to a saved segment — the engine will skip firing
 * for contacts that don't currently match.
 */
/**
 * Condition step body. Lives in its own component so it can pull the
 * saved-segment list from SegmentsContext (the `in_segment` subject
 * needs a real dropdown, not a free-text segment-id field).
 */
// Natural-language operators per value kind. `op` maps to the engine's
// ConditionStepConfig.op (numeric-coercing). `eq` is string equality.
const NUMBER_OPS: { op: string; key: string }[] = [
  { op: 'eq', key: 'automations.opEq' },
  { op: 'gte', key: 'automations.opGte' },
  { op: 'lte', key: 'automations.opLte' },
  { op: 'gt', key: 'automations.opGt' },
  { op: 'lt', key: 'automations.opLt' },
  { op: 'between', key: 'automations.opBetween' },
];

const GROUP_LABEL: Record<string, string> = {
  order: 'automations.dpGroupOrder',
  contact: 'automations.dpGroupContact',
  message: 'automations.dpGroupMessage',
};

// El mapeo dato → condición ya NO vive acá: se mudó a
// `src/lib/automations/condition-config.ts` para que el Operador entre por la
// misma puerta. Escribiendo el `subject` a mano llegó a guardar uno que no
// existe, y la automatización contestaba que no para siempre. Importarlo desde
// los dos lados es lo que hace que no puedan volver a divergir.

function ConditionFields({
  cfg,
  set,
}: {
  cfg: Record<string, unknown>;
  set: (patch: Record<string, unknown>) => void;
}) {
  const t = useT();
  const trigger = useContext(TriggerContext);
  const segments = useContext(SegmentsContext);
  const offers = useContext(OffersContext);
  const products = useContext(ProductsContext);
  const hasVoiceCall = useContext(HasVoiceCallContext);
  const subject = cfg.subject as string | undefined;
  const operand = cfg.operand as string | undefined;
  const dps = conditionDataPoints(trigger, { hasVoiceCall });
  const currentId = datoDeCfg(subject, operand, dps);
  const dp =
    currentId && currentId !== TIME_DP_ID
      ? dataPointById(currentId)
      : undefined;
  const groups = ['order', 'contact', 'message'].filter((g) =>
    dps.some((d) => d.group === g)
  );

  function pick(id: string) {
    if (id === TIME_DP_ID) {
      set({
        subject: 'time_of_day',
        operand: '',
        value: '',
        op: undefined,
        value2: undefined,
      });
      return;
    }
    const d = dataPointById(id);
    if (d) set(cfgDeDato(d));
  }

  return (
    <>
      <FieldBlock label={t('automations.condWhatData')}>
        <select
          value={currentId ?? ''}
          onChange={(e) => pick(e.target.value)}
          className="border-border bg-muted text-foreground w-full rounded-md border px-2 py-1.5 text-sm"
        >
          <option value="">{t('automations.chooseData')}</option>
          {groups.map((g) => (
            <optgroup key={g} label={t(GROUP_LABEL[g])}>
              {dps
                .filter((d) => d.group === g)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {t(d.labelKey)}
                  </option>
                ))}
            </optgroup>
          ))}
          <option value={TIME_DP_ID}>{t('automations.dpTimeOfDay')}</option>
        </select>
      </FieldBlock>

      {subject === 'time_of_day' && (
        <FieldBlock label={t('automations.betweenTheseHours')}>
          <Input
            value={operand ?? ''}
            onChange={(e) => set({ operand: e.target.value })}
            placeholder="09:00-18:00"
            className="bg-muted text-foreground"
          />
        </FieldBlock>
      )}

      {dp && dp.condition.kind === 'tag' && (
        <FieldBlock label={t('automations.dpHasTag')}>
          <TagSelect
            value={operand ?? ''}
            onChange={(v) => set({ operand: v })}
          />
        </FieldBlock>
      )}

      {dp && dp.condition.kind === 'segment' && (
        <FieldBlock label={t('automations.dpInSegment')}>
          <select
            value={operand ?? ''}
            onChange={(e) => set({ operand: e.target.value })}
            className="border-border bg-muted text-foreground w-full rounded-md border px-2 py-1.5 text-sm"
          >
            <option value="">{t('automations.chooseSegment')}</option>
            {segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </FieldBlock>
      )}

      {dp && dp.condition.kind === 'message' && (
        <FieldBlock label={t('automations.messageContains')}>
          <Input
            value={(cfg.value as string) ?? ''}
            onChange={(e) =>
              set({ value: e.target.value, operand: e.target.value })
            }
            placeholder={t('automations.messageContainsPlaceholder')}
            className="bg-muted text-foreground"
          />
        </FieldBlock>
      )}

      {dp &&
        (dp.condition.kind === 'purchased' ||
          dp.condition.kind === 'messaged' ||
          dp.condition.kind === 'rejected_open') && (
          <PurchasedFields cfg={cfg} set={set} kind={dp.condition.kind} />
        )}

      {/* "Pagó el pedido" no lleva ventana: pregunta por el pedido de ESTE
          flujo, no por un plazo. Sólo el lado. */}
      {dp && dp.condition.kind === 'order_paid' && (
        <FieldBlock label={t('automations.condValueLabel')}>
          <select
            value={String(cfg.value ?? 'false')}
            onChange={(e) => set({ value: e.target.value })}
            className="border-border bg-muted text-foreground w-full rounded-md border px-2 py-1.5 text-sm focus:outline-none"
          >
            <option value="false">{t(SIDE_LABEL.order_paid.no)}</option>
            <option value="true">{t(SIDE_LABEL.order_paid.yes)}</option>
          </select>
        </FieldBlock>
      )}

      {dp &&
        (dp.condition.kind === 'var' ||
          dp.condition.kind === 'contact_field') && (
          <ConditionValue
            dp={dp}
            cfg={cfg}
            set={set}
            offers={offers}
            products={products}
          />
        )}
    </>
  );
}

/**
 * Cómo se nombra cada lado de las condiciones de sí/no con ventana. Es un
 * mapa y no un encadenado de ternarios porque son tres y van a ser más.
 */
const SIDE_LABEL = {
  purchased: { no: 'automations.purchasedNo', yes: 'automations.purchasedYes' },
  messaged: { no: 'automations.messagedNo', yes: 'automations.messagedYes' },
  rejected_open: {
    no: 'automations.rejectedOpenNo',
    yes: 'automations.rejectedOpenYes',
  },
  order_paid: {
    no: 'automations.orderPaidNo',
    yes: 'automations.orderPaidYes',
  },
} as const;

/**
 * Controles de la condición "Compró": ventana y lado.
 *
 * La ventana se guarda como "3h" / "7d" — la misma gramática corta que usa
 * el resto de los pasos que miran hacia atrás, así que un flujo se lee igual
 * sin importar quién lo armó.
 */
function PurchasedFields({
  cfg,
  set,
  kind,
}: {
  cfg: Record<string, unknown>;
  set: (patch: Record<string, unknown>) => void;
  kind: 'purchased' | 'messaged' | 'rejected_open';
}) {
  const t = useT();
  const since = String(cfg.operand ?? 'since_trigger');
  const ever = since === 'ever';
  const m = /^(\d+)([mhd])$/.exec(String(cfg.operand ?? '24h')) ?? [
    '',
    '24',
    'h',
  ];
  const amount = Number(m[1]) > 0 ? Number(m[1]) : 24;
  const unit =
    since === 'since_trigger'
      ? 'since_trigger'
      : ever
        ? 'ever'
        : m[2] === 'm' || m[2] === 'd'
          ? m[2]
          : 'h';
  const setWindow = (a: number, u: string) =>
    set({ operand: `${Math.max(1, a)}${u}` });

  return (
    <div className="space-y-2">
      <FieldBlock label={t('automations.condWhenLabel')}>
        <div className="flex gap-2">
          {/* El número sólo aparece con una duración. Con "desde que empezó"
              o "alguna vez" no hay nada que contar, y dejarlo en pantalla
              —aunque estuviera deshabilitado— se leía "en las últimas 24
              desde que empezó". */}
          {unit !== 'since_trigger' && unit !== 'ever' && (
            <Input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setWindow(Number(e.target.value), unit)}
              className="bg-muted text-foreground w-20"
            />
          )}
          <select
            value={unit}
            onChange={(e) =>
              e.target.value === 'ever' || e.target.value === 'since_trigger'
                ? set({ operand: e.target.value })
                : setWindow(amount, e.target.value)
            }
            className="border-border bg-muted text-foreground flex-1 rounded-md border px-2 py-1.5 text-sm focus:outline-none"
          >
            <option value="since_trigger">
              {t('automations.windowSinceTrigger')}
            </option>
            <option value="m">{t('automations.windowLastMinutes')}</option>
            <option value="h">{t('automations.windowLastHours')}</option>
            <option value="d">{t('automations.windowLastDays')}</option>
            <option value="ever">{t('automations.windowEver')}</option>
          </select>
        </div>
      </FieldBlock>
      <FieldBlock label={t('automations.condValueLabel')}>
        <select
          value={String(cfg.value ?? 'false')}
          onChange={(e) => set({ value: e.target.value })}
          className="border-border bg-muted text-foreground w-full rounded-md border px-2 py-1.5 text-sm focus:outline-none"
        >
          <option value="false">{t(SIDE_LABEL[kind].no)}</option>
          <option value="true">{t(SIDE_LABEL[kind].yes)}</option>
        </select>
      </FieldBlock>
    </div>
  );
}

/** Operator + value control for a var / contact_field data point, shaped by
 *  the data point's value kind (number → operator+number(s); offer → dropdown;
 *  bool → sí/no; text → equals). */
function ConditionValue({
  dp,
  cfg,
  set,
  offers,
  products,
}: {
  dp: DataPoint;
  cfg: Record<string, unknown>;
  set: (patch: Record<string, unknown>) => void;
  offers: string[];
  products: string[];
}) {
  const t = useT();
  const op = (cfg.op as string) ?? 'eq';
  const value = (cfg.value as string) ?? '';
  const selectCls =
    'w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground';

  if (dp.valueKind === 'bool') {
    return (
      <FieldBlock label={t('automations.whenItIs')}>
        <select
          value={value || 'true'}
          onChange={(e) => set({ op: 'eq', value: e.target.value })}
          className={selectCls}
        >
          <option value="true">{t('automations.repeatCustomerYes')}</option>
          <option value="false">{t('automations.repeatCustomerNo')}</option>
        </select>
      </FieldBlock>
    );
  }

  // Valores cerrados (cómo salió la llamada): se elige de la lista en vez de
  // tipear el nombre interno del estado.
  if (dp.valueKind === 'enum') {
    return (
      <FieldBlock label={t('automations.whenItIs')}>
        <select
          value={value}
          onChange={(e) => set({ op: 'eq', value: e.target.value })}
          className={selectCls}
        >
          <option value="">{t('automations.chooseValue')}</option>
          {(dp.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.labelKey)}
            </option>
          ))}
        </select>
      </FieldBlock>
    );
  }

  if (dp.valueKind === 'offer') {
    return (
      <FieldBlock label={t('automations.whichOffer')}>
        {offers.length > 0 ? (
          <select
            value={value}
            onChange={(e) => set({ op: 'eq', value: e.target.value })}
            className={selectCls}
          >
            <option value="">{t('automations.chooseOffer')}</option>
            {offers.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : (
          <>
            <Input
              value={value}
              onChange={(e) => set({ op: 'eq', value: e.target.value })}
              className="bg-muted text-foreground"
            />
            <p className="text-muted-foreground mt-1 text-[11px]">
              {t('automations.offerChosenNoOffersHint')}
            </p>
          </>
        )}
      </FieldBlock>
    );
  }

  if (dp.valueKind === 'product') {
    return (
      <FieldBlock label={t('automations.whichProduct')}>
        {products.length > 0 ? (
          <select
            value={value}
            onChange={(e) => set({ op: 'eq', value: e.target.value })}
            className={selectCls}
          >
            <option value="">{t('automations.chooseProduct')}</option>
            {products.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        ) : (
          <>
            <Input
              value={value}
              onChange={(e) => set({ op: 'eq', value: e.target.value })}
              className="bg-muted text-foreground"
            />
            <p className="text-muted-foreground mt-1 text-[11px]">
              {t('automations.productNoProductsHint')}
            </p>
          </>
        )}
      </FieldBlock>
    );
  }

  if (dp.valueKind === 'number') {
    return (
      <FieldBlock label={t('automations.condCompare')}>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={op}
            onChange={(e) => set({ op: e.target.value, value2: undefined })}
            className="border-border bg-muted text-foreground h-9 rounded-md border px-2 text-sm"
          >
            {NUMBER_OPS.map((o) => (
              <option key={o.op} value={o.op}>
                {t(o.key)}
              </option>
            ))}
          </select>
          <Input
            type="number"
            value={value}
            onChange={(e) => set({ value: e.target.value })}
            className="bg-muted text-foreground h-9 w-24"
          />
          {op === 'between' && (
            <>
              <span className="text-muted-foreground text-xs">
                {t('automations.condAnd')}
              </span>
              <Input
                type="number"
                value={(cfg.value2 as string) ?? ''}
                onChange={(e) => set({ value2: e.target.value })}
                className="bg-muted text-foreground h-9 w-24"
              />
            </>
          )}
        </div>
      </FieldBlock>
    );
  }

  // text → equals
  return (
    <FieldBlock label={t('automations.opEq')}>
      <Input
        value={value}
        onChange={(e) => set({ op: 'eq', value: e.target.value })}
        className="bg-muted text-foreground"
      />
    </FieldBlock>
  );
}

/** Tag dropdown — name in the menu, tag id in the value. Used anywhere a
 *  step or condition needs to point at a tag without the user knowing it
 *  has an id at all. */
function TagSelect({
  value,
  onChange,
  allowCreate = false,
}: {
  value: string;
  onChange: (v: string) => void;
  /** When true, the user can TYPE a new tag (created on commit) or pick an
   *  existing one — for add_tag/remove_tag. Off = select-only (conditions). */
  allowCreate?: boolean;
}) {
  const t = useT();
  const tags = useContext(TagsContext);
  const addTag = useContext(TagsMutateContext);
  const fetchWithCsrf = useFetchWithCsrf();
  const listId = useId();
  const [text, setText] = useState(
    () => tags.find((x) => x.id === value)?.name ?? ''
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setText(tags.find((x) => x.id === value)?.name ?? '');
  }, [value, tags]);

  // Select-only (conditions / triggers): pick from existing tags.
  if (!allowCreate) {
    if (tags.length === 0) {
      return (
        <p className="border-border bg-muted/40 text-muted-foreground rounded-md border border-dashed px-3 py-2 text-xs">
          {t('automations.noTagsYet')}{' '}
          <Link
            href="/contactos?tab=tags"
            className="text-accent-ink underline hover:opacity-80"
          >
            {t('automations.createOne')}
          </Link>
          .
        </p>
      );
    }
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border-border bg-muted text-foreground focus:border-primary w-full rounded-md border px-2 py-1.5 text-sm focus:outline-none"
      >
        <option value="">{t('automations.chooseTag')}</option>
        {tags.map((tag) => (
          <option key={tag.id} value={tag.id}>
            {tag.name}
          </option>
        ))}
      </select>
    );
  }

  // Write-or-pick: type a new tag (created on commit) or choose an existing one.
  async function commit() {
    const name = text.trim();
    if (!name) {
      onChange('');
      return;
    }
    const existing = tags.find(
      (x) => x.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      onChange(existing.id);
      setText(existing.name);
      return;
    }
    setBusy(true);
    try {
      const res = await fetchWithCsrf('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.tag?.id) {
        addTag?.(j.tag as ContactTag);
        onChange(j.tag.id as string);
        setText(j.tag.name as string);
      }
    } catch {
      /* silencioso — el texto queda para reintentar */
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input
        list={listId}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        placeholder={t('automations.tagWriteOrPick')}
        disabled={busy}
        className="border-border bg-muted text-foreground focus:border-primary w-full rounded-md border px-2 py-1.5 text-sm focus:outline-none"
      />
      <datalist id={listId}>
        {tags.map((tag) => (
          <option key={tag.id} value={tag.name} />
        ))}
      </datalist>
    </>
  );
}

/** Team-member dropdown — full name in the menu, user id in the value. */
function AgentSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useT();
  const agents = useContext(AgentsContext);
  if (agents.length === 0) {
    return (
      <p className="border-border bg-muted/40 text-muted-foreground rounded-md border border-dashed px-3 py-2 text-xs">
        {t('automations.noTeammatesYet')}{' '}
        <Link
          href="/ajustes"
          className="text-accent-ink underline hover:opacity-80"
        >
          {t('automations.inviteSomeone')}
        </Link>
        .
      </p>
    );
  }
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border-border bg-muted text-foreground focus:border-primary w-full rounded-md border px-2 py-1.5 text-sm focus:outline-none"
    >
      <option value="">{t('automations.chooseSomeone')}</option>
      {agents.map((a) => (
        <option key={a.user_id} value={a.user_id}>
          {a.full_name || a.email}
        </option>
      ))}
    </select>
  );
}

function cid(): string {
  return (
    'c_' +
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36))
  );
}

function blankConfig(type: BuilderStepType): Record<string, unknown> {
  switch (type) {
    case 'switch':
      return {}; // dpId + cases live on step.switchData (set in addStepAt)
    case 'send_message':
      return { voice_note: null, voice_only: false };
    case 'send_template':
      return { template_name: '', language: 'en_US' };
    case 'add_tag':
    case 'remove_tag':
      return { tag_id: '' };
    case 'assign_conversation':
      return { mode: 'round_robin' };
    case 'update_contact_field':
      return { field: 'name', value: '' };
    case 'wait':
      return { amount: 1, unit: 'hours' };
    case 'condition':
      return {}; // unconfigured → the picker shows "¿Qué dato querés revisar?"
    case 'send_webhook':
      return { url: '', headers: {}, body_template: '' };
    case 'close_conversation':
      return {};
    case 'voice_call':
      // Ya no se escribe `wait_for_result`: esperar el resultado dejó de ser
      // una opción. Sólo un nodo viejo con `false` guardado sigue sin esperar.
      return { agent_id: '', scenario: '', objective_override: '' };
    default:
      return {};
  }
}

// ------------------------------------------------------------
// Main builder component
// ------------------------------------------------------------

export function AutomationBuilder({
  initial,
  templatePreview = false,
}: {
  initial: BuilderInitial;
  /** True when opened from a gallery card to preview a template (unsaved).
   *  Swaps the primary CTA to "Usar plantilla" and shows a hint banner. */
  templatePreview?: boolean;
}) {
  const t = useT();
  const router = useLocalizedRouter();
  const fetchWithCsrf = useFetchWithCsrf();
  const { workspace } = useWorkspace();
  const connections = useActiveConnections();
  // Automations send only through WhatsApp; surface which number runs them
  // and warn right in the canvas when none is connected.
  const whatsappConnected = connections.channels.has('whatsapp');
  const isEditing = !!initial.id;
  // Historial para deshacer/rehacer. Guarda el estado ENTERO en cada cambio:
  // el flujo son unos pocos pasos, así que copiarlo es barato y evita tener
  // que describir cada mutación como una operación inversa — que es donde
  // este tipo de historial se rompe.
  const [past, setPast] = useState<BuilderInitial[]>([]);
  const [future, setFuture] = useState<BuilderInitial[]>([]);
  const [state, setStateRaw] = useState<BuilderInitial>(initial);
  const setState = useCallback(
    (updater: (s: BuilderInitial) => BuilderInitial) => {
      setStateRaw((s) => {
        const next = updater(s);
        if (next === s) return s;
        setPast((p) => [...p.slice(-49), s]);
        setFuture([]);
        return next;
      });
    },
    []
  );
  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1];
      setStateRaw((cur) => {
        setFuture((f) => [cur, ...f.slice(0, 49)]);
        return prev;
      });
      return p.slice(0, -1);
    });
  }, []);
  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[0];
      setStateRaw((cur) => {
        setPast((p) => [...p.slice(-49), cur]);
        return next;
      });
      return f.slice(1);
    });
  }, []);
  const [saving, setSaving] = useState(false);
  // Lo guardado hasta ahora, como texto, para saber si quedó algo sin
  // guardar. El editor no guarda solo: se compara contra esta foto y si
  // difiere, salir pregunta antes de tirar el trabajo.
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshot(initial));
  const dirty = !templatePreview && snapshot(state) !== savedSnapshot;
  // Adónde ir cuando la persona confirme que quiere salir.
  const [leavingTo, setLeavingTo] = useState<string | null>(null);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Sin aviso del navegador. El de Chrome no se puede redactar ni traducir
  // —"¿Salir del sitio? Es posible que los cambios no se guarden"— y salía
  // ENCIMA del nuestro, así que había que contestar dos veces la misma
  // pregunta, la segunda peor escrita. Manda el diálogo de Riverz, que
  // además ofrece guardar en vez de sólo advertir.

  /** Salir a `href`, preguntando primero si hay cambios sin guardar. */
  const leave = useCallback(
    (href: string) => {
      if (dirtyRef.current) setLeavingTo(href);
      else router.push(href);
    },
    [router]
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [invalidCid, setInvalidCid] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{
    cid: string;
    sequence: number;
  } | null>(null);
  // Plataformas de tienda conectadas. Sirven para ofrecer el filtro por
  // plataforma sólo a quien tiene más de una: para el resto es una pregunta
  // sin respuesta posible.
  const [storePlatforms, setStorePlatforms] = useState<string[]>([]);
  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const res = await fetch('/api/stores/platforms', { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as { platforms?: string[] };
        if (vivo && Array.isArray(json.platforms))
          setStorePlatforms(json.platforms);
      } catch {
        /* silencioso: sin la lista simplemente no se ofrece el filtro */
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);
  const [arrastrando, tomar] = useState<Arrastre | null>(null);
  const [activo, setActivo] = useState<string | null>(null);
  // Los huecos, anotados con su acción. Es un ref y no estado porque cambia
  // en cada pintada y no hay nada que redibujar cuando cambia.
  const huecos = useRef(
    new Map<
      string,
      {
        fn: { current: (() => void) | undefined };
        etiqueta: { current: string | undefined };
      }
    >()
  );

  const registrar = useCallback(
    (
      id: string,
      fn: { current: (() => void) | undefined },
      etiqueta: { current: string | undefined }
    ) => {
      huecos.current.set(id, { fn, etiqueta });
    },
    []
  );
  const olvidar = useCallback((id: string) => {
    huecos.current.delete(id);
  }, []);

  /**
   * Qué hueco está bajo el puntero.
   *
   * No se exige puntería: si no hay ninguno exactamente debajo, gana el más
   * cercano dentro de un radio. Con las tarjetas a 40% de zoom, pedir el
   * píxel exacto es pedir demasiado.
   */
  const huecoEn = useCallback((x: number, y: number): string | null => {
    let mejor: { id: string; d: number } | null = null;
    for (const id of huecos.current.keys()) {
      const el = document.querySelector(`[data-drop-slot="${id}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const dentro = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = dentro ? 0 : Math.hypot(x - cx, y - cy);
      if (d > 160) continue;
      if (!mejor || d < mejor.d) mejor = { id, d };
    }
    return mejor?.id ?? null;
  }, []);

  // Dónde está el puntero: lo sigue la tarjeta fantasma.
  const [puntero, setPuntero] = useState<{ x: number; y: number } | null>(null);

  const apuntar = useCallback(
    (x: number, y: number) => {
      setPuntero({ x, y });
      setActivo(huecoEn(x, y));
    },
    [huecoEn]
  );

  // Mientras dura el gesto se escucha en la ventana: el puntero se va a ir
  // de la tarjeta enseguida, y si sólo escuchara el elemento de origen el
  // arrastre se cortaría al primer movimiento.
  useEffect(() => {
    if (!arrastrando) return;
    const mover = (e: PointerEvent) => {
      setPuntero({ x: e.clientX, y: e.clientY });
      setActivo(huecoEn(e.clientX, e.clientY));
    };
    const soltar = (e: PointerEvent) => {
      const id = huecoEn(e.clientX, e.clientY);
      huecos.current.get(id ?? '')?.fn.current?.();
      tomar(null);
      setActivo(null);
      setPuntero(null);
    };
    const cancelar = () => {
      tomar(null);
      setActivo(null);
      setPuntero(null);
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', cancelar);
    // Escapar suelta sin mover: un gesto empezado sin querer no tiene por qué
    // terminar cambiando el flujo.
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelar();
    };
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      window.removeEventListener('pointercancel', cancelar);
      window.removeEventListener('keydown', escape);
    };
  }, [arrastrando, huecoEn]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [segments, setSegments] = useState<ContactSegment[]>([]);
  const [tags, setTags] = useState<ContactTag[]>([]);
  const [agents, setAgents] = useState<Profile[]>([]);
  const [offers, setOffers] = useState<string[]>([]);
  const [products, setProducts] = useState<string[]>([]);
  // Live "how many are parked here right now" per wait step, keyed by the
  // persisted step id. Only fetched when editing a saved automation.
  const [waitingCounts, setWaitingCounts] = useState<Record<string, number>>(
    {}
  );

  // Load the user's templates once — powers the send_template picker and
  // the live phone preview. Approved first so the dropdown is useful.
  // Segments load alongside so the audience filter dropdown is populated
  // without a separate round-trip per render.
  useEffect(() => {
    const supabase = createClient();
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const [
        { data: tpl },
        { data: seg },
        { data: tg },
        { data: ag },
        { data: prods },
        { data: checkoutCfg },
      ] = await Promise.all([
        supabase
          .from('message_templates')
          .select('*')
          .eq('user_id', user.id)
          .order('status', { ascending: true })
          .order('name', { ascending: true }),
        supabase
          .from('contact_segments')
          .select('*')
          .order('name', { ascending: true }),
        // Tags + team members are RLS-scoped to the user's workspace,
        // so a plain select returns only what they're allowed to pick.
        supabase.from('tags').select('*').order('name', { ascending: true }),
        supabase
          .from('profiles')
          .select('*')
          .order('full_name', { ascending: true }),
        // Offers: per-product allowed_offers + the assistant checkout
        // config. Both RLS-scoped to the workspace. Powers the
        // `offer_chosen` condition dropdown. `title` alimenta el dropdown
        // de la condición `last_product`.
        supabase.from('shopify_products').select('title, allowed_offers'),
        supabase
          .from('workspace_checkout_config')
          .select('offers')
          .maybeSingle(),
      ]);
      setTemplates((tpl as MessageTemplate[]) ?? []);
      setSegments((seg as ContactSegment[]) ?? []);
      setTags((tg as ContactTag[]) ?? []);
      setAgents((ag as Profile[]) ?? []);

      // Flatten + dedupe offer labels de ambas fuentes. Dedupe por clave
      // NORMALIZADA (trim + minúsculas) para que "1 unidad"/"1 Unidad" y
      // "2 unidades + 1 gratis"/"2 Unidades + 1 GRATIS" no salgan repetidas —
      // el auto-detect del sitio guarda el casing de la página y el manual suele
      // ir en minúsculas. Se conserva una etiqueta canónica (la primera vista).
      const byKey = new Map<string, string>();
      const addLabel = (raw: unknown) => {
        const label = String(raw ?? '').trim();
        if (!label) return;
        const key = label.toLowerCase();
        if (!byKey.has(key)) byKey.set(key, label);
      };
      type OfferRow = { label?: unknown };
      for (const row of (prods as { allowed_offers?: unknown }[] | null) ??
        []) {
        const list = Array.isArray(row?.allowed_offers)
          ? row.allowed_offers
          : [];
        for (const o of list as OfferRow[]) {
          addLabel(typeof o === 'string' ? o : o?.label);
        }
      }
      const cfgOffers = (checkoutCfg as { offers?: unknown } | null)?.offers;
      for (const o of (Array.isArray(cfgOffers)
        ? cfgOffers
        : []) as OfferRow[]) {
        addLabel(o?.label);
      }
      setOffers([...byKey.values()].sort((a, b) => a.localeCompare(b)));

      // Títulos de productos (sincronizados de Shopify) para el dropdown de la
      // condición `last_product`. Dedupe + orden alfabético.
      const titles = new Set<string>();
      for (const row of (prods as { title?: unknown }[] | null) ?? []) {
        const title = String(row?.title ?? '').trim();
        if (title) titles.add(title);
      }
      setProducts([...titles].sort((a, b) => a.localeCompare(b)));
    })();
  }, []);

  // Live "waiting here now" counts per wait step. Only meaningful for a saved
  // automation; the map is keyed by the persisted step id (serverId on each
  // loaded node). Pending executions are service-role only, so this goes
  // through a dedicated endpoint.
  useEffect(() => {
    if (!initial.id) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/automations/${initial.id}/waiting`);
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled && body?.counts)
          setWaitingCounts(body.counts as Record<string, number>);
      } catch {
        // Non-critical overlay — a failed fetch just leaves the badges hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initial.id]);

  function patchTop<K extends keyof BuilderInitial>(
    key: K,
    value: BuilderInitial[K]
  ) {
    setState((s) => ({ ...s, [key]: value }));
  }

  // --- Step tree mutations (immutable) ---

  function updateStep(
    path: StepPath,
    updater: (s: BuilderStep) => BuilderStep
  ) {
    setState((s) => ({ ...s, steps: mapAtPath(s.steps, path, updater) }));
  }

  function addStepAt(
    parent: ParentScope,
    index: number,
    type: BuilderStepType,
    initialConfig?: Record<string, unknown>
  ) {
    const node: BuilderStep = {
      cid: cid(),
      step_type: type,
      step_config: { ...blankConfig(type), ...initialConfig },
      branches: type === 'condition' ? { yes: [], no: [] } : undefined,
      // Start the unified "Condición" with one empty path so the if/else shape
      // is visible immediately; the user fills its filter, adds more, or leaves
      // just the "en otro caso".
      switchData:
        type === 'switch'
          ? {
              dpId: undefined,
              cases: [{ ckey: cid(), cfg: {}, steps: [] }],
              elseSteps: [],
            }
          : undefined,
    };
    setState((s) => ({ ...s, steps: insertAt(s.steps, parent, index, node) }));
    setExpandedId(node.cid);
  }

  /**
   * Arma la bifurcación por el resultado justo después de la llamada.
   *
   * No se usa `addStepAt` porque ese crea un nodo en blanco y acá hace falta
   * uno ya apuntado al dato del resultado: elegirlo a mano es exactamente el
   * paso que nadie iba a dar. Se busca por `cid` y no por ruta porque la
   * tarjeta de la llamada sólo se conoce a sí misma — sirve igual en el
   * tronco que dentro de un camino.
   */
  function armarRamaLlamada(cidLlamada: string) {
    const nodo = ramaSiNoContesta(cid);
    setState((s) => ({
      ...s,
      steps: mapListas(s.steps, (lista) => {
        const i = lista.findIndex((x) => x.cid === cidLlamada);
        if (i < 0) return lista;
        // Ya la tiene: no se duplica.
        if (esRamaDeLlamada(lista[i + 1] ?? null)) return lista;
        return [...lista.slice(0, i + 1), nodo, ...lista.slice(i + 1)];
      }),
    }));
    setExpandedId(nodo.cid);
  }

  function deleteStepAt(path: StepPath) {
    setState((s) => ({ ...s, steps: removeAt(s.steps, path) }));
  }

  function moveStepAt(path: StepPath, direction: -1 | 1) {
    setState((s) => ({ ...s, steps: moveAt(s.steps, path, direction) }));
  }

  /**
   * Mover un paso a otro lugar del flujo, arrastrándolo.
   *
   * Se saca de donde estaba y se pone donde lo soltaron. El orden importa:
   * si sale antes de un hueco del MISMO carril, todo lo que venía después
   * corre un lugar, así que el índice de destino hay que corregirlo o el
   * paso aterriza uno más allá del hueco que se marcó.
   */
  function moveStepTo(from: StepPath, destino: ParentScope, index: number) {
    setState((s) => {
      const nodo = getAt(s.steps, from);
      if (!nodo) return s;
      // Un paso no puede caer dentro de sí mismo: se llevaría su propio
      // destino y el árbol quedaría partido.
      if (destino.kind === 'branch' && contieneCid(nodo, destino.parentCid))
        return s;

      const origen = from[from.length - 1];
      const mismoCarril =
        origen &&
        (destino.kind === 'root'
          ? origen.kind === 'root'
          : origen.kind === 'branch' &&
            origen.parentCid === destino.parentCid &&
            origen.branch === destino.branch);
      const corregido = mismoCarril && origen.index < index ? index - 1 : index;

      const sinEl = removeAt(s.steps, from);
      return { ...s, steps: insertAt(sinEl, destino, corregido, nodo) };
    });
  }

  async function save(): Promise<boolean> {
    const triggerIssue = validateTriggerForActivation(
      state.trigger_type,
      state.trigger_config
    )[0];
    const stepIssue =
      state.steps.length === 0
        ? validateStepsForActivation([])[0]
        : firstBuilderStepIssue(state.steps);
    const firstIssue: BuilderValidationIssue | undefined = triggerIssue
      ? { ...triggerIssue, trigger: true }
      : (stepIssue ?? undefined);

    if (firstIssue) {
      const target = firstIssue.trigger
        ? '__trigger__'
        : (firstIssue.cid ?? null);
      setInvalidCid(target);
      if (target) {
        if (target !== '__trigger__') setExpandedId(target);
        setFocusRequest((previous) => ({
          cid: target,
          sequence: (previous?.sequence ?? 0) + 1,
        }));
      }
      toast.error(
        firstIssue.key ? t(firstIssue.key) : firstIssue.message,
        target
          ? { description: t('automations.fixHighlightedStep') }
          : undefined
      );
      return false;
    }

    setInvalidCid(null);
    setSaving(true);
    try {
      const payload = {
        name: state.name || t('automations.untitledAutomation'),
        description: state.description || null,
        trigger_type: state.trigger_type,
        trigger_config: state.trigger_config,
        audience_segment_id: state.audience_segment_id ?? null,
        is_active: state.is_active,
        steps: toApiSteps(state.steps),
        // Crear en el workspace ACTIVO (el que muestra la lista), no en el
        // primario: con varias cuentas, la automatización se creaba en otro
        // workspace y no aparecía en "Mis automatizaciones".
        workspace_id: isEditing ? undefined : workspace?.id,
      };

      const res = isEditing
        ? await fetchWithCsrf(`/api/automations/${initial.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetchWithCsrf(`/api/automations`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // If the server blocked activation with validation issues,
        // surface the first concrete problem so the user can fix it
        // without opening DevTools for the full array.
        const firstIssue:
          | { path?: string; message?: string; key?: string }
          | undefined = body?.issues?.[0];
        if (firstIssue?.message) {
          // En su idioma. El `message` está en inglés y escrito para quien
          // programó el validador: «active automations need at least one step».
          toast.error(firstIssue.key ? t(firstIssue.key) : firstIssue.message, {
            description: firstIssue.path ? `en ${firstIssue.path}` : undefined,
          });
        } else {
          toast.error(body?.error ?? t('automations.saveFailed'));
        }
        return false;
      }
      toast.success(
        isEditing
          ? t('automations.toastSaved')
          : templatePreview
            ? t('automations.toastTemplateAdded')
            : t('automations.toastCreated')
      );
      // Desde acá, lo que hay en pantalla es lo guardado: salir ya no
      // pregunta nada.
      setSavedSnapshot(snapshot(state));
      if (!isEditing && body?.automation?.id) {
        router.replace(`/automatizaciones/${body.automation.id}/editar`);
      }
      return true;
    } finally {
      setSaving(false);
    }
  }

  return (
    <TriggerContext.Provider value={state.trigger_type}>
      <HasVoiceCallContext.Provider value={treeHasVoiceCall(state.steps)}>
        <RamaLlamadaContext.Provider
          value={{
            yaTiene: (c) => esRamaDeLlamada(vecinoSiguiente(state.steps, c)),
            armar: armarRamaLlamada,
          }}
        >
          <AutomationIdContext.Provider value={state.id ?? null}>
            <TemplatesContext.Provider value={templates}>
              <SegmentsContext.Provider value={segments}>
                <TagsContext.Provider value={tags}>
                  <TagsMutateContext.Provider
                    value={(tag) =>
                      setTags((prev) =>
                        prev.some((x) => x.id === tag.id)
                          ? prev
                          : [...prev, tag].sort((a, b) =>
                              a.name.localeCompare(b.name)
                            )
                      )
                    }
                  >
                    <AgentsContext.Provider value={agents}>
                      <OffersContext.Provider value={offers}>
                        <ProductsContext.Provider value={products}>
                          <WaitingCountsContext.Provider value={waitingCounts}>
                            <InvalidStepContext.Provider value={invalidCid}>
                            <DragContext.Provider
                              value={{
                                arrastrando,
                                tomar,
                                apuntar,
                                registrar,
                                olvidar,
                                activo,
                              }}
                            >
                              {/* La tarjeta que viaja, pegada al puntero. Sin esto el gesto es invisible:
        la de origen se atenúa y nada más, así que no se sabe si se agarró algo
        ni qué. Va portaleada al body porque el lienzo recorta y escala, y una
        pieza que sigue al mouse no puede estar sujeta a eso. */}
                              {arrastrando &&
                                puntero &&
                                createPortal(
                                  <div
                                    style={{
                                      position: 'fixed',
                                      left: puntero.x + 14,
                                      top: puntero.y + 14,
                                      zIndex: 100,
                                      pointerEvents: 'none',
                                    }}
                                    className="border-primary/50 bg-card text-foreground max-w-xs rounded-lg border px-3 py-2 text-sm shadow-xl"
                                  >
                                    <span className="flex items-center gap-2">
                                      <GripVertical
                                        className="text-muted-foreground h-4 w-4"
                                        aria-hidden
                                      />
                                      {t(
                                        STEP_META[arrastrando.step.step_type]
                                          .label
                                      )}
                                    </span>
                                    {/* Adónde va a caer, con nombre y apellido. Es lo que evita soltar
              en la rama de al lado sin darse cuenta: los huecos de caminos
              distintos quedan a centímetros y se ven iguales. */}
                                    <span className="text-muted-foreground mt-0.5 block text-[11px]">
                                      {activo
                                        ? (huecos.current.get(activo)?.etiqueta
                                            .current ??
                                          t('automations.dropHere'))
                                        : t('automations.dragOverSlot')}
                                    </span>
                                  </div>,
                                  document.body
                                )}
                              <div className="bg-background fixed inset-0 flex flex-col">
                                {/* Top bar. At sub-sm widths the "Active" label is hidden and the
          switch moves to the right of the save button, so the name input
          gets maximum width. */}
                                <header className="border-border bg-card/80 flex flex-shrink-0 items-center gap-2 border-b py-3 pt-[max(0.75rem,env(safe-area-inset-top))] pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))] sm:gap-3 sm:px-4">
                                  <button
                                    type="button"
                                    onClick={() => leave('/automatizaciones')}
                                    className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md transition-colors"
                                    aria-label={t('automations.back')}
                                  >
                                    <ArrowLeft className="h-4 w-4" />
                                  </button>
                                  <input
                                    value={state.name}
                                    onChange={(e) =>
                                      patchTop('name', e.target.value)
                                    }
                                    placeholder={t(
                                      'automations.untitledAutomation'
                                    )}
                                    className="text-foreground placeholder:text-muted-foreground focus:bg-accent min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-sm font-semibold focus:outline-none sm:text-base"
                                  />
                                  {/* Activation lives in the real editor — a template preview is
            unsaved and would fail the validate.ts gate, so hide it here. */}
                                  {!templatePreview && (
                                    <div className="text-muted-foreground flex items-center gap-2 text-xs">
                                      <span className="hidden sm:inline">
                                        {t('automations.active')}
                                      </span>
                                      <Switch
                                        checked={state.is_active}
                                        onCheckedChange={(v) =>
                                          patchTop('is_active', !!v)
                                        }
                                        aria-label={t('automations.active')}
                                      />
                                    </div>
                                  )}
                                  {!templatePreview && (
                                    <div className="flex gap-1">
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        onClick={undo}
                                        disabled={past.length === 0}
                                        aria-label={t('automations.undo')}
                                        title={t('automations.undo')}
                                        className="border-border text-foreground hover:bg-muted bg-transparent"
                                      >
                                        <Undo2 className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        onClick={redo}
                                        disabled={future.length === 0}
                                        aria-label={t('automations.redo')}
                                        title={t('automations.redo')}
                                        className="border-border text-foreground hover:bg-muted bg-transparent"
                                      >
                                        <Redo2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  )}
                                  {isEditing && !templatePreview && (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      onClick={() =>
                                        leave(`/automatizaciones/${initial.id}`)
                                      }
                                      className="border-border text-foreground hover:bg-muted bg-transparent"
                                    >
                                      <BarChart3 className="h-4 w-4" />
                                      <span className="hidden sm:inline">
                                        {t('automations.viewStats')}
                                      </span>
                                    </Button>
                                  )}
                                  <Button
                                    onClick={() => void save()}
                                    disabled={saving}
                                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                                  >
                                    {saving ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : null}
                                    {isEditing
                                      ? t('automations.save')
                                      : templatePreview
                                        ? t('automations.useTemplate')
                                        : t('automations.saveDraft')}
                                  </Button>
                                </header>

                                <Dialog
                                  open={leavingTo !== null}
                                  onOpenChange={(o) => !o && setLeavingTo(null)}
                                >
                                  <DialogContent className="sm:max-w-sm">
                                    <DialogHeader>
                                      <DialogTitle>
                                        {t('automations.unsavedTitle')}
                                      </DialogTitle>
                                      <DialogDescription>
                                        {t('automations.unsavedBody')}
                                      </DialogDescription>
                                    </DialogHeader>
                                    <DialogFooter className="gap-2 sm:gap-2">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        onClick={() => {
                                          const to = leavingTo;
                                          setLeavingTo(null);
                                          if (to) router.push(to);
                                        }}
                                      >
                                        {t('automations.unsavedDiscard')}
                                      </Button>
                                      <Button
                                        type="button"
                                        disabled={saving}
                                        onClick={() => {
                                          const to = leavingTo;
                                          void save().then((ok) => {
                                            if (!ok) return;
                                            setLeavingTo(null);
                                            if (to) router.push(to);
                                          });
                                        }}
                                        className="bg-primary text-primary-foreground hover:bg-primary/90"
                                      >
                                        {saving ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : null}
                                        {t('automations.unsavedSave')}
                                      </Button>
                                    </DialogFooter>
                                  </DialogContent>
                                </Dialog>

                                {templatePreview && (
                                  <div className="border-primary/20 bg-primary/5 text-muted-foreground flex flex-shrink-0 items-center gap-2 border-b px-4 py-2 text-xs">
                                    <Zap className="text-accent-ink h-3.5 w-3.5 shrink-0" />
                                    <span>
                                      {t('automations.templatePreviewBanner')}
                                    </span>
                                  </div>
                                )}

                                {/* Only surface the channel as a warning when there's NO connected
          WhatsApp — automations can only send through it. When one IS
          connected we don't restate the obvious. There's no audience field:
          an automation fires on its trigger, not on a segment. Per-segment
          scoping, when needed, lives in a "condición → si está en un
          segmento" step. */}
                                {!connections.loading && !whatsappConnected && (
                                  <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs">
                                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                                    <span className="text-foreground">
                                      {t('automations.noWhatsappCantSend')}
                                    </span>
                                    <Link
                                      href="/integraciones"
                                      className="text-accent-ink underline hover:opacity-80"
                                    >
                                      {t('automations.connectWhatsapp')}
                                    </Link>
                                  </div>
                                )}

                                {/* Body: canvas + live phone preview rail (like the template builder). */}
                                <div className="relative flex min-h-0 flex-1">
                                  {/* Canvas — Miro-style infinite viewport: pan with middle mouse or
            Space+drag, zoom with Ctrl+wheel, trackpad two-finger scrolls,
            buttons for explicit zoom + reset. Trigger → steps flow
            left-to-right, and a condition's Sí/No lanes fork off to the
            right so the whole thing reads in one direction. */}
                                  <CanvasViewport focusRequest={focusRequest}>
                                    <div className="flex w-max items-start gap-0 px-8 py-10">
                                      <TriggerCard
                                        type={state.trigger_type}
                                        config={state.trigger_config}
                                        onTypeChange={(t) =>
                                          patchTop('trigger_type', t)
                                        }
                                        onConfigChange={(c) =>
                                          patchTop('trigger_config', c)
                                        }
                                        storePlatforms={storePlatforms}
                                      />
                                      <StepList
                                        steps={state.steps}
                                        parentPath={[]}
                                        expandedId={expandedId}
                                        setExpandedId={setExpandedId}
                                        updateStep={updateStep}
                                        addStepAt={addStepAt}
                                        deleteStepAt={deleteStepAt}
                                        moveStepAt={moveStepAt}
                                        moveStepTo={(destino, index) => {
                                          if (
                                            arrastrando?.origen.kind === 'arbol'
                                          ) {
                                            moveStepTo(
                                              arrastrando.origen.path,
                                              destino,
                                              index
                                            );
                                          }
                                        }}
                                      />
                                    </div>
                                  </CanvasViewport>
                                  {/* The WhatsApp preview now lives INLINE inside the expanded
            "Enviar plantilla" step (see StepEditor) — no separate rail. */}
                                </div>
                              </div>
                            </DragContext.Provider>
                            </InvalidStepContext.Provider>
                          </WaitingCountsContext.Provider>
                        </ProductsContext.Provider>
                      </OffersContext.Provider>
                    </AgentsContext.Provider>
                  </TagsMutateContext.Provider>
                </TagsContext.Provider>
              </SegmentsContext.Provider>
            </TemplatesContext.Provider>
          </AutomationIdContext.Provider>
        </RamaLlamadaContext.Provider>
      </HasVoiceCallContext.Provider>
    </TriggerContext.Provider>
  );
}

// ------------------------------------------------------------
// Trigger card
// ------------------------------------------------------------

function TriggerCard({
  type,
  config,
  onTypeChange,
  onConfigChange,
  storePlatforms,
}: {
  type: AutomationTriggerType;
  config: Record<string, unknown>;
  onTypeChange: (t: AutomationTriggerType) => void;
  onConfigChange: (c: Record<string, unknown>) => void;
  /** Plataformas de tienda conectadas en esta cuenta. Con una sola, el
   *  selector no se muestra. */
  storePlatforms: string[];
}) {
  const t = useT();
  const invalid = useContext(InvalidStepContext) === '__trigger__';
  const [manuallyOpen, setManuallyOpen] = useState(false);
  const open = invalid || manuallyOpen;
  return (
    // Card width: full on mobile, fixed 320px on sm+. The canvas wrapper
    // (max-w-2xl + px-4) keeps this tidy on tablet/desktop.
    <div
      data-step-cid="__trigger__"
      className="z-10 w-full max-w-[320px] sm:w-80"
    >
      <div
        className={cn(
          'border-border bg-card rounded-lg border border-l-4 shadow-lg',
          invalid &&
            'ring-2 ring-amber-500 ring-offset-2 ring-offset-background',
          type.startsWith('shopify_')
            ? 'border-l-emerald-500'
            : 'border-l-blue-500'
        )}
      >
        <button
          type="button"
          onClick={() => setManuallyOpen((v) => !v)}
          data-card-head
          className="flex h-[78px] w-full items-center gap-3 px-4 py-3 text-left"
        >
          <div
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-lg',
              type.startsWith('shopify_')
                ? 'bg-white'
                : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
            )}
          >
            {type.startsWith('shopify_') ? (
              <Image
                src="/channels/shopify.svg"
                alt=""
                width={22}
                height={22}
              />
            ) : (
              <Zap className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div
              className={cn(
                'text-[11px] tracking-wide uppercase',
                type.startsWith('shopify_')
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-blue-700 dark:text-blue-300'
              )}
            >
              {type.startsWith('shopify_')
                ? t('automations.triggerEyebrowShopify')
                : t('automations.triggerEyebrow')}
            </div>
            <div className="text-foreground truncate text-sm font-medium">
              {triggerLabel(type, t)}
            </div>
            {/* Resumen de la configuración, como el nombre de plantilla que
                muestra la tarjeta de acción. Sin esto, lo que decide el
                disparador queda escondido detrás del acordeón y el lienzo
                miente por omisión: se lee "pago rechazado → enviar" cuando
                en realidad hay una espera y una comprobación en el medio. */}
            {triggerSummary(type, config) && (
              <div className="text-muted-foreground truncate text-[11px]">
                {triggerSummary(type, config)}
              </div>
            )}
          </div>
          <ChevronDown
            className={cn(
              'text-muted-foreground h-4 w-4 transition-transform',
              open && 'rotate-180'
            )}
          />
        </button>
        {open && (
          <div className="border-border space-y-3 border-t px-4 py-3">
            <div>
              <select
                value={type}
                onChange={(e) =>
                  onTypeChange(e.target.value as AutomationTriggerType)
                }
                className="border-border bg-muted text-foreground focus:border-primary w-full rounded-md border px-2 py-1.5 text-sm focus:outline-none"
              >
                {/* Keep a legacy/non-selectable trigger visible as the current
                    option so the dropdown shows the real trigger instead of
                    defaulting to the first listed one. */}
                {!TRIGGER_OPTIONS.some((o) => o.value === type) && (
                  <option value={type}>{triggerLabel(type, t)}</option>
                )}
                {TRIGGER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t(o.label)}
                  </option>
                ))}
              </select>
            </div>
            {/* Filtro de plataforma para los activadores de tienda. Sólo se
                muestra si el comercio tiene más de una conectada: con una
                sola, elegir es una decisión que no existe. Sin marcar
                ninguna = todas, que es como se comportaban antes. */}
            {type.startsWith('shopify_') && storePlatforms.length > 1 && (
              <div>
                <div className="text-muted-foreground mb-1.5 text-[11px]">
                  {t('automations.triggerPlatformLabel')}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {storePlatforms.map((plat: string) => {
                    const elegidas = Array.isArray(
                      (config as { platforms?: string[] })?.platforms
                    )
                      ? ((config as { platforms?: string[] })
                          .platforms as string[])
                      : [];
                    const activa =
                      elegidas.length === 0 || elegidas.includes(plat);
                    return (
                      <button
                        key={plat}
                        type="button"
                        onClick={() => {
                          const base =
                            elegidas.length === 0 ? storePlatforms : elegidas;
                          const siguiente = base.includes(plat)
                            ? base.filter((p: string) => p !== plat)
                            : [...base, plat];
                          onConfigChange({
                            ...(config as Record<string, unknown>),
                            // Todas marcadas = sin filtro, que es lo que
                            // heredan las automatizaciones viejas.
                            platforms:
                              siguiente.length === storePlatforms.length
                                ? undefined
                                : siguiente,
                          });
                        }}
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-xs transition-colors',
                          activa
                            ? 'border-primary bg-primary/10 text-foreground'
                            : 'border-border text-muted-foreground hover:bg-muted'
                        )}
                      >
                        {PLATFORM_LABEL[plat] ?? plat}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {type === 'keyword_match' && (
              <KeywordMatchConfig
                config={config as unknown as KeywordMatchTriggerConfig}
                onChange={onConfigChange}
              />
            )}
            {type === 'tag_added' && (
              <TagSelect
                value={(config.tag_id as string) ?? ''}
                onChange={(v) => onConfigChange({ ...config, tag_id: v })}
              />
            )}
            {type === 'time_based' && (
              <Input
                placeholder={t('automations.cronOrTimePlaceholder')}
                value={(config.schedule as string) ?? ''}
                onChange={(e) =>
                  onConfigChange({ ...config, schedule: e.target.value })
                }
                className="bg-muted text-foreground"
              />
            )}
            {type === 'payment_rejected' && <PaymentRejectedConfig />}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Espera y antigüedad de la recuperación de pagos rechazados.
 *
 * La espera es lo que convierte "se le rechazó el pago" en "no compró": al
 * cumplirse, el sistema comprueba si la persona terminó comprando y sólo
 * escribe si no lo hizo. Por eso el texto habla de eso y no de un retardo.
 */
/**
 * Aviso de Mercado Pago sin conectar. El disparador no tiene nada mas que
 * configurar: la automatizacion corre desde que se instala, asi que no hay
 * antiguedad que elegir, y la espera la pone el paso `Esperar` del flujo.
 */
function PaymentRejectedConfig() {
  const t = useT();
  const [mpConnected, setMpConnected] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/integrations/mercadopago', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive) setMpConnected(j ? !!j.connected : null);
      })
      .catch(() => {
        // Un fallo de red no es "no conectado": dejar null oculta el aviso
        // en vez de mandar a reconectar algo que ya funciona.
        if (alive) setMpConnected(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (mpConnected !== false) return null;
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
      <p className="text-xs text-amber-800 dark:text-amber-200">
        {t('automations.mpNotConnected')}
      </p>
      <Link
        href="/integraciones"
        className="mt-1 inline-block text-xs font-medium underline underline-offset-2"
      >
        {t('automations.mpConnectCta')}
      </Link>
    </div>
  );
}

function KeywordMatchConfig({
  config,
  onChange,
}: {
  config: KeywordMatchTriggerConfig;
  onChange: (c: Record<string, unknown>) => void;
}) {
  const t = useT();
  const keywords = config?.keywords ?? [];
  return (
    <div className="space-y-2">
      <div>
        <label className="text-muted-foreground mb-1 block text-xs font-medium">
          {t('automations.keywordsLabel')}
        </label>
        <Input
          value={keywords.join(', ')}
          onChange={(e) =>
            onChange({
              ...config,
              keywords: e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          className="bg-muted text-foreground"
        />
      </div>
      <div>
        <label className="text-muted-foreground mb-1 block text-xs font-medium">
          {t('automations.matchTypeLabel')}
        </label>
        <select
          value={config?.match_type ?? 'contains'}
          onChange={(e) =>
            onChange({
              ...config,
              match_type: e.target.value as 'exact' | 'contains',
            })
          }
          className="border-border bg-muted text-foreground w-full rounded-md border px-2 py-1.5 text-sm focus:outline-none"
        >
          <option value="contains">{t('automations.matchContains')}</option>
          <option value="exact">{t('automations.matchExact')}</option>
        </select>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Step list + card + connectors
// ------------------------------------------------------------

interface StepListProps {
  steps: BuilderStep[];
  parentPath: StepPath;
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  updateStep: (
    path: StepPath,
    updater: (s: BuilderStep) => BuilderStep
  ) => void;
  addStepAt: (
    parent: ParentScope,
    index: number,
    type: BuilderStepType,
    initialConfig?: Record<string, unknown>
  ) => void;
  deleteStepAt: (path: StepPath) => void;
  moveStepAt: (path: StepPath, direction: -1 | 1) => void;
  /** Soltar el paso que se está arrastrando en este hueco. El origen sale del
   *  contexto: el hueco sólo sabe adónde, no qué. */
  moveStepTo: (destino: ParentScope, index: number) => void;
  /** Nombre del camino al que pertenece esta tira ("Sí", "No", un caso…). El
   *  tronco no lleva ninguno. Sólo se usa para decir adónde cae una tarjeta. */
  laneLabel?: string;
}

function StepList(props: StepListProps) {
  const { steps, parentPath, laneLabel, ...rest } = props;
  const t = useT();
  // "Después de Enviar plantilla · en el camino Sí". El camino sólo se nombra
  // cuando hay uno: en el tronco sería ruido.
  const enCamino = laneLabel
    ? ` · ${t('automations.dropInLane', { camino: laneLabel })}`
    : '';
  const rotulo = (index: number) =>
    (index === 0
      ? t('automations.dropAtStart')
      : t('automations.dropAfter', {
          paso: t(STEP_META[steps[index - 1].step_type].label),
        })) + enCamino;
  // Everything flows left-to-right — the root chain AND each condition
  // branch. A branch is just the chain continuing horizontally down its
  // own lane, so the two paths read as a fork along the same direction.
  const parentScope: ParentScope =
    parentPath.length === 0
      ? { kind: 'root' }
      : (() => {
          const last = parentPath[parentPath.length - 1];
          if (last.kind !== 'branch') return { kind: 'root' } as const;
          return {
            kind: 'branch',
            parentCid: last.parentCid,
            branch: last.branch,
          } as const;
        })();

  return (
    <div className="flex items-start">
      <AddButton
        orientation="h"
        tail={steps.length > 0}
        onPick={(ty, initialConfig) => props.addStepAt(parentScope, 0, ty, initialConfig)}
        onDrop={() => props.moveStepTo(parentScope, 0)}
        dropLabel={rotulo(0)}
      />
      {steps.map((step, idx) => (
        <StepRenderer
          key={step.cid}
          step={step}
          index={idx}
          total={steps.length}
          parentScope={parentScope}
          parentPath={parentPath}
          {...rest}
        />
      ))}
    </div>
  );
}

/** Amber pill shown on a wait card with how many contacts are parked there
 *  right now. Renders nothing unless the step is a saved wait (has a serverId)
 *  with at least one contact waiting. */
function WaitingBadge({ step }: { step: BuilderStep }) {
  const t = useT();
  const counts = useContext(WaitingCountsContext);
  if (step.step_type !== 'wait' || !step.serverId) return null;
  const n = counts[step.serverId] ?? 0;
  if (n <= 0) return null;
  return (
    <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-amber-600/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 tabular-nums dark:text-amber-300">
      <Hourglass className="h-3 w-3" aria-hidden />
      {t('automations.waitingNow', { n })}
    </span>
  );
}

function StepRenderer({
  step,
  index,
  total,
  parentScope,
  parentPath,
  ...props
}: {
  step: BuilderStep;
  index: number;
  total: number;
  parentScope: ParentScope;
  parentPath: StepPath;
} & Omit<StepListProps, 'steps' | 'parentPath'>) {
  const t = useT();
  const arrastre = useContext(DragContext);
  const invalid = useContext(InvalidStepContext) === step.cid;
  // El último tramo del camino DESCRIBE este carril, no un paso: lo puso
  // ConditionBranches con índice 0 para que StepList supiera de qué rama
  // cuelga. Al llegar acá hay que reemplazarlo por el índice real, no sumarle
  // otro tramo encima.
  //
  // Sumándolo, el camino ganaba un nivel por cada condición anidada y todas
  // las operaciones caían un escalón más abajo del que tocaba: editar una
  // tarjeta cambiaba la de adentro, y borrar la más profunda —que ya no tiene
  // nada debajo— no hacía absolutamente nada. Eso era el "no me deja
  // eliminar" y el "hay botones de añadir que no agregan".
  const path: StepPath =
    parentScope.kind === 'root'
      ? [...parentPath, { kind: 'root', index }]
      : [
          ...parentPath.slice(0, -1),
          {
            kind: 'branch',
            parentCid: parentScope.parentCid,
            branch: parentScope.branch,
            index,
          },
        ];
  const meta = STEP_META[step.step_type];
  const Icon = meta.icon;
  const etiquetas = useContext(TagsContext);
  const expanded = props.expandedId === step.cid;
  const isCondition = step.step_type === 'condition';
  const isSwitch = step.step_type === 'switch';
  const isBranch = isCondition || isSwitch;
  // Card widths on mobile fill the full canvas column (max-w-2xl px-4
  // still keeps them reasonable). On sm+ the original fixed widths
  // come back so the flow visual stays recognisable.
  // Todas las tarjetas miden lo mismo. La condicion tenia 400px "porque su
  // configuracion es mas ancha", y el resultado era una fila con una caja
  // fuera de escala: el lienzo se leia desparejo justo en el paso que hay
  // que entender mejor. La configuracion, ancha o angosta, vive adentro al
  // desplegar — como en todos los demas.
  const width = 'w-full max-w-[320px] sm:w-80';

  const cardEl = (
    <div data-step-cid={step.cid} className={cn('flex flex-col', width)}>
      <div
        className={cn(
          'border-border bg-card relative rounded-lg border border-l-4 shadow-lg transition-opacity',
          meta.border,
          invalid &&
            'ring-2 ring-amber-500 ring-offset-2 ring-offset-background',
          // La tarjeta que viaja se atenúa: sin eso parece que sigue en su
          // lugar y no se entiende qué se está moviendo.
          arrastre.arrastrando?.cid === step.cid && 'opacity-40'
        )}
      >
        {/* El asa va FUERA del botón, no adentro. Adentro, Chrome no
              arranca nunca el arrastre: el botón se queda con el mousedown y
              el `dragstart` no llega a dispararse. Es lo que hacía que
              funcionara al dispararlo por código y no con el mouse. */}
        <Asa
          onTake={() =>
            arrastre.tomar({
              cid: step.cid,
              step,
              origen: { kind: 'arbol', path },
            })
          }
        />
        <button
          type="button"
          onClick={() => props.setExpandedId(expanded ? null : step.cid)}
          data-card-head
          className="flex h-[78px] w-full items-center gap-3 py-3 pr-4 pl-9 text-left"
        >
          <div
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-lg',
              meta.iconBg,
              meta.iconText
            )}
          >
            {meta.brand === 'whatsapp' ? (
              <Image
                src="/channels/whatsapp.svg"
                alt=""
                width={20}
                height={20}
              />
            ) : meta.brand === 'shopify' ? (
              <Image
                src="/channels/shopify.svg"
                alt=""
                width={20}
                height={20}
              />
            ) : (
              <Icon className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-muted-foreground text-[11px] tracking-wide uppercase">
              {isBranch
                ? t('automations.kindCondition')
                : step.step_type === 'wait'
                  ? t('automations.kindWait')
                  : t('automations.kindAction')}
            </div>
            <div className="text-foreground truncate text-sm font-medium">
              {t(stepTitleKey(step))}
            </div>
            <div className="text-muted-foreground truncate text-[11px]">
              {previewFor(step, t, etiquetas)}
            </div>
          </div>
          <WaitingBadge step={step} />
          <ChevronDown
            className={cn(
              'text-muted-foreground h-4 w-4 transition-transform',
              expanded && 'rotate-180'
            )}
          />
        </button>
        {expanded && (
          <div className="border-border border-t px-4 py-3">
            <StepEditor
              step={step}
              onChange={(next) => props.updateStep(path, () => next)}
            />
            <div className="border-border mt-3 flex items-center justify-between gap-2 border-t pt-3">
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={index === 0}
                  aria-label={t('automations.moveBefore')}
                  onClick={() => props.moveStepAt(path, -1)}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={index === total - 1}
                  aria-label={t('automations.moveAfter')}
                  onClick={() => props.moveStepAt(path, 1)}
                >
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => props.deleteStepAt(path)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t('automations.delete')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {isCondition ? (
        // Condition: card on the left, its two branch lanes fanning out to
        // the right so each path keeps flowing in the chain's direction
        // instead of dropping into stacked vertical columns.
        <div className="z-10 flex items-start gap-2">
          {cardEl}
          <ConditionBranches step={step} parentPath={path} {...props} />
        </div>
      ) : isSwitch ? (
        // Switch: card on the left, one lane per case + an "en otro caso"
        // lane fanning out to the right (same visual grammar as a condition,
        // just N lanes instead of two).
        <div className="z-10 flex items-start gap-2">
          {cardEl}
          <SwitchBranches
            step={step}
            switchPath={path}
            expandedId={props.expandedId}
            setExpandedId={props.setExpandedId}
            updateStep={props.updateStep}
          />
        </div>
      ) : (
        <div className="z-10">{cardEl}</div>
      )}

      {/* La continuación de una condición/switch vive DENTRO de sus ramas, no
          después. Mostrar aquí un "+ Añadir" además del de cada rama daba dos
          botones pegados y confundía — se omite para condición/switch. */}
      {!isCondition && !isSwitch && (
        <AddButton
          orientation="h"
          tail={index < total - 1}
          onPick={(ty, initialConfig) => props.addStepAt(parentScope, index + 1, ty, initialConfig)}
          onDrop={() => props.moveStepTo(parentScope, index + 1)}
          dropLabel={
            t('automations.dropAfter', {
              paso: t(STEP_META[step.step_type].label),
            }) +
            (props.laneLabel
              ? ` · ${t('automations.dropInLane', { camino: props.laneLabel })}`
              : '')
          }
        />
      )}
    </>
  );
}

function ConditionBranches({
  step,
  parentPath,
  ...props
}: {
  step: BuilderStep;
  parentPath: StepPath;
} & Omit<StepListProps, 'steps' | 'parentPath'>) {
  const t = useT();
  const yes = step.branches?.yes ?? [];
  const no = step.branches?.no ?? [];
  // Build the child scope by appending a branch marker. The scope the
  // StepList uses is driven by the LAST element of parentPath, so the
  // tail's `index` doesn't matter — it's replaced per child during walks.
  const yesPath: StepPath = [
    ...parentPath,
    { kind: 'branch', parentCid: step.cid, branch: 'yes', index: 0 },
  ];
  const noPath: StepPath = [
    ...parentPath,
    { kind: 'branch', parentCid: step.cid, branch: 'no', index: 0 },
  ];
  return (
    // Two lanes stacked one over the other (Sí above, No below). Each lane
    // is a horizontal chain, so the branches read as the flow forking and
    // carrying on rightward. The dashed rail ties them back to the card.
    <BranchFan
      lanes={[
        {
          key: 'yes',
          label: t('automations.branchYes'),
          color: 'border-emerald-500/40 bg-emerald-500/10 text-accent-ink',
          content: (
            <StepList
              {...props}
              steps={yes}
              parentPath={yesPath}
              laneLabel={t('automations.branchYes')}
            />
          ),
        },
        {
          key: 'no',
          label: t('automations.branchNo'),
          color:
            'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400',
          content: (
            <StepList
              {...props}
              steps={no}
              parentPath={noPath}
              laneLabel={t('automations.branchNo')}
            />
          ),
        },
      ]}
    />
  );
}

/**
 * Abanico de caminos: el tronco sale de la tarjeta, se abre en una espina
 * vertical y de ahí sale un ramal a cada camino. La etiqueta del camino va
 * montada SOBRE el ramal, no flotando arriba: antes quedaba a media altura
 * entre dos filas, sin tocar nada, y no se leía de qué camino era.
 *
 * Todo cuelga de una sola altura, 40 px desde el arranque de la fila: la
 * cabecera de una tarjeta mide 78 px fijos más su borde, y tanto la columna de
 * la etiqueta como el "+ Añadir" son cajas de ese mismo alto que centran su
 * contenido. Por eso el ramal entra siempre por la cabecera aunque la tarjeta
 * esté desplegada, sin medir nada.
 *
 * Lo único que hay que medir es dónde arranca cada fila —dependen del alto del
 * camino de arriba— y se mide con offsetTop, que ya viene en píxeles de CSS.
 * Con getBoundingClientRect había que deshacer a mano el zoom del lienzo o las
 * líneas se encogían dos veces.
 *
 * Las columnas son una grilla: la de las etiquetas mide lo que la etiqueta más
 * larga, así los caminos arrancan todos a la misma altura horizontal en vez de
 * escalonarse según lo largo que sea su nombre.
 */
/**
 * Etiqueta del carril: corta y sin la ventana.
 *
 * El resumen completo ("No compró · desde que empezó") ya está en la tarjeta
 * de la condición. Repetirlo en cada carril lo obligaba a truncarse —
 * "NO LE ESCRIBIMOS · EN LAS ÚLTIMAS 2…"— y encima de forma distinta en cada
 * camino. Acá alcanza con qué camino es.
 */
function caseShortLabel(
  cfg: Record<string, unknown>,
  t: TFn,
  index: number
): string {
  const full = conditionPreview(cfg, t);
  if (!cfg.subject)
    return t('automations.switchPathN', { n: String(index + 1) });
  // El resumen viene como "lado · ventana": el lado solo ya identifica el
  // camino, y es lo que entra sin cortarse.
  const side = full.split(' · ')[0];
  return side || t('automations.switchPathN', { n: String(index + 1) });
}

function SwitchBranches({
  step,
  switchPath,
  expandedId,
  setExpandedId,
  updateStep,
}: {
  step: BuilderStep;
  switchPath: StepPath;
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  updateStep: (
    path: StepPath,
    updater: (s: BuilderStep) => BuilderStep
  ) => void;
}) {
  const t = useT();
  const arrastre = useContext(DragContext);
  const sd = step.switchData ?? { dpId: undefined, cases: [], elseSteps: [] };

  // Every mutation reshapes step.switchData through the switch's own path.
  const patch = (fn: (d: SwitchData<BuilderStep>) => SwitchData<BuilderStep>) =>
    updateStep(switchPath, (s) => ({
      ...s,
      switchData: fn(
        s.switchData ?? { dpId: undefined, cases: [], elseSteps: [] }
      ),
    }));

  const mutateLane = (
    lane: string | 'else',
    fn: (steps: BuilderStep[]) => BuilderStep[]
  ) =>
    patch((d) =>
      lane === 'else'
        ? { ...d, elseSteps: fn(d.elseSteps) }
        : {
            ...d,
            cases: d.cases.map((c) =>
              c.ckey === lane ? { ...c, steps: fn(c.steps) } : c
            ),
          }
    );
  const addStep = (lane: string | 'else', type: BuilderStepType, at?: number, initialConfig?: Record<string, unknown>) =>
    mutateLane(lane, (steps) => {
      const node = {
        cid: cid(),
        step_type: type,
        step_config: { ...blankConfig(type), ...initialConfig },
      };
      const i =
        at === undefined
          ? steps.length
          : Math.max(0, Math.min(at, steps.length));
      return [...steps.slice(0, i), node, ...steps.slice(i)];
    });
  const changeStep = (lane: string | 'else', idx: number, next: BuilderStep) =>
    mutateLane(lane, (steps) => steps.map((s, i) => (i === idx ? next : s)));
  const removeStep = (lane: string | 'else', idx: number) =>
    mutateLane(lane, (steps) => steps.filter((_, i) => i !== idx));
  const moveStep = (lane: string | 'else', idx: number, dir: -1 | 1) =>
    mutateLane(lane, (steps) => {
      const j = idx + dir;
      if (j < 0 || j >= steps.length) return steps;
      const copy = [...steps];
      [copy[idx], copy[j]] = [copy[j], copy[idx]];
      return copy;
    });

  /**
   * Soltar un paso en un carril, venga de este carril o del de al lado.
   *
   * Se hace en UNA sola escritura sobre los caminos, y no sacando de un lado
   * y poniendo en el otro: si fueran dos, entre una y otra el paso no existe
   * en ningún lado, y cualquier redibujado en el medio lo pierde.
   */
  const soltarEnCarril = (destino: string | 'else', index: number) => {
    const a = arrastre.arrastrando;
    if (!a || a.origen.kind !== 'carril' || a.origen.owner !== step.cid) return;
    const origen = a.origen;
    patch((d) => {
      const leer = (lane: string) =>
        lane === 'else'
          ? d.elseSteps
          : (d.cases.find((c) => c.ckey === lane)?.steps ?? []);
      const escribir = (lane: string, steps: BuilderStep[]) =>
        lane === 'else'
          ? { elseSteps: steps }
          : {
              cases: d.cases.map((c) =>
                c.ckey === lane ? { ...c, steps } : c
              ),
            };

      const nodo = leer(origen.lane)[origen.index];
      if (!nodo) return d;

      if (origen.lane === destino) {
        const lista = [...leer(destino)];
        lista.splice(origen.index, 1);
        // Sacarlo corre todo lo que venía después, así que el hueco elegido
        // se mueve con ellos.
        const i = origen.index < index ? index - 1 : index;
        lista.splice(i, 0, nodo);
        return { ...d, ...escribir(destino, lista) };
      }

      const sinEl = leer(origen.lane).filter((_, i) => i !== origen.index);
      const conEl = [...leer(destino)];
      conEl.splice(index, 0, nodo);
      let siguiente = { ...d, ...escribir(origen.lane, sinEl) };
      siguiente = { ...siguiente, ...escribir(destino, conEl) };
      // El segundo `escribir` recalcula `cases` sobre `d`, no sobre lo que
      // dejó el primero: cuando los dos carriles son casos, se rearma la
      // lista completa a mano para no perder la primera edición.
      if (origen.lane !== 'else' && destino !== 'else') {
        siguiente = {
          ...d,
          cases: d.cases.map((c) =>
            c.ckey === origen.lane
              ? { ...c, steps: sinEl }
              : c.ckey === destino
                ? { ...c, steps: conEl }
                : c
          ),
        };
      }
      return siguiente;
    });
    arrastre.tomar(null);
  };

  // Una condición SIEMPRE muestra sus caminos, incluido el "en otro caso"
  // aunque esté vacío. Hubo una versión que dibujaba el caso de un solo
  // camino como línea recta, y escondía justamente lo que hay que ver: qué
  // pasa con quien NO cumple. Un flujo donde esa rama no se ve parece que
  // sigue de largo para todos.
  return (
    <BranchFan
      lanes={[
        ...sd.cases.map((c, i) => ({
          key: c.ckey,
          label: caseShortLabel(c.cfg, t, i),
          color: 'border-emerald-500/40 bg-emerald-500/10 text-accent-ink',
          content: (
            <SwitchLaneSteps
              steps={c.steps}
              expandedId={expandedId}
              setExpandedId={setExpandedId}
              onAdd={(type, at, initialConfig) => addStep(c.ckey, type, at, initialConfig)}
              onChangeStep={(i, n) => changeStep(c.ckey, i, n)}
              onRemoveStep={(i) => removeStep(c.ckey, i)}
              onMoveStep={(i, dir) => moveStep(c.ckey, i, dir)}
              owner={step.cid}
              lane={c.ckey}
              laneLabel={caseShortLabel(c.cfg, t, i)}
              onDropAt={(at) => soltarEnCarril(c.ckey, at)}
            />
          ),
        })),
        {
          key: 'else',
          label: t('automations.switchElse'),
          color: 'border-slate-400/40 bg-slate-400/10 text-muted-foreground',
          content: (
            <SwitchLaneSteps
              steps={sd.elseSteps}
              expandedId={expandedId}
              setExpandedId={setExpandedId}
              onAdd={(type, at, initialConfig) => addStep('else', type, at, initialConfig)}
              onChangeStep={(i, n) => changeStep('else', i, n)}
              onRemoveStep={(i) => removeStep('else', i)}
              onMoveStep={(i, dir) => moveStep('else', i, dir)}
              owner={step.cid}
              lane="else"
              laneLabel={t('automations.switchElse')}
              onDropAt={(at) => soltarEnCarril('else', at)}
            />
          ),
        },
      ]}
    />
  );
}

function SwitchLaneSteps({
  steps,
  expandedId,
  setExpandedId,
  onAdd,
  onChangeStep,
  onRemoveStep,
  onMoveStep,
  owner,
  lane,
  laneLabel,
  onDropAt,
}: {
  steps: BuilderStep[];
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  onAdd: (type: BuilderStepType, at: number, initialConfig?: Record<string, unknown>) => void;
  onChangeStep: (i: number, n: BuilderStep) => void;
  onRemoveStep: (i: number) => void;
  onMoveStep: (i: number, dir: -1 | 1) => void;
  /** Qué condición y qué carril son estos: lo necesita el arrastre para saber
   *  de dónde salió lo que se está moviendo y adónde puede caer. */
  owner: string;
  lane: string;
  /** Cómo se llama este camino en pantalla, para decir adónde cae la tarjeta. */
  laneLabel: string;
  onDropAt: (index: number) => void;
}) {
  const t = useT();
  const rotulo = (index: number) =>
    `${
      index === 0
        ? t('automations.dropAtStart')
        : t('automations.dropAfter', {
            paso: t(STEP_META[steps[index - 1].step_type].label),
          })
    } · ${t('automations.dropInLane', { camino: laneLabel })}`;

  return (
    <div className="flex items-start gap-2">
      {/* Tambien delante del primero: si no, no hay forma de meter un paso
          entre la condicion y lo que ya tiene el camino. */}
      <AddButton
        orientation="h"
        types={LEAF_STEPS}
        tail={steps.length > 0}
        onPick={(ty, initialConfig) => onAdd(ty, 0, initialConfig)}
        onDrop={() => onDropAt(0)}
        dropLabel={rotulo(0)}
      />
      {steps.map((s, i) => (
        <Fragment key={s.cid}>
          <LeafStepCard
            step={s}
            expanded={expandedId === s.cid}
            onToggle={() => setExpandedId(expandedId === s.cid ? null : s.cid)}
            onChange={(n) => onChangeStep(i, n)}
            onRemove={() => onRemoveStep(i)}
            onMoveUp={() => onMoveStep(i, -1)}
            onMoveDown={() => onMoveStep(i, 1)}
            canUp={i > 0}
            canDown={i < steps.length - 1}
            owner={owner}
            lane={lane}
            index={i}
          />
          {/* Entre cada par de pasos, no sólo al final: si no, para meter algo
              en el medio hay que agregarlo al final y moverlo. */}
          <AddButton
            orientation="h"
            types={LEAF_STEPS}
            tail={i < steps.length - 1}
            onPick={(ty, initialConfig) => onAdd(ty, i + 1, initialConfig)}
            onDrop={() => onDropAt(i + 1)}
            dropLabel={rotulo(i + 1)}
          />
        </Fragment>
      ))}
    </div>
  );
}

/** Compact, self-contained card for a single leaf action inside a switch lane.
 *  Mirrors StepRenderer's card chrome but takes plain callbacks (no path). */
function LeafStepCard({
  step,
  expanded,
  onToggle,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  canUp,
  canDown,
  owner,
  lane,
  index,
}: {
  step: BuilderStep;
  expanded: boolean;
  onToggle: () => void;
  onChange: (s: BuilderStep) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canUp: boolean;
  canDown: boolean;
  owner: string;
  lane: string;
  index: number;
}) {
  const t = useT();
  const arrastre = useContext(DragContext);
  const invalid = useContext(InvalidStepContext) === step.cid;
  const etiquetas = useContext(TagsContext);
  const meta = STEP_META[step.step_type];
  const Icon = meta.icon;
  return (
    <div
      data-step-cid={step.cid}
      className="flex w-full max-w-[320px] flex-col sm:w-80"
    >
      <div
        className={cn(
          'border-border bg-card relative rounded-lg border border-l-4 shadow-sm transition-opacity',
          meta.border,
          invalid &&
            'ring-2 ring-amber-500 ring-offset-2 ring-offset-background',
          arrastre.arrastrando?.cid === step.cid && 'opacity-40'
        )}
      >
        <Asa
          onTake={() =>
            arrastre.tomar({
              cid: step.cid,
              step,
              origen: { kind: 'carril', owner, lane, index },
            })
          }
        />
        <button
          type="button"
          onClick={onToggle}
          data-card-head
          className="flex h-[78px] w-full items-center gap-3 py-2.5 pr-3 pl-9 text-left"
        >
          <div
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-lg',
              meta.iconBg,
              meta.iconText
            )}
          >
            {meta.brand === 'whatsapp' ? (
              <Image
                src="/channels/whatsapp.svg"
                alt=""
                width={18}
                height={18}
              />
            ) : meta.brand === 'shopify' ? (
              <Image
                src="/channels/shopify.svg"
                alt=""
                width={18}
                height={18}
              />
            ) : (
              <Icon className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-foreground truncate text-sm font-medium">
              {t(stepTitleKey(step))}
            </div>
            <div className="text-muted-foreground truncate text-[11px]">
              {previewFor(step, t, etiquetas)}
            </div>
          </div>
          <WaitingBadge step={step} />
          <ChevronDown
            className={cn(
              'text-muted-foreground h-4 w-4 transition-transform',
              expanded && 'rotate-180'
            )}
          />
        </button>
        {expanded && (
          <div className="border-border border-t px-3 py-3">
            <StepEditor step={step} onChange={onChange} />
            <div className="border-border mt-3 flex items-center justify-between gap-2 border-t pt-3">
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={!canUp}
                  aria-label={t('automations.moveBefore')}
                  onClick={onMoveUp}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={!canDown}
                  aria-label={t('automations.moveAfter')}
                  onClick={onMoveDown}
                >
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
              <Button variant="destructive" size="sm" onClick={onRemove}>
                <Trash2 className="h-3.5 w-3.5" />
                {t('automations.delete')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AddButton({
  onPick,
  onDrop,
  dropLabel,
  orientation = 'v',
  types = ADDABLE_STEPS,
  tail = true,
}: {
  onPick: (t: BuilderStepType, initialConfig?: Record<string, unknown>) => void;
  /** Soltar acá un paso arrastrado. Sin esto el hueco no acepta nada. */
  onDrop?: () => void;
  /** Adónde lleva este hueco, en palabras: "después de Enviar plantilla". */
  dropLabel?: string;
  orientation?: 'h' | 'v';
  /** Which step types the menu offers (default: the full chain menu; switch
   *  case/else lanes pass LEAF_STEPS so they can't nest branching). */
  types?: BuilderStepType[];
  /** Tramo de línea DESPUÉS del botón. El último "+ Añadir" de una cadena no
   *  lo lleva: quedaba un cable cortado colgando en el aire, que se lee como
   *  que el flujo sigue hacia algo que no está. */
  tail?: boolean;
}) {
  const t = useT();
  const seg = orientation === 'h' ? 'h-[2px] w-6' : 'h-6 w-[2px]';
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const arrastre = useContext(DragContext);
  const arrastrando = Boolean(arrastre.arrastrando) && Boolean(onDrop);

  // Cada hueco se anota con su acción para que el gesto lo encuentre por
  // posición. La acción va en un ref: cambia en cada pintada y volver a
  // anotarse cada vez sería registrar y borrar sesenta veces por segundo.
  const slotId = useId();
  const accion = useRef<(() => void) | undefined>(undefined);
  accion.current = onDrop;
  const rotulo = useRef<string | undefined>(undefined);
  rotulo.current = dropLabel;
  const { registrar, olvidar } = arrastre;
  useEffect(() => {
    if (!onDrop) return;
    registrar(slotId, accion, rotulo);
    return () => olvidar(slotId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotId, registrar, olvidar, Boolean(onDrop)]);

  const encima = arrastre.activo === slotId;

  // Menú PROPIO (portaleado a body, con onClick nativo) en vez del DropdownMenu
  // de base-ui: base-ui NO registra el click del mouse en los items cuando el
  // disparador vive dentro de la transformación CSS `scale` del lienzo zoomeable
  // (el teclado sí funcionaba, el mouse no → nada se agregaba). Un onClick nativo
  // dispara el handler sin ese hit-testing roto, y el portal evita el clip.
  const openMenu = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: r.left });
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      const target = e.target as Node;
      // El menú está portaleado FUERA del trigger, así que hay que excluirlo
      // explícitamente — si no, un click en un item cuenta como "afuera" y
      // cierra el menú en el pointerdown antes de que dispare su onClick.
      if (
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // Diferir el listener para no capturar el mismo click que abrió el menú.
    const id = window.setTimeout(
      () => document.addEventListener('pointerdown', onDoc),
      0
    );
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div
      data-drop-slot={onDrop ? slotId : undefined}
      className={cn(
        'group/add relative flex items-center',
        // Siempre a full opacidad: el "+ Añadir" es la acción principal para
        // construir el flujo, así que tiene que verse sin buscarlo.
        'opacity-100',
        // En horizontal ocupa una caja del alto de una cabecera y se centra
        // dentro: así la línea sale exactamente a la misma altura que la de la
        // tarjeta de al lado. Con un margen calculado a mano quedaba un par de
        // píxeles más abajo —el alto del botón depende de la tipografía— y la
        // línea se veía escalonada justo en la unión. Y es una caja del alto de
        // la cabecera, no de la tarjeta entera, porque la tarjeta crece hacia
        // abajo al desplegarse y arrastraría la línea con ella.
        orientation === 'h' ? cn('flex-row self-start', HEAD_H) : 'flex-col'
      )}
    >
      <div className={cn(seg, LINE)} aria-hidden />
      <button
        ref={triggerRef}
        type="button"
        onClick={openMenu}
        aria-label={t('automations.addStep')}
        aria-expanded={open}
        className={cn(
          'border-primary bg-primary/10 text-accent-ink hover:bg-primary/20 flex shrink-0 items-center gap-1.5 rounded-full border-2 border-dashed px-2.5 py-1 text-[11px] font-semibold transition-all',
          open && 'bg-primary/20',
          // Mientras algo viaja, los huecos se encienden y el que está bajo el
          // puntero se pinta lleno — pero SIN cambiar de tamaño ni de texto.
          //
          // Antes se ensanchaban y decían "Soltar aquí", y eso reacomodaba la
          // fila entera justo al empezar el gesto: las tarjetas se corrían a
          // la derecha y el hueco al que apuntabas ya no estaba donde lo
          // habías mirado. Se soltaba en cualquier lado, o en ninguno. La
          // escala y el anillo son transformaciones: se ven y no mueven nada.
          arrastrando && 'bg-primary/25',
          encima && 'bg-primary/50 ring-primary scale-125 ring-2'
        )}
      >
        <Plus className="h-3.5 w-3.5" />
        {t('automations.add')}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              zIndex: 60,
            }}
            className="border-border bg-card max-h-80 min-w-64 overflow-y-auto rounded-md border py-1 shadow-lg"
          >
            <div className="border-border text-muted-foreground border-b px-2 py-1.5 text-[10px] font-semibold tracking-wide uppercase">
              {t('automations.chooseWhatToDo')}
            </div>
            {types.flatMap<{ stepType: BuilderStepType; label: string; initialConfig?: Record<string, unknown> }>((stepType) =>
              stepType === 'send_message'
                ? [
                    { stepType, label: STEP_META[stepType].label, initialConfig: { voice_only: false, voice_note: null } },
                    { stepType, label: 'automations.stepSendVoiceNote', initialConfig: { voice_only: true, voice_note: { text: '' } } },
                  ]
                : [{ stepType, label: STEP_META[stepType].label }],
            ).map(({ stepType, label, initialConfig }) => {
              const m = STEP_META[stepType];
              const Icon = m.icon;
              return (
                <button
                  key={`${stepType}-${String(initialConfig?.voice_only ?? 'default')}`}
                  type="button"
                  onClick={() => {
                    onPick(stepType, initialConfig);
                    setOpen(false);
                  }}
                  className="text-foreground hover:bg-accent flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-sm"
                >
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
                      m.iconBg,
                      m.iconText
                    )}
                  >
                    {m.brand === 'whatsapp' ? (
                      <Image
                        src="/channels/whatsapp.svg"
                        alt=""
                        width={14}
                        height={14}
                      />
                    ) : m.brand === 'shopify' ? (
                      <Image
                        src="/channels/shopify.svg"
                        alt=""
                        width={14}
                        height={14}
                      />
                    ) : (
                      <Icon className="h-3.5 w-3.5" />
                    )}
                  </span>
                  {t(label)}
                </button>
              );
            })}
          </div>,
          document.body
        )}
      {tail && <div className={cn(seg, LINE)} aria-hidden />}
    </div>
  );
}

// ------------------------------------------------------------
// Per-step config editor
// ------------------------------------------------------------

/**
 * Los caminos de una "Condición" multi-camino, editados DENTRO de la
 * tarjeta.
 *
 * Antes cada filtro vivía en su carril del lienzo, siempre abierto: la
 * condición era el único elemento que no se veía como los demás ni guardaba
 * su configuración detrás del clic. Los carriles ahora muestran sólo lo que
 * cada camino hace.
 */
function SwitchPathsEditor({
  step,
  onChange,
}: {
  step: BuilderStep;
  onChange: (s: BuilderStep) => void;
}) {
  const t = useT();
  const sd = step.switchData ?? { dpId: undefined, cases: [], elseSteps: [] };
  const patch = (next: SwitchData<BuilderStep>) =>
    onChange({ ...step, switchData: next });

  return (
    <div className="space-y-3">
      {sd.cases.map((c, i) => (
        <div
          key={c.ckey}
          className="border-border bg-muted/40 rounded-md border p-2"
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
              {t('automations.switchPathN', { n: String(i + 1) })}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('automations.switchRemoveCase')}
              onClick={() =>
                patch({
                  ...sd,
                  cases: sd.cases.filter((x) => x.ckey !== c.ckey),
                })
              }
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <ConditionFields
            cfg={c.cfg}
            set={(p) =>
              patch({
                ...sd,
                cases: sd.cases.map((x) =>
                  x.ckey === c.ckey ? { ...x, cfg: { ...x.cfg, ...p } } : x
                ),
              })
            }
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          patch({
            ...sd,
            cases: [...sd.cases, { ckey: cid(), cfg: {}, steps: [] }],
          })
        }
        className="border-border bg-background text-muted-foreground hover:border-primary hover:bg-primary/10 hover:text-accent-ink inline-flex items-center gap-1.5 rounded-full border-2 border-dashed px-2.5 py-1 text-[11px] font-medium transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        {t('automations.switchAddCase')}
      </button>
    </div>
  );
}

function StepEditor({
  step,
  onChange,
}: {
  step: BuilderStep;
  onChange: (s: BuilderStep) => void;
}) {
  const t = useT();
  const cfg = step.step_config;
  const templates = useContext(TemplatesContext);
  const automationId = useContext(AutomationIdContext);
  const trigger = useContext(TriggerContext);
  const hasVoiceCall = useContext(HasVoiceCallContext);
  const set = (patch: Record<string, unknown>) =>
    onChange({ ...step, step_config: { ...cfg, ...patch } });
  // Template preview is collapsed by default (used only by send_template).
  const [showPreview, setShowPreview] = useState(false);
  const [previewVariantIndex, setPreviewVariantIndex] = useState(0);

  switch (step.step_type) {
    case 'send_message':
      if (cfg.voice_only) {
        return (
          <VoiceNoteEditor
            value={(cfg.voice_note as VoiceNoteConfig) ?? null}
            onChange={(voice_note) => set({ voice_note })}
            voiceOnly
            allowSave={false}
          />
        );
      }
      return (
        <FieldBlock label={t('automations.messageText')}>
          <Textarea
            value={(cfg.text as string) ?? ''}
            onChange={(e) => set({ text: e.target.value })}
            placeholder={t('automations.messageTextPlaceholder')}
            className="bg-muted text-foreground min-h-24"
          />
        </FieldBlock>
      );
    case 'send_template': {
      const abTest = cfg.ab_test as
        | {
            id: string;
            variants: Array<{
              id: 'a' | 'b';
              template_name: string;
              language?: string;
              variables?: Record<string, string>;
              weight: number;
            }>;
          }
        | undefined;
      const seedFor = (name: string) => {
        const tpl = templates.find((tp) => tp.name === name);
        const declared = (tpl?.variable_fields ?? {}) as Record<string, string>;
        return {
          template_name: name,
          language: tpl?.language ?? 'es',
          variables: Object.fromEntries(
            Object.entries(declared).map(([n, key]) => [n, `{{vars.${key}}}`])
          ),
        };
      };
      const changeVariant = (id: 'a' | 'b', name: string) => {
        if (!abTest) return;
        set({
          ab_test: {
            ...abTest,
            variants: abTest.variants.map((v) =>
              v.id === id ? { ...v, ...seedFor(name) } : v
            ),
          },
        });
      };
      const changeWeight = (id: 'a' | 'b', value: number) => {
        if (!abTest) return;
        const weight = Math.max(
          0,
          Math.min(100, Number.isFinite(value) ? Math.round(value) : 0)
        );
        set({
          ab_test: {
            ...abTest,
            variants: abTest.variants.map((v) =>
              v.id === id ? { ...v, weight } : { ...v, weight: 100 - weight }
            ),
          },
        });
      };
      const selectedTemplateName =
        abTest?.variants.find((v) => v.id === 'a')?.template_name ??
        String(cfg.template_name ?? '');
      const selectedTpl = templates.find(
        (tp) => tp.name === selectedTemplateName
      );
      const previewTemplates = abTest
        ? abTest.variants.flatMap((variant) => {
            const template = templates.find(
              (candidate) => candidate.name === variant.template_name
            );
            return template
              ? [
                  {
                    id: variant.id,
                    template,
                    variables: variant.variables ?? {},
                  },
                ]
              : [];
          })
        : selectedTpl
          ? [
              {
                id: null,
                template: selectedTpl,
                variables:
                  (cfg.variables as Record<string, string> | undefined) ?? {},
              },
            ]
          : [];
      const varIndices = selectedTpl
        ? extractVariables(selectedTpl.body_text ?? '')
        : [];
      const variables =
        (cfg.variables as Record<string, string> | undefined) ?? {};
      const setVar = (n: number, value: string) => {
        const next = { ...variables };
        if (value) next[String(n)] = value;
        else delete next[String(n)];
        set({ variables: next });
      };
      return (
        <>
          <div className="border-border bg-muted/30 mb-3 flex items-center justify-between rounded-md border px-3 py-2">
            <span className="text-foreground text-sm font-medium">
              {t('automations.abTest')}
            </span>
            <Switch
              checked={Boolean(abTest)}
              onCheckedChange={(enabled) => {
                if (!enabled) set({ ab_test: undefined });
                else
                  set({
                    ab_test: {
                      id: `ab_${cid()}`,
                      variants: [
                        {
                          id: 'a',
                          ...seedFor(String(cfg.template_name ?? '')),
                          weight: 50,
                        },
                        { id: 'b', ...seedFor(''), weight: 50 },
                      ],
                    },
                  });
              }}
            />
          </div>
          {abTest ? (
            <div className="border-border mb-3 space-y-3 rounded-md border p-3">
              {abTest.variants.map((variant) => (
                <div
                  key={variant.id}
                  className="grid grid-cols-[minmax(0,1fr)_3.25rem] items-center gap-1.5"
                >
                  <select
                    value={variant.template_name}
                    onChange={(e) => changeVariant(variant.id, e.target.value)}
                    className="border-border bg-muted text-foreground w-full min-w-0 rounded-md border px-2 py-1.5 text-sm"
                  >
                    <option value="">{t('automations.chooseTemplate')}</option>
                    {templates.map((tpl) => (
                      <option
                        key={tpl.id}
                        value={tpl.name}
                      >{`${variant.id.toUpperCase()} · ${tpl.name}`}</option>
                    ))}
                  </select>
                  <Input
                    aria-label={`${t('automations.abTraffic')} ${variant.id.toUpperCase()}`}
                    type="number"
                    min="0"
                    max="100"
                    value={variant.weight}
                    className="min-w-0 px-1 text-center"
                    onChange={(e) =>
                      changeWeight(variant.id, Number(e.target.value))
                    }
                  />
                </div>
              ))}
              <p className="text-muted-foreground text-xs">
                {t('automations.abTestHint')}
              </p>
            </div>
          ) : (
            <FieldBlock label={t('automations.whatsappTemplate')}>
              {templates.length > 0 ? (
                <select
                  value={(cfg.template_name as string) ?? ''}
                  onChange={(e) => {
                    const tpl = templates.find(
                      (tp) => tp.name === e.target.value
                    );
                    // Cambiar de plantilla descarta el mapeo previo (los {{n}} de
                    // la nueva no se corresponden) y PRE-MAPEA desde el campo que
                    // la plantilla declaró para cada variable ({ "1": "customer_name" }
                    // → {{vars.customer_name}}). Así no hay que mapear a mano.
                    const declared = (tpl?.variable_fields ?? {}) as Record<
                      string,
                      string
                    >;
                    const seeded = Object.fromEntries(
                      Object.entries(declared).map(([n, key]) => [
                        n,
                        `{{vars.${key}}}`,
                      ])
                    );
                    set({
                      template_name: e.target.value,
                      language: tpl?.language ?? 'es',
                      variables: seeded,
                    });
                  }}
                  className="border-border bg-muted text-foreground focus:border-primary w-full rounded-md border px-2 py-1.5 text-sm focus:outline-none"
                >
                  <option value="">{t('automations.chooseTemplate')}</option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.name}>
                      {tpl.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="border-border bg-muted/40 text-muted-foreground rounded-md border border-dashed px-3 py-2 text-xs">
                  {t('automations.noApprovedTemplates')}{' '}
                  <Link
                    href="/plantillas"
                    className="text-accent-ink underline hover:opacity-80"
                  >
                    {t('automations.createOne')}
                  </Link>
                  .
                </p>
              )}
            </FieldBlock>
          )}
          {abTest && automationId && step.serverId ? (
            <AbTestResults automationId={automationId} stepId={step.serverId} />
          ) : abTest ? (
            <div className="border-border text-muted-foreground mt-3 rounded-md border px-3 py-2 text-xs">
              {t('automations.abMetricsSaveFirst')}
            </div>
          ) : null}
          {varIndices.length > 0 && (
            <FieldBlock label={t('automations.templateVariables')}>
              <div className="space-y-2">
                {varIndices.map((n) => (
                  <div key={n} className="flex items-center gap-2">
                    <span className="border-border bg-muted text-muted-foreground w-9 shrink-0 rounded-md border px-1.5 py-1 text-center text-xs font-medium tabular-nums">
                      {`{{${n}}}`}
                    </span>
                    <select
                      value={variables[String(n)] ?? ''}
                      onChange={(e) => setVar(n, e.target.value)}
                      className="border-border bg-muted text-foreground focus:border-primary w-full rounded-md border px-2 py-1.5 text-sm focus:outline-none"
                    >
                      <option value="">
                        {t('automations.chooseVariable')}
                      </option>
                      {templateDataPoints(trigger, { hasVoiceCall }).map(
                        (dp) => (
                          <option
                            key={dp.id}
                            value={`{{vars.${dp.templateVarKey}}}`}
                          >
                            {t(dp.labelKey)}
                          </option>
                        )
                      )}
                    </select>
                  </div>
                ))}
              </div>
              {varIndices.some((n) => !variables[String(n)]) && (
                <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                  {t('automations.templateVarsUnmapped')}
                </p>
              )}
            </FieldBlock>
          )}
          {previewTemplates.length > 0 && (
            <div className="border-border mt-3 border-t pt-3">
              <button
                type="button"
                onClick={() => setShowPreview((v) => !v)}
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[11px] font-medium transition-colors"
              >
                <ChevronDown
                  className={cn(
                    'h-3 w-3 transition-transform',
                    showPreview ? 'rotate-180' : ''
                  )}
                />
                {t('automations.preview')}
              </button>
              {showPreview &&
                (() => {
                  const index = previewVariantIndex % previewTemplates.length;
                  const current = previewTemplates[index];
                  return (
                    <div className="mt-2">
                      {previewTemplates.length > 1 && (
                        <div className="mb-2 flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() =>
                              setPreviewVariantIndex(
                                (i) =>
                                  (i + previewTemplates.length - 1) %
                                  previewTemplates.length
                              )
                            }
                            className="text-muted-foreground hover:text-foreground flex h-7 w-7 items-center justify-center rounded"
                            aria-label={t('automations.abPreviousPreview')}
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </button>
                          <span className="text-muted-foreground text-xs font-medium">
                            {current.id?.toUpperCase()}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setPreviewVariantIndex(
                                (i) => (i + 1) % previewTemplates.length
                              )
                            }
                            className="text-muted-foreground hover:text-foreground flex h-7 w-7 items-center justify-center rounded"
                            aria-label={t('automations.abNextPreview')}
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                      <WhatsappPreview
                        headerType={
                          (current.template.header_type ??
                            'none') as TemplateHeaderType
                        }
                        headerText={
                          current.template.header_content ?? undefined
                        }
                        bodyText={(current.template.body_text || '').replace(
                          /\{\{\s*(\d+)\s*\}\}/g,
                          (_, n) => {
                            const m = (
                              current.variables[String(n)] ?? ''
                            ).match(/\{\{vars\.(\w+)\}\}/);
                            return (m && SAMPLE_BY_VAR[m[1]]) || `{{${n}}}`;
                          }
                        )}
                        footerText={current.template.footer_text ?? undefined}
                        buttons={
                          (current.template.buttons as unknown as
                            | TemplateButtonInput[]
                            | null) ?? undefined
                        }
                      />
                    </div>
                  );
                })()}
            </div>
          )}
        </>
      );
    }
    case 'add_tag':
    case 'remove_tag':
      return (
        <FieldBlock label={t('automations.tag')}>
          <TagSelect
            value={(cfg.tag_id as string) ?? ''}
            onChange={(v) => set({ tag_id: v })}
            allowCreate
          />
        </FieldBlock>
      );
    case 'assign_conversation':
      return (
        <>
          <FieldBlock label={t('automations.whoToAssign')}>
            <select
              value={(cfg.mode as string) ?? 'round_robin'}
              onChange={(e) => set({ mode: e.target.value })}
              className="border-border bg-muted text-foreground w-full rounded-md border px-2 py-1.5 text-sm"
            >
              <option value="round_robin">
                {t('automations.assignRoundRobin')}
              </option>
              <option value="specific">
                {t('automations.assignSpecific')}
              </option>
            </select>
          </FieldBlock>
          {cfg.mode === 'specific' && (
            <FieldBlock label={t('automations.person')}>
              <AgentSelect
                value={(cfg.agent_id as string) ?? ''}
                onChange={(v) => set({ agent_id: v })}
              />
            </FieldBlock>
          )}
        </>
      );
    case 'update_contact_field':
      return (
        <>
          <FieldBlock label={t('automations.whichField')}>
            <select
              value={(cfg.field as string) ?? 'name'}
              onChange={(e) => set({ field: e.target.value })}
              className="border-border bg-muted text-foreground w-full rounded-md border px-2 py-1.5 text-sm"
            >
              <option value="name">{t('automations.fieldName')}</option>
              <option value="email">{t('automations.fieldEmail')}</option>
              <option value="company">{t('automations.fieldCompany')}</option>
            </select>
          </FieldBlock>
          <FieldBlock label={t('automations.newValue')}>
            <Input
              value={(cfg.value as string) ?? ''}
              onChange={(e) => set({ value: e.target.value })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
        </>
      );
    case 'wait':
      return (
        <div className="grid grid-cols-2 gap-2">
          <FieldBlock label={t('automations.amount')}>
            <Input
              type="number"
              min={1}
              value={(cfg.amount as number) ?? 1}
              onChange={(e) =>
                set({ amount: Math.max(1, Number(e.target.value)) })
              }
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t('automations.unit')}>
            <select
              value={(cfg.unit as string) ?? 'hours'}
              onChange={(e) => set({ unit: e.target.value })}
              className="border-border bg-muted text-foreground w-full rounded-md border px-2 py-1.5 text-sm"
            >
              <option value="seconds">{t('automations.unitSeconds')}</option>
              <option value="minutes">{t('automations.unitMinutes')}</option>
              <option value="hours">{t('automations.unitHours')}</option>
              <option value="days">{t('automations.unitDays')}</option>
            </select>
          </FieldBlock>
        </div>
      );
    case 'condition':
      return <ConditionFields cfg={cfg} set={set} />;

    case 'switch':
      return <SwitchPathsEditor step={step} onChange={onChange} />;

    case 'send_webhook':
      return (
        <>
          <FieldBlock label={t('automations.url')}>
            <Input
              value={(cfg.url as string) ?? ''}
              onChange={(e) => set({ url: e.target.value })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t('automations.bodyTemplateJson')}>
            <Textarea
              value={(cfg.body_template as string) ?? ''}
              onChange={(e) => set({ body_template: e.target.value })}
              className="bg-muted text-foreground min-h-20 font-mono text-xs"
            />
          </FieldBlock>
        </>
      );
    case 'voice_call':
      return <VoiceCallStepEditor cid={step.cid} cfg={cfg} set={set} />;
    case 'close_conversation':
      return null;
    default:
      return null;
  }
}

/**
 * La tarjeta de la llamada: quién llama, y qué pasa si no contestan.
 *
 * Antes tenía tres controles y un callejón sin salida. El selector sólo
 * listaba agentes con la voz ya activada, así que una cuenta recién armada
 * leía «Ningún agente tiene voz activada» y ahí se terminaba: sin link, sin
 * botón y sin decir que además hacía falta un número. Y el interruptor
 * «Esperar el resultado» ofrecía, en su posición de apagado, seguir con los
 * pasos siguientes mientras el teléfono todavía sonaba.
 *
 * Quedan: el agente (identidad y voz), el motivo comercial y la rama
 * «si no contesta». El comercio no necesita escribir un prompt para cada
 * pedido: los escenarios traen un objetivo seguro y permiten sumar un detalle.
 */
const VOICE_SCENARIO_OPTIONS = [
  'automatic',
  'thank_order',
  'confirm_cod',
  'cart_recovery',
  'payment_recovery',
  'delivery_update',
  'customer_followup',
  'custom',
] as const;

const VOICE_SCENARIO_LABEL: Record<string, string> = {
  automatic: 'automations.voiceScenarioAutomatic',
  thank_order: 'automations.voiceScenarioThankOrder',
  confirm_cod: 'automations.voiceScenarioConfirmCod',
  cart_recovery: 'automations.voiceScenarioCartRecovery',
  payment_recovery: 'automations.voiceScenarioPaymentRecovery',
  delivery_update: 'automations.voiceScenarioDeliveryUpdate',
  customer_followup: 'automations.voiceScenarioCustomerFollowup',
  custom: 'automations.voiceScenarioCustom',
};

function VoiceCallStepEditor({
  cid: stepCid,
  cfg,
  set,
}: {
  cid: string;
  cfg: Record<string, unknown>;
  set: (patch: Record<string, unknown>) => void;
}) {
  const t = useT();
  const { workspace } = useWorkspace();
  const rama = useContext(RamaLlamadaContext);
  const [agents, setAgents] = useState<
    {
      id: string;
      name: string;
      voice_enabled: boolean;
      is_active: boolean;
      scope?: string | null;
      ai_agent_channels?: { channel: string }[];
    }[]
  >([]);
  const [loading, setLoading] = useState(true);
  /** Lo que le falta a la cuenta para que suene un teléfono (número, freno
   *  de emergencia, tope del mes). El agente lo resuelve la lista de arriba. */
  const [faltaEnLaCuenta, setFaltaEnLaCuenta] = useState<
    { code: string; fixHref: string | null }[]
  >([]);

  useEffect(() => {
    if (!workspace?.id) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(
        `/api/ai/agents?workspace_id=${workspace.id}`,
        { cache: 'no-store' }
      );
      if (!res.ok || cancelled) return;
      const json = (await res.json()) as {
        agents?: {
          id: string;
          name: string;
          voice_enabled: boolean;
          is_active: boolean;
          scope?: string | null;
          ai_agent_channels?: { channel: string }[];
        }[];
      };
      setAgents(
        (json.agents ?? []).filter(
          (agent) => agent.is_active && agent.voice_enabled
        )
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [workspace?.id]);

  // Lo que falta a nivel cuenta se pregunta UNA vez, al mismo sitio que lo
  // decide la cola: así la tarjeta no puede decir "listo" sobre una cuenta
  // que no tiene número.
  useEffect(() => {
    if (!workspace?.id) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(
        `/api/voice/readiness?workspace_id=${workspace.id}`,
        {
          cache: 'no-store',
        }
      );
      if (!res.ok || cancelled) return;
      const json = (await res.json()) as {
        blockers?: { code: string; fixHref: string | null }[];
      };
      if (!cancelled) {
        setFaltaEnLaCuenta(
          (json.blockers ?? []).filter(
            (b) => b.code !== 'no_voice_agent' && b.code !== 'voice_disabled'
          )
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspace?.id]);

  const agentId = (cfg.agent_id as string) ?? '';
  const scenario = (cfg.scenario as string) || 'automatic';
  const yaRamifica = rama?.yaTiene(stepCid) ?? false;

  return (
    <>
      <FieldBlock label={t('automations.voiceCallAgent')}>
        {loading ? (
          <p className="text-muted-foreground text-xs">{t('common.loading')}</p>
        ) : agents.length === 0 ? (
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs">
              {t('automations.voiceCallNoAgents')}
            </p>
            <Link
              href="/voz"
              className="border-border bg-background hover:bg-muted inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium text-foreground transition-colors"
            >
              <Plus className="size-3.5" />
              {t('automations.voiceCallCreateAgent')}
            </Link>
          </div>
        ) : (
          <select
            value={agentId}
            onChange={(e) => {
              // El nombre viaja con el paso para que la tarjeta cerrada diga
              // quién llama sin volver a consultar la base.
              const a = agents.find((x) => x.id === e.target.value);
              set({ agent_id: e.target.value, agent_name: a?.name ?? '' });
            }}
            className="border-border bg-muted text-foreground w-full rounded-md border px-2 py-1.5 text-sm"
          >
            <option value="">{t('automations.voiceCallPickAgent')}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
      </FieldBlock>

      <p className="border-border bg-muted/30 text-muted-foreground rounded-lg border px-3 py-2 text-[11px]">
        {t('automations.voiceCallAgentHint')}
      </p>

      {agentId && (
        <>
      {/* Lo que falta, con el link que lo arregla. Es el reemplazo del
          callejón sin salida: un paso que no va a sonar lo dice acá, no tres
          días después cuando entre un pedido. */}
      {faltaEnLaCuenta.map((b) => (
        <Aviso
          key={b.code}
          texto={t(`voice.${claveDeBloqueo(b.code)}`)}
          accion={b.fixHref ? t('voice.blockedFix') : undefined}
          href={b.fixHref ?? undefined}
        />
      ))}

      <FieldBlock label={t('automations.voiceCallScenario')}>
        <select
          value={scenario}
          onChange={(event) => set({
            scenario: event.target.value === 'automatic' ? '' : event.target.value,
          })}
          className="border-border bg-muted text-foreground w-full rounded-md border px-2 py-1.5 text-sm"
        >
          {VOICE_SCENARIO_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {t(VOICE_SCENARIO_LABEL[option])}
            </option>
          ))}
        </select>
        <p className="text-muted-foreground mt-1 text-[11px]">
          {scenario === 'automatic'
            ? t('automations.voiceScenarioAutomaticHint')
            : t('automations.voiceCallScenarioHint')}
        </p>
      </FieldBlock>

      <FieldBlock label={scenario === 'custom'
        ? t('automations.voiceCallObjective')
        : t('automations.voiceCallDetail')}>
        <Textarea
          value={(cfg.objective_override as string) ?? ''}
          onChange={(e) => set({ objective_override: e.target.value })}
          placeholder={scenario === 'custom'
            ? t('automations.voiceCallObjectivePlaceholder')
            : t('automations.voiceCallDetailPlaceholder')}
          className="bg-muted text-foreground min-h-16"
        />
        <p className="text-muted-foreground mt-1 text-[11px]">
          {scenario === 'custom'
            ? t('automations.voiceCallCustomHint')
            : t('automations.voiceCallDetailHint')}
        </p>
      </FieldBlock>

      {/* La rama que hace útil a la llamada. */}
      {rama && (
        <FieldBlock label={t('automations.voiceCallIfNoAnswer')}>
          {yaRamifica ? (
            <p className="text-muted-foreground text-xs">
              {t('automations.voiceCallBranchDone')}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => rama.armar(stepCid)}
              className="border-border bg-background text-muted-foreground hover:border-primary hover:bg-primary/10 hover:text-accent-ink inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors"
            >
              <Plus className="size-3.5" />
              {t('automations.voiceCallBuildBranch')}
            </button>
          )}
        </FieldBlock>
      )}
        </>
      )}
    </>
  );
}

/** El código de bloqueo, como clave del catálogo (`kill_switch` → `blockedKillSwitch`). */
function claveDeBloqueo(code: string): string {
  return `blocked${code
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')}`;
}

/** Fila ámbar: qué falta y dónde se arregla. */
function Aviso({
  texto,
  accion,
  href,
}: {
  texto: string;
  accion?: string;
  href?: string;
}) {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      {texto}
      {accion && href && (
        <Link href={href} className="underline">
          {accion}
        </Link>
      )}
    </p>
  );
}

function FieldBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2 last:mb-0">
      <label className="text-muted-foreground mb-1 block text-xs font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

// i18n key pairs [singular, plural] for the wait-step preview, resolved
// with t() inside previewFor.
const WAIT_UNIT_LABELS: Record<string, [string, string]> = {
  seconds: ['automations.waitSecondOne', 'automations.waitSecondOther'],
  minutes: ['automations.waitMinuteOne', 'automations.waitMinuteOther'],
  hours: ['automations.waitHourOne', 'automations.waitHourOther'],
  days: ['automations.waitDayOne', 'automations.waitDayOther'],
};

/** One-line natural summary of a condition, e.g. "Unidades que compró al menos 4". */
function conditionPreview(cfg: Record<string, unknown>, t: TFn): string {
  const subject = cfg.subject as string | undefined;
  const operand = cfg.operand as string | undefined;
  if (!subject) return t('automations.previewDefineCondition');
  if (subject === 'time_of_day')
    return operand
      ? `${t('automations.dpTimeOfDay')}: ${operand}`
      : t('automations.previewDefineCondition');
  const id = datoDeCfg(subject, operand, DATA_POINTS);
  const dp = id && id !== TIME_DP_ID ? dataPointById(id) : undefined;
  if (!dp) return t('automations.previewDefineCondition');
  const label = t(dp.labelKey);
  const kind = dp.condition.kind;
  if (kind === 'tag' || kind === 'segment') return label;
  // Sin ventana que mostrar: el lado ya lo dice todo ("No pagó").
  if (kind === 'order_paid') {
    return cfg.value === 'true'
      ? t(SIDE_LABEL.order_paid.yes)
      : t(SIDE_LABEL.order_paid.no);
  }
  if (kind === 'purchased' || kind === 'messaged' || kind === 'rejected_open') {
    // "No compró · en las últimas 3 horas". El renderer de booleanos genérico
    // reutilizaba el texto de "ya compró alguna vez", que acá no viene al
    // caso: la pregunta es sobre la ventana, no sobre el histórico.
    const side =
      cfg.value === 'true' ? t(SIDE_LABEL[kind].yes) : t(SIDE_LABEL[kind].no);
    const w = String(operand ?? 'since_trigger');
    if (w === 'since_trigger')
      return `${side} · ${t('automations.windowSinceTrigger')}`;
    if (w === 'ever') return `${side} · ${t('automations.windowEver')}`;
    const m = /^([0-9]+)([mhd])$/.exec(String(operand ?? '24h'));
    const n = m ? m[1] : '24';
    const u = m ? m[2] : 'h';
    const unitKey =
      u === 'm'
        ? 'automations.unitMinutes'
        : u === 'd'
          ? 'automations.unitDays'
          : 'automations.unitHours';
    return `${side} · ${t('automations.condWindowLabel').toLowerCase()} ${n} ${t(unitKey).toLowerCase()}`;
  }
  if (kind === 'message') return `${label}: "${(cfg.value as string) ?? ''}"`;
  const opKey = NUMBER_OPS.find((o) => o.op === (cfg.op ?? 'eq'))?.key;
  const opLabel = opKey ? t(opKey) : '';
  // Un dato de lista muestra su etiqueta, no el valor interno. La tarjeta
  // decía "Estado de la llamada igual a completed": el comercio no tiene por
  // qué leer en inglés el nombre que le pusimos a una columna.
  const opcion = dp.options?.find((o) => o.value === cfg.value);
  const val =
    dp.valueKind === 'bool'
      ? cfg.value === 'false'
        ? t('automations.repeatCustomerNo')
        : t('automations.repeatCustomerYes')
      : opcion
        ? t(opcion.labelKey)
        : ((cfg.value as string) ?? '');
  const v2 =
    cfg.op === 'between' && cfg.value2
      ? ` ${t('automations.condAnd')} ${cfg.value2}`
      : '';
  return `${label} ${dp.valueKind === 'bool' ? '' : opLabel} ${val}${v2}`
    .replace(/\s+/g, ' ')
    .trim();
}

function previewFor(
  step: BuilderStep,
  t: TFn,
  etiquetas: ContactTag[] = []
): string {
  switch (step.step_type) {
    case 'add_tag':
    case 'remove_tag': {
      // Sin esto las dos tarjetas de etiqueta del rescate de carrito son
      // indistinguibles: mismo icono, mismo título y el resumen vacío. Abrir
      // la equivocada y cambiarle la etiqueta deja marcados como recuperados
      // a los que abandonaron — la métrica al revés, sin ningún error visible.
      const id = step.step_config.tag_id as string | undefined;
      if (!id) return t('automations.chooseTag');
      return etiquetas.find((e) => e.id === id)?.name ?? id;
    }
    case 'send_message':
      return (
        (step.step_config.text as string) || t('automations.previewNoTextYet')
      );
    case 'send_template':
      return (
        (step.step_config.template_name as string) ||
        t('automations.previewChooseTemplate')
      );
    case 'wait': {
      const amount = Number(step.step_config.amount ?? 0);
      const unit = String(step.step_config.unit ?? 'hours');
      const [one, many] = WAIT_UNIT_LABELS[unit] ?? ['', ''];
      if (!amount) return t('automations.previewDefineWait');
      return `${amount} ${amount === 1 ? (one ? t(one) : '') : many ? t(many) : ''}`;
    }
    case 'condition':
      return conditionPreview(step.step_config, t);
    case 'switch': {
      const cases = step.switchData?.cases ?? [];
      if (cases.length === 0) return t('automations.switchNeedsData');
      // One path reads as a plain Sí/No; several show the count.
      if (cases.length === 1) return conditionPreview(cases[0].cfg, t);
      return t('automations.switchCaseOther', { n: cases.length });
    }
    case 'send_webhook':
      return (step.step_config.url as string) || t('automations.previewNoUrl');
    case 'voice_call': {
      // El nombre del agente, que es la única decisión de la tarjeta. Antes
      // decía «Llamada con IA» tanto si estaba lista como si no, así que un
      // paso sin configurar se veía igual que uno sano.
      const nombre = (step.step_config.agent_name as string) ?? '';
      if (!(step.step_config.agent_id as string)) {
        return t('automations.voiceCallPreviewPickAgent');
      }
      const scenario = (step.step_config.scenario as string) || 'automatic';
      const reason = t(VOICE_SCENARIO_LABEL[scenario] ?? VOICE_SCENARIO_LABEL.automatic);
      return `${nombre || t('automations.voiceCallPreview')} · ${reason}`;
    }
    default:
      return '';
  }
}

// ------------------------------------------------------------
// Tree mutation helpers
// ------------------------------------------------------------

// Serialize builder tree → API payload (flattened shape)
// ------------------------------------------------------------

interface ApiStep {
  /**
   * El id con el que ya vive el paso en la base, cuando lo tiene.
   *
   * Guardar borra todos los pasos y los vuelve a insertar. Sin mandar el id,
   * cada guardado le da uno NUEVO a cada paso, y las corridas dormidas en una
   * espera guardan a qué paso volver: quedan apuntando a filas que ya no
   * existen. Mientras la única espera vivía en el tronco eso no se notaba;
   * con la espera de dos días del rescate de carrito, editar la automatización
   * en el medio devolvía la corrida al tronco y le mandaba la plantilla otra
   * vez a quien ya la había recibido.
   */
  id?: string;
  step_type: string;
  step_config: Record<string, unknown>;
  branches?: { yes?: ApiStep[]; no?: ApiStep[] };
}

export function toApiSteps(steps: BuilderStep[]): ApiStep[] {
  const out: ApiStep[] = [];
  for (const s of steps) {
    if (s.step_type === 'switch') {
      // Compile the multi-path node to the nested binary-condition spine the
      // engine runs. With no cases at all, only the "en otro caso" path
      // persists, so the save still validates.
      const cases = s.switchData?.cases ?? [];
      if (cases.length === 0) {
        out.push(...toApiSteps(s.switchData?.elseSteps ?? []));
        continue;
      }
      const compiled = compileSwitch<BuilderStep>(s.switchData, toApiSteps);
      if (compiled) out.push(compiled as ApiStep);
      else out.push(...toApiSteps(s.switchData?.elseSteps ?? []));
      continue;
    }
    out.push({
      id: s.serverId,
      step_type: s.step_type,
      step_config: s.step_config,
      branches: s.branches
        ? { yes: toApiSteps(s.branches.yes), no: toApiSteps(s.branches.no) }
        : undefined,
    });
  }
  return out;
}

/**
 * Convert server-returned step tree (from loadStepsTree) into the
 * builder-local shape with client ids.
 */
export interface ServerStepNode {
  id: string;
  step_type: string;
  step_config: Record<string, unknown>;
  branches: { yes: ServerStepNode[]; no: ServerStepNode[] };
}

// ------------------------------------------------------------
// Canvas viewport — pan + zoom around the trigger/step flow.
// Keeps node geometry as plain flex layout so the existing add/move/delete
// logic is untouched; this wrapper only transforms the viewport.
// ------------------------------------------------------------

const MIN_SCALE = 0.25;
const MAX_SCALE = 2;

function clampScale(s: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/** Selectors a click on which should not start a pan — the user is
 *  trying to interact with a control, not move the canvas. */
const INTERACTIVE_SELECTOR =
  'input, textarea, select, button, a, label, [role="switch"], [role="combobox"], [role="button"], [role="textbox"], [contenteditable="true"], [data-drag-handle]';

function CanvasViewport({
  children,
  focusRequest,
}: {
  children: React.ReactNode;
  focusRequest: { cid: string; sequence: number } | null;
}) {
  const t = useT();
  const arrastre = useContext(DragContext);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const hasCenteredRef = useRef(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startTx: number;
    startTy: number;
  } | null>(null);

  const zoomAt = useCallback(
    (clientX: number, clientY: number, nextScale: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const ox = clientX - rect.left;
      const oy = clientY - rect.top;
      const next = clampScale(nextScale);
      const ratio = next / scale;
      setTx(ox - (ox - tx) * ratio);
      setTy(oy - (oy - ty) * ratio);
      setScale(next);
    },
    [scale, tx, ty]
  );

  /** Frame the workflow into the viewport with comfortable padding,
   *  scaling down if it doesn't fit at 100%. Used on first mount and
   *  whenever the user hits the "Centrar" button. */
  const fitToView = useCallback(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;
    // The content is rendered at scale 1 inside the transform; clientWidth
    // reflects its untransformed layout size.
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const w = content.scrollWidth;
    const h = content.scrollHeight;
    if (!w || !h) return;
    const padding = 80;
    const scaleFit = Math.min(1, (cw - padding) / w, (ch - padding) / h);
    const s = clampScale(scaleFit);
    setScale(s);
    setTx((cw - w * s) / 2);
    setTy((ch - h * s) / 2);
  }, []);

  // Center the chain on first paint so the trigger card isn't pinned
  // against the left edge.
  useEffect(() => {
    if (hasCenteredRef.current) return;
    const id = requestAnimationFrame(() => {
      fitToView();
      hasCenteredRef.current = true;
    });
    return () => cancelAnimationFrame(id);
  }, [fitToView]);

  // Centra la tarjeta incompleta con cualquier zoom o paneo actual.
  useEffect(() => {
    if (!focusRequest) return;
    const frame = requestAnimationFrame(() => {
      const container = containerRef.current;
      const content = contentRef.current;
      const target = content?.querySelector<HTMLElement>(
        `[data-step-cid="${focusRequest.cid}"]`
      );
      if (!container || !target) return;
      const viewport = container.getBoundingClientRect();
      const card = target.getBoundingClientRect();
      setTx(
        (value) =>
          value +
          viewport.left +
          viewport.width / 2 -
          (card.left + card.width / 2)
      );
      setTy(
        (value) =>
          value +
          viewport.top +
          viewport.height / 2 -
          (card.top + card.height / 2)
      );
      target
        .querySelector<HTMLElement>('select, input, textarea, button')
        ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest]);

  // Native wheel listener — React's synthetic onWheel is passive in React 19,
  // so preventDefault() inside the handler is a no-op there. Bind manually.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.0015);
        zoomAt(e.clientX, e.clientY, scale * factor);
      } else {
        // Plain wheel / trackpad two-finger → pan.
        e.preventDefault();
        setTx((v) => v - e.deltaX);
        setTy((v) => v - e.deltaY);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scale, zoomAt]);

  // Pointer-based pan + pinch-zoom. Pointer Events cover mouse, touch and
  // pen, so the builder pans with one finger and pinch-zooms with two on a
  // phone/tablet — not just left-drag on desktop. Middle mouse still pans.
  // Clicks on form controls/buttons pass through so inputs/menus keep
  // working. `touch-action: none` on the container (below) stops the page
  // from scrolling/zooming under the gesture. setPointerCapture replaces the
  // old window-level mouse listeners.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{
    startDist: number;
    startScale: number;
    cx: number;
    cy: number;
  } | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    // Con una tarjeta en la mano, el lienzo no se mueve. Si se moviera, el
    // hueco al que se apunta se corre justo mientras se apunta, y soltar se
    // vuelve adivinanza.
    if (arrastre.arrastrando) return;
    const target = e.target as HTMLElement;
    if (target.closest(INTERACTIVE_SELECTOR)) return;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;

    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture?.(e.pointerId);

    if (pointersRef.current.size === 2) {
      dragRef.current = null;
      setDragging(false);
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = {
        startDist: Math.hypot(a.x - b.x, a.y - b.y),
        startScale: scale,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
      };
    } else if (pointersRef.current.size === 1) {
      e.preventDefault();
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startTx: tx,
        startTy: ty,
      };
      setDragging(true);
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (arrastre.arrastrando) return;
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinchRef.current && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchRef.current.startDist > 0) {
        const ratio = dist / pinchRef.current.startDist;
        zoomAt(
          pinchRef.current.cx,
          pinchRef.current.cy,
          pinchRef.current.startScale * ratio
        );
      }
      return;
    }
    if (dragRef.current) {
      setTx(dragRef.current.startTx + (e.clientX - dragRef.current.startX));
      setTy(dragRef.current.startTy + (e.clientY - dragRef.current.startY));
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) {
      dragRef.current = null;
      setDragging(false);
    }
  }

  function zoomByButton(delta: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAt(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      scale + delta
    );
  }

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      // touch-action:none so one finger pans and two fingers pinch-zoom the
      // canvas instead of scrolling/zooming the page. No effect with a mouse.
      style={{ touchAction: 'none' }}
      className={cn(
        'relative flex-1 overflow-hidden select-none',
        dragging ? 'cursor-grabbing' : 'cursor-grab'
      )}
    >
      {/* Dot grid — moves with the viewport so panning feels physical. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle, var(--border) 1px, transparent 1px)',
          backgroundSize: `${20 * scale}px ${20 * scale}px`,
          backgroundPosition: `${tx}px ${ty}px`,
        }}
      />

      <div
        ref={contentRef}
        className="origin-top-left cursor-auto will-change-transform"
        style={{
          transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`,
        }}
      >
        {children}
      </div>

      {/* Zoom + reset controls */}
      <div className="border-border bg-card/95 absolute right-4 bottom-4 flex items-center gap-0.5 rounded-lg border px-1 py-1 shadow-lg backdrop-blur">
        <button
          type="button"
          onClick={() => zoomByButton(-0.1)}
          className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-10 w-10 items-center justify-center rounded transition-colors lg:h-auto lg:w-auto lg:p-1.5"
          title={t('automations.zoomOutTitle')}
          aria-label={t('automations.zoomOut')}
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={fitToView}
          className="text-muted-foreground hover:bg-accent hover:text-foreground min-w-[3.5rem] rounded px-1 py-1 text-center text-xs tabular-nums transition-colors"
          title={t('automations.centerAndFit')}
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          onClick={() => zoomByButton(0.1)}
          className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-10 w-10 items-center justify-center rounded transition-colors lg:h-auto lg:w-auto lg:p-1.5"
          title={t('automations.zoomInTitle')}
          aria-label={t('automations.zoomIn')}
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <div className="bg-border mx-1 h-4 w-px" />
        <button
          type="button"
          onClick={fitToView}
          className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-10 w-10 items-center justify-center rounded transition-colors lg:h-auto lg:w-auto lg:p-1.5"
          title={t('automations.centerFlowTitle')}
          aria-label={t('automations.center')}
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** True when every step is a flat action (no branches, not a switch/condition)
 *  → safe to render inside a self-contained switch case/else lane. */
function allLeaf(steps: BuilderStep[]): boolean {
  return steps.every(
    (s) =>
      !s.branches && s.step_type !== 'switch' && s.step_type !== 'condition'
  );
}

export function fromServerSteps(nodes: StepShape[]): BuilderStep[] {
  return nodes.map((n) => {
    // Collapse a switch-shaped same-data-point condition chain back into one
    // multi-case node — but only when every case + else is a flat action list.
    // Anything with nested branching stays as plain conditions so no step is
    // ever hidden by the leaf-only switch card.
    if (n.step_type === 'condition') {
      const sd = collapseSwitch<BuilderStep>(n, fromServerSteps, cid);
      // Present as the unified multi-path "Condición" card ONLY when every path
      // + the "en otro caso" is a flat action list — each case now edits its own
      // filter via ConditionFields, so any data point (number/offer/tag/segment/
      // time/…) is fine. A branch that itself branches stays a plain binary
      // condition card so no step is ever hidden.
      if (
        sd &&
        sd.cases.every((c) => allLeaf(c.steps)) &&
        allLeaf(sd.elseSteps)
      ) {
        return {
          cid: cid(),
          step_type: 'switch' as BuilderStepType,
          step_config: {},
          switchData: sd,
        };
      }
    }
    return {
      cid: cid(),
      // Preserve the persisted id (present on ServerStepNode) so the live
      // "waiting" count can be keyed back to this exact step.
      serverId: (n as { id?: string }).id,
      step_type: n.step_type as BuilderStepType,
      step_config: n.step_config ?? {},
      branches:
        n.step_type === 'condition'
          ? {
              yes: fromServerSteps(n.branches?.yes ?? []),
              no: fromServerSteps(n.branches?.no ?? []),
            }
          : undefined,
    };
  });
}
