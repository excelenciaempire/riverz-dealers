"use client"

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import Image from "next/image"
import Link from "@/components/i18n/locale-link"
import { useLocalizedRouter } from "@/hooks/use-localized-router"
import { toast } from "sonner"
import {
  ArrowLeft,
  AlertTriangle,
  ChevronDown,
  Plus,
  Trash2,
  GripVertical,
  MessageSquare,
  FileText,
  Tag,
  TagIcon,
  UserCheck,
  PencilLine,
  Hourglass,
  GitBranch,
  GitFork,
  Webhook,
  CircleSlash,
  PhoneCall,
  Zap,
  Loader2,
  ArrowRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  BarChart3,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import type {
  AutomationStepType,
  AutomationTriggerType,
  KeywordMatchTriggerConfig,
  MessageTemplate,
  Profile,
  Tag as ContactTag,
} from "@/types"
import type { ContactSegment } from "@/lib/segments/types"
import { createClient } from "@/lib/supabase/client"
import { useActiveConnections } from "@/hooks/use-active-connections"
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf"
import { useWorkspace } from "@/hooks/use-workspace"
import { useT } from "@/hooks/use-locale"
import type { TFn } from "@/lib/i18n/translate"
import { cn } from "@/lib/utils"
import { WhatsappPreview } from "@/components/templates/whatsapp-preview"
import {
  extractVariables,
  type TemplateButtonInput,
} from "@/lib/whatsapp/template-components"
import {
  DATA_POINTS,
  templateDataPoints,
  conditionDataPoints,
  dataPointById,
  type DataPoint,
} from "@/lib/automations/data-points"
import {
  compileSwitch,
  collapseSwitch,
  type SwitchData,
  type StepShape,
} from "@/lib/automations/switch-compile"
import type { TemplateHeaderType } from "@/lib/whatsapp/template-components"

/** Approved templates, shared with the send_template editor + the phone
 *  preview without threading props through the recursive step tree. */
const TemplatesContext = createContext<MessageTemplate[]>([])

/** Saved contact segments — used by the audience picker on the trigger
 *  card and by the `in_segment` condition subject inside the step tree. */
const SegmentsContext = createContext<ContactSegment[]>([])

/** The workspace's tags. Powers every "pick a tag" dropdown (add/remove
 *  tag steps, the tag_added trigger, the tag_presence condition) so the
 *  user chooses a name instead of pasting a raw id. */
const TagsContext = createContext<ContactTag[]>([])

/** Lets a deep TagSelect add a freshly-created tag to the shared list so it
 *  renders + stays selected without a full reload. */
const TagsMutateContext = createContext<((tag: ContactTag) => void) | null>(null)

/** Team members. Powers the agent picker when a conversation is assigned
 *  to a specific person — name in the menu, user id under the hood. */
const AgentsContext = createContext<Profile[]>([])

/** Etiquetas de las ofertas configuradas del workspace (de
 *  shopify_products.allowed_offers + workspace_checkout_config.offers).
 *  Powers the `offer_chosen` condition dropdown so el merchant elige la
 *  oferta exacta en vez de tipearla. */
const OffersContext = createContext<string[]>([])

/** Títulos de los productos sincronizados de Shopify (shopify_products.title).
 *  Powers el dropdown de la condición `last_product` para que el merchant elija
 *  de sus productos reales en vez de tipear el nombre. */
const ProductsContext = createContext<string[]>([])

/** The automation's trigger type, so each step can filter data points to what
 *  that trigger actually exposes (e.g. tracking_* only after fulfillment). */
const TriggerContext = createContext<AutomationTriggerType>("shopify_order_created")

/** Live count of contacts currently parked at each wait step, keyed by the
 *  persisted step id. Only populated when editing a saved automation; empty
 *  during template previews / new drafts (nothing is waiting yet). */
const WaitingCountsContext = createContext<Record<string, number>>({})

/** Friendly sample values for the inline template preview (so {{n}} renders a
 *  realistic value instead of a placeholder once mapped to a data point). */
const SAMPLE_BY_VAR: Record<string, string> = {
  customer_name: "María",
  order_name: "#1042",
  order_number: "1042",
  total_price: "49.900",
  currency: "ARS",
  offer_units: "3",
  offer_chosen: "3+1 gratis",
  item_count: "1",
  first_item: "Serum Pilar",
  tracking_number: "AR123456789",
  tracking_url: "https://andreani.com/seguimiento",
  tracking_company: "Andreani",
  order_status_url: "https://pilar.co/pedido/1042",
  checkout_url: "https://pilar.co/carrito",
  subtotal_price: "45.900",
  total_discounts: "4.000",
  financial_status: "paid",
  fulfillment_status: "fulfilled",
  shipping_address: "Av. Corrientes 1234",
  shipping_city: "Buenos Aires",
  shipping_province: "CABA",
  shipping_zip: "1043",
  shipping_country: "Argentina",
  contact_first_name: "María",
  contact_last_name: "González",
  contact_email: "maria@correo.com",
  contact_phone: "+54 9 11 1234 5678",
  last_product: "Serum Pilar",
}

// ------------------------------------------------------------
// Types (builder-local — mirror the flattened rows we POST)
// ------------------------------------------------------------

/** Builder-only step types: the real engine types + the `switch` sugar node
 *  that compiles to nested binary conditions on save (see switch-compile.ts). */
export type BuilderStepType = AutomationStepType | "switch"

export interface BuilderStep {
  /** Client id; the API assigns real UUIDs server-side. */
  cid: string
  /** Persisted automation_steps.id, kept only when loaded from the server so
   *  live "waiting" counts can be mapped onto wait nodes. Absent for new steps
   *  and dropped on the next save (steps are deleted + reinserted). */
  serverId?: string
  step_type: BuilderStepType
  step_config: Record<string, unknown>
  branches?: { yes: BuilderStep[]; no: BuilderStep[] }
  /** Multi-case "Varios caminos según un dato" data — only on `switch` steps.
   *  Compiled to a nested binary-condition spine by toApiSteps; never reaches
   *  the wire. */
  switchData?: SwitchData<BuilderStep>
}

export interface BuilderInitial {
  id?: string
  name: string
  description: string
  trigger_type: AutomationTriggerType
  trigger_config: Record<string, unknown>
  audience_segment_id?: string | null
  is_active: boolean
  steps: BuilderStep[]
}

// ------------------------------------------------------------
// Step metadata — one source of truth for icon + label + border color
// ------------------------------------------------------------

interface StepMeta {
  /** i18n key (e.g. "automations.stepSendMessage") resolved with t() at render. */
  label: string
  icon: typeof Zap
  /** Left-border accent color (matches the icon hue). */
  border: string
  /** Tailwind classes for the icon chip on the step card. */
  iconBg: string
  iconText: string
  /** When set, the chip renders the brand SVG from /public/channels
   *  instead of the lucide icon. Used for first-class WhatsApp/Shopify
   *  step types so the canvas reads as "this is a WhatsApp action". */
  brand?: 'whatsapp' | 'shopify'
}

// `label` holds an i18n key, resolved with t() where the meta is rendered.
const STEP_META: Record<BuilderStepType, StepMeta> = {
  switch: {
    label: "automations.stepSwitch",
    icon: GitFork,
    border: "border-l-amber-500",
    iconBg: "bg-amber-500/15",
    iconText: "text-amber-600 dark:text-amber-400",
  },
  send_message: {
    label: "automations.stepSendMessage",
    icon: MessageSquare,
    border: "border-l-emerald-500",
    iconBg: "bg-white",
    iconText: "text-emerald-500",
    brand: "whatsapp",
  },
  send_template: {
    label: "automations.stepSendTemplate",
    icon: FileText,
    border: "border-l-emerald-500",
    iconBg: "bg-white",
    iconText: "text-emerald-500",
    brand: "whatsapp",
  },
  add_tag: {
    label: "automations.stepAddTag",
    icon: Tag,
    border: "border-l-pink-500",
    iconBg: "bg-pink-500/15",
    iconText: "text-pink-600 dark:text-pink-400",
  },
  remove_tag: {
    label: "automations.stepRemoveTag",
    icon: TagIcon,
    border: "border-l-rose-500",
    iconBg: "bg-rose-500/15",
    iconText: "text-rose-600 dark:text-rose-400",
  },
  assign_conversation: {
    label: "automations.stepAssignConversation",
    icon: UserCheck,
    border: "border-l-cyan-500",
    iconBg: "bg-cyan-500/15",
    iconText: "text-cyan-600 dark:text-cyan-400",
  },
  update_contact_field: {
    label: "automations.stepUpdateContactField",
    icon: PencilLine,
    border: "border-l-violet-500",
    iconBg: "bg-violet-500/15",
    iconText: "text-violet-600 dark:text-violet-400",
  },
  wait: {
    label: "automations.stepWait",
    icon: Hourglass,
    border: "border-l-slate-500",
    iconBg: "bg-slate-500/15",
    iconText: "text-slate-600 dark:text-slate-400",
  },
  condition: {
    label: "automations.stepCondition",
    icon: GitBranch,
    border: "border-l-amber-500",
    iconBg: "bg-amber-500/15",
    iconText: "text-amber-600 dark:text-amber-400",
  },
  send_webhook: {
    label: "automations.stepSendWebhook",
    icon: Webhook,
    border: "border-l-indigo-500",
    iconBg: "bg-indigo-500/15",
    iconText: "text-indigo-600 dark:text-indigo-400",
  },
  close_conversation: {
    label: "automations.stepCloseConversation",
    icon: CircleSlash,
    border: "border-l-red-500",
    iconBg: "bg-red-500/15",
    iconText: "text-red-600 dark:text-red-400",
  },
  voice_call: {
    label: "automations.stepVoiceCall",
    icon: PhoneCall,
    border: "border-l-violet-500",
    iconBg: "bg-violet-500/15",
    iconText: "text-violet-600 dark:text-violet-400",
  },
}

// `send_message` (free-text) is intentionally NOT in the picker — Meta
// requires an approved template for any send that may fall outside the
// 24-hour customer-service window, which is true for every automation
// that includes a `wait` step. The type stays in the union so legacy
// rows still load, but new steps must be a template.
// `send_webhook` is intentionally NOT offered — it's a technical/developer
// action that confuses merchants. The type stays in the union so any legacy
// automation keeps loading + running its webhook step.
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
  "send_template",
  "voice_call",
  "assign_conversation",
  "wait",
  "switch",
  "close_conversation",
  // Etiquetar al final: no aplica ninguna etiqueta por defecto — el usuario la
  // escribe (crea una nueva) o elige una existente en el editor del paso.
  "add_tag",
  "remove_tag",
]

// Steps offered INSIDE a switch case / "en otro caso" lane. Cases hold a flat
// list of actions only — no nested branching — so the switch card stays
// self-contained (edited via switchData, not the canvas path system). A
// merchant who needs logic inside a case uses a standalone "Condición" instead.
const LEAF_STEPS: BuilderStepType[] = [
  "send_template",
  "assign_conversation",
  "wait",
  "close_conversation",
  "add_tag",
  "remove_tag",
]

// Selectable triggers are intentionally limited to Shopify events +
// "tag added". The other trigger types still exist in the engine/types
// (so any legacy automation keeps firing and renders its label via
// TRIGGER_META), they're just not offered when building a new one.
// `label` holds an i18n key, resolved with t() inside the trigger card.
const TRIGGER_OPTIONS: { value: AutomationTriggerType; label: string }[] = [
  // Conversación / contacto (los despacha el webhook de entrada). Antes solo
  // vivían en el fallback y no se ofrecían al crear — ahora seleccionables.
  { value: "new_contact_created", label: "automations.triggerNewContact" },
  { value: "first_inbound_message", label: "automations.triggerFirstInbound" },
  { value: "new_message_received", label: "automations.triggerNewMessage" },
  { value: "keyword_match", label: "automations.triggerKeywordMatch" },
  { value: "conversation_assigned", label: "automations.triggerConversationAssigned" },
  { value: "tag_added", label: "automations.triggerTagAdded" },
  { value: "shopify_order_created", label: "automations.triggerShopifyOrderCreated" },
  { value: "shopify_order_paid", label: "automations.triggerShopifyOrderPaid" },
  { value: "shopify_order_fulfilled", label: "automations.triggerShopifyOrderFulfilled" },
  { value: "shopify_order_delivered", label: "automations.triggerShopifyOrderDelivered" },
  { value: "shopify_order_cancelled", label: "automations.triggerShopifyOrderCancelled" },
  { value: "shopify_order_refunded", label: "automations.triggerShopifyOrderRefunded" },
  { value: "shopify_abandoned_checkout", label: "automations.triggerShopifyAbandonedCheckout" },
  { value: "payment_rejected", label: "automations.triggerPaymentRejected" },
  { value: "voice_call_completed", label: "automations.triggerVoiceCallCompleted" },
]

// Friendly labels for trigger types NOT in the selectable list (legacy /
// cron-driven). Without these, editing an existing automation with such a
// trigger showed the raw enum in the header and the dropdown fell back to the
// first option ("Tag added"), which read like the trigger had silently
// changed.
const TRIGGER_LABEL_FALLBACK: Record<string, string> = {
  post_delivery_feedback: "automations.triggerPostDeliveryFeedback",
  customer_inactive: "automations.triggerCustomerInactive",
  keyword_match: "automations.triggerKeywordMatch",
  time_based: "automations.triggerTimeBased",
  new_message_received: "automations.triggerNewMessage",
  first_inbound_message: "automations.triggerFirstInbound",
  new_contact_created: "automations.triggerNewContact",
  conversation_assigned: "automations.triggerConversationAssigned",
}

/** Friendly label for any trigger type, incl. legacy/non-selectable ones. */
function triggerLabel(type: AutomationTriggerType, t: TFn): string {
  const opt = TRIGGER_OPTIONS.find((o) => o.value === type)
  if (opt) return t(opt.label)
  const fb = TRIGGER_LABEL_FALLBACK[type]
  return fb ? t(fb) : type
}

/**
 * Segunda línea de la tarjeta del disparador: qué configuración tiene.
 *
 * El lienzo dibuja una caja por paso, pero lo que el disparador decide
 * —cuánto espera, a quién descarta— vivía sólo dentro del acordeón. Un
 * flujo que se lee "pago rechazado → enviar plantilla" esconde justamente
 * lo que hace que el mensaje sea correcto.
 */
function triggerSummary(
  type: AutomationTriggerType,
  config: Record<string, unknown>,
  t: TFn,
): string | null {
  if (type === "payment_rejected") {
    const days = Number(config?.max_age_days) > 0 ? Number(config.max_age_days) : 14
    return t("automations.mpTriggerSummary", { days: String(days) })
  }
  if (type === "keyword_match") {
    const words = Array.isArray(config?.keywords) ? (config.keywords as string[]) : []
    return words.length ? words.join(", ") : null
  }
  return null
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
  { op: "eq", key: "automations.opEq" },
  { op: "gte", key: "automations.opGte" },
  { op: "lte", key: "automations.opLte" },
  { op: "gt", key: "automations.opGt" },
  { op: "lt", key: "automations.opLt" },
  { op: "between", key: "automations.opBetween" },
]

const GROUP_LABEL: Record<string, string> = {
  order: "automations.dpGroupOrder",
  contact: "automations.dpGroupContact",
  message: "automations.dpGroupMessage",
}

const TIME_DP_ID = "time_of_day"

/** Default op when a data point is first picked. */
function defaultOpFor(dp: DataPoint): string | undefined {
  return dp.condition.kind === 'var' || dp.condition.kind === 'contact_field'
    ? 'eq'
    : undefined
}

/** Reverse-map a stored condition config back to a registry data point id. */
function dataPointIdFromCfg(
  subject: string | undefined,
  operand: string | undefined,
  dps: DataPoint[],
): string | undefined {
  if (subject === 'time_of_day') return TIME_DP_ID
  return dps.find((d) => {
    const c = d.condition
    if (subject === 'context_var') return c.kind === 'var' && c.varKey === operand
    if (subject === 'contact_field') return c.kind === 'contact_field' && c.column === operand
    if (subject === 'tag_presence') return c.kind === 'tag'
    if (subject === 'in_segment') return c.kind === 'segment'
    if (subject === 'message_content') return c.kind === 'message'
    if (subject === 'purchased') return c.kind === 'purchased'
    return false
  })?.id
}

/** Build the condition config for a freshly-picked data point. */
function cfgForDataPoint(dp: DataPoint): Record<string, unknown> {
  const c = dp.condition
  if (c.kind === 'var')
    return { subject: 'context_var', operand: c.varKey, op: defaultOpFor(dp), value: '', value2: undefined }
  if (c.kind === 'contact_field')
    return { subject: 'contact_field', operand: c.column, op: defaultOpFor(dp), value: '', value2: undefined }
  if (c.kind === 'tag') return { subject: 'tag_presence', operand: '', op: undefined, value: '', value2: undefined }
  if (c.kind === 'segment') return { subject: 'in_segment', operand: '', op: undefined, value: '', value2: undefined }
  // `operand` es la ventana y `value` el lado que se quiere.
  if (c.kind === 'purchased')
    return { subject: 'purchased', operand: '24h', op: undefined, value: 'false', value2: undefined }
  return { subject: 'message_content', operand: '', value: '', op: undefined, value2: undefined }
}

function ConditionFields({
  cfg,
  set,
}: {
  cfg: Record<string, unknown>
  set: (patch: Record<string, unknown>) => void
}) {
  const t = useT()
  const trigger = useContext(TriggerContext)
  const segments = useContext(SegmentsContext)
  const offers = useContext(OffersContext)
  const products = useContext(ProductsContext)
  const subject = cfg.subject as string | undefined
  const operand = cfg.operand as string | undefined
  const dps = conditionDataPoints(trigger)
  const currentId = dataPointIdFromCfg(subject, operand, dps)
  const dp = currentId && currentId !== TIME_DP_ID ? dataPointById(currentId) : undefined
  const groups = ["order", "contact", "message"].filter((g) => dps.some((d) => d.group === g))

  function pick(id: string) {
    if (id === TIME_DP_ID) {
      set({ subject: "time_of_day", operand: "", value: "", op: undefined, value2: undefined })
      return
    }
    const d = dataPointById(id)
    if (d) set(cfgForDataPoint(d))
  }

  return (
    <>
      <FieldBlock label={t("automations.condWhatData")}>
        <select
          value={currentId ?? ""}
          onChange={(e) => pick(e.target.value)}
          className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
        >
          <option value="">{t("automations.chooseData")}</option>
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
          <option value={TIME_DP_ID}>{t("automations.dpTimeOfDay")}</option>
        </select>
      </FieldBlock>

      {subject === "time_of_day" && (
        <FieldBlock label={t("automations.betweenTheseHours")}>
          <Input
            value={operand ?? ""}
            onChange={(e) => set({ operand: e.target.value })}
            placeholder="09:00-18:00"
            className="bg-muted text-foreground"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("automations.timeRangeHint")}
          </p>
        </FieldBlock>
      )}

      {dp && dp.condition.kind === "tag" && (
        <FieldBlock label={t("automations.dpHasTag")}>
          <TagSelect value={operand ?? ""} onChange={(v) => set({ operand: v })} />
        </FieldBlock>
      )}

      {dp && dp.condition.kind === "segment" && (
        <FieldBlock label={t("automations.dpInSegment")}>
          <select
            value={operand ?? ""}
            onChange={(e) => set({ operand: e.target.value })}
            className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
          >
            <option value="">{t("automations.chooseSegment")}</option>
            {segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </FieldBlock>
      )}

      {dp && dp.condition.kind === "message" && (
        <FieldBlock label={t("automations.messageContains")}>
          <Input
            value={(cfg.value as string) ?? ""}
            onChange={(e) => set({ value: e.target.value, operand: e.target.value })}
            placeholder={t("automations.messageContainsPlaceholder")}
            className="bg-muted text-foreground"
          />
        </FieldBlock>
      )}

      {dp && dp.condition.kind === "purchased" && (
        <PurchasedFields cfg={cfg} set={set} />
      )}

      {dp && (dp.condition.kind === "var" || dp.condition.kind === "contact_field") && (
        <ConditionValue dp={dp} cfg={cfg} set={set} offers={offers} products={products} />
      )}
    </>
  )
}

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
}: {
  cfg: Record<string, unknown>
  set: (patch: Record<string, unknown>) => void
}) {
  const t = useT()
  const m = /^(\d+)([mhd])$/.exec(String(cfg.operand ?? "24h")) ?? ["", "24", "h"]
  const amount = Number(m[1]) > 0 ? Number(m[1]) : 24
  const unit = m[2] === "m" || m[2] === "d" ? m[2] : "h"
  const setWindow = (a: number, u: string) => set({ operand: `${Math.max(1, a)}${u}` })

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <FieldBlock label={t("automations.condWindowLabel")}>
        <div className="flex gap-2">
          <Input
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setWindow(Number(e.target.value), unit)}
            className="w-20 bg-muted text-foreground"
          />
          <select
            value={unit}
            onChange={(e) => setWindow(amount, e.target.value)}
            className="flex-1 rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:outline-none"
          >
            <option value="m">{t("automations.unitMinutes")}</option>
            <option value="h">{t("automations.unitHours")}</option>
            <option value="d">{t("automations.unitDays")}</option>
          </select>
        </div>
      </FieldBlock>
      <FieldBlock label={t("automations.condValueLabel")}>
        <select
          value={String(cfg.value ?? "false")}
          onChange={(e) => set({ value: e.target.value })}
          className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:outline-none"
        >
          <option value="false">{t("automations.purchasedNo")}</option>
          <option value="true">{t("automations.purchasedYes")}</option>
        </select>
      </FieldBlock>
    </div>
  )
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
  dp: DataPoint
  cfg: Record<string, unknown>
  set: (patch: Record<string, unknown>) => void
  offers: string[]
  products: string[]
}) {
  const t = useT()
  const op = (cfg.op as string) ?? "eq"
  const value = (cfg.value as string) ?? ""
  const selectCls =
    "w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"

  if (dp.valueKind === "bool") {
    return (
      <FieldBlock label={t("automations.whenItIs")}>
        <select
          value={value || "true"}
          onChange={(e) => set({ op: "eq", value: e.target.value })}
          className={selectCls}
        >
          <option value="true">{t("automations.repeatCustomerYes")}</option>
          <option value="false">{t("automations.repeatCustomerNo")}</option>
        </select>
      </FieldBlock>
    )
  }

  if (dp.valueKind === "offer") {
    return (
      <FieldBlock label={t("automations.whichOffer")}>
        {offers.length > 0 ? (
          <select
            value={value}
            onChange={(e) => set({ op: "eq", value: e.target.value })}
            className={selectCls}
          >
            <option value="">{t("automations.chooseOffer")}</option>
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
              onChange={(e) => set({ op: "eq", value: e.target.value })}
              className="bg-muted text-foreground"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("automations.offerChosenNoOffersHint")}
            </p>
          </>
        )}
      </FieldBlock>
    )
  }

  if (dp.valueKind === "product") {
    return (
      <FieldBlock label={t("automations.whichProduct")}>
        {products.length > 0 ? (
          <select
            value={value}
            onChange={(e) => set({ op: "eq", value: e.target.value })}
            className={selectCls}
          >
            <option value="">{t("automations.chooseProduct")}</option>
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
              onChange={(e) => set({ op: "eq", value: e.target.value })}
              className="bg-muted text-foreground"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("automations.productNoProductsHint")}
            </p>
          </>
        )}
      </FieldBlock>
    )
  }

  if (dp.valueKind === "number") {
    return (
      <FieldBlock label={t("automations.condCompare")}>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={op}
            onChange={(e) => set({ op: e.target.value, value2: undefined })}
            className="h-9 rounded-md border border-border bg-muted px-2 text-sm text-foreground"
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
            className="h-9 w-24 bg-muted text-foreground"
          />
          {op === "between" && (
            <>
              <span className="text-xs text-muted-foreground">{t("automations.condAnd")}</span>
              <Input
                type="number"
                value={(cfg.value2 as string) ?? ""}
                onChange={(e) => set({ value2: e.target.value })}
                className="h-9 w-24 bg-muted text-foreground"
              />
            </>
          )}
        </div>
      </FieldBlock>
    )
  }

  // text → equals
  return (
    <FieldBlock label={t("automations.opEq")}>
      <Input
        value={value}
        onChange={(e) => set({ op: "eq", value: e.target.value })}
        className="bg-muted text-foreground"
      />
    </FieldBlock>
  )
}

/** Tag dropdown — name in the menu, tag id in the value. Used anywhere a
 *  step or condition needs to point at a tag without the user knowing it
 *  has an id at all. */
function TagSelect({
  value,
  onChange,
  allowCreate = false,
}: {
  value: string
  onChange: (v: string) => void
  /** When true, the user can TYPE a new tag (created on commit) or pick an
   *  existing one — for add_tag/remove_tag. Off = select-only (conditions). */
  allowCreate?: boolean
}) {
  const t = useT()
  const tags = useContext(TagsContext)
  const addTag = useContext(TagsMutateContext)
  const fetchWithCsrf = useFetchWithCsrf()
  const listId = useId()
  const [text, setText] = useState(
    () => tags.find((x) => x.id === value)?.name ?? "",
  )
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setText(tags.find((x) => x.id === value)?.name ?? "")
  }, [value, tags])

  // Select-only (conditions / triggers): pick from existing tags.
  if (!allowCreate) {
    if (tags.length === 0) {
      return (
        <p className="rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t("automations.noTagsYet")}{" "}
          <Link href="/contactos?tab=tags" className="text-accent-ink underline hover:opacity-80">
            {t("automations.createOne")}
          </Link>
          .
        </p>
      )
    }
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
      >
        <option value="">{t("automations.chooseTag")}</option>
        {tags.map((tag) => (
          <option key={tag.id} value={tag.id}>
            {tag.name}
          </option>
        ))}
      </select>
    )
  }

  // Write-or-pick: type a new tag (created on commit) or choose an existing one.
  async function commit() {
    const name = text.trim()
    if (!name) {
      onChange("")
      return
    }
    const existing = tags.find((x) => x.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      onChange(existing.id)
      setText(existing.name)
      return
    }
    setBusy(true)
    try {
      const res = await fetchWithCsrf("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.tag?.id) {
        addTag?.(j.tag as ContactTag)
        onChange(j.tag.id as string)
        setText(j.tag.name as string)
      }
    } catch {
      /* silencioso — el texto queda para reintentar */
    } finally {
      setBusy(false)
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
          if (e.key === "Enter") {
            e.preventDefault()
            commit()
          }
        }}
        placeholder={t("automations.tagWriteOrPick")}
        disabled={busy}
        className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
      />
      <datalist id={listId}>
        {tags.map((tag) => (
          <option key={tag.id} value={tag.name} />
        ))}
      </datalist>
    </>
  )
}

/** Team-member dropdown — full name in the menu, user id in the value. */
function AgentSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const t = useT()
  const agents = useContext(AgentsContext)
  if (agents.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        {t("automations.noTeammatesYet")}{" "}
        <Link href="/ajustes" className="text-accent-ink underline hover:opacity-80">
          {t("automations.inviteSomeone")}
        </Link>
        .
      </p>
    )
  }
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
    >
      <option value="">{t("automations.chooseSomeone")}</option>
      {agents.map((a) => (
        <option key={a.user_id} value={a.user_id}>
          {a.full_name || a.email}
        </option>
      ))}
    </select>
  )
}

function cid(): string {
  return (
    "c_" +
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36))
  )
}

function blankConfig(type: BuilderStepType): Record<string, unknown> {
  switch (type) {
    case "switch":
      return {} // dpId + cases live on step.switchData (set in addStepAt)
    case "send_message":
      return { text: "" }
    case "send_template":
      return { template_name: "", language: "en_US" }
    case "add_tag":
    case "remove_tag":
      return { tag_id: "" }
    case "assign_conversation":
      return { mode: "round_robin" }
    case "update_contact_field":
      return { field: "name", value: "" }
    case "wait":
      return { amount: 1, unit: "hours" }
    case "condition":
      return {} // unconfigured → the picker shows "¿Qué dato querés revisar?"
    case "send_webhook":
      return { url: "", headers: {}, body_template: "" }
    case "close_conversation":
      return {}
    case "voice_call":
      return { agent_id: "", call_type: "", objective_override: "" }
    default:
      return {}
  }
}

// ------------------------------------------------------------
// Main builder component
// ------------------------------------------------------------

export function AutomationBuilder({
  initial,
  templatePreview = false,
}: {
  initial: BuilderInitial
  /** True when opened from a gallery card to preview a template (unsaved).
   *  Swaps the primary CTA to "Usar plantilla" and shows a hint banner. */
  templatePreview?: boolean
}) {
  const t = useT()
  const router = useLocalizedRouter()
  const fetchWithCsrf = useFetchWithCsrf()
  const { workspace } = useWorkspace()
  const connections = useActiveConnections()
  // Automations send only through WhatsApp; surface which number runs them
  // and warn right in the canvas when none is connected.
  const whatsappConnected = connections.channels.has("whatsapp")
  const isEditing = !!initial.id
  const [state, setState] = useState<BuilderInitial>(initial)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [segments, setSegments] = useState<ContactSegment[]>([])
  const [tags, setTags] = useState<ContactTag[]>([])
  const [agents, setAgents] = useState<Profile[]>([])
  const [offers, setOffers] = useState<string[]>([])
  const [products, setProducts] = useState<string[]>([])
  // Live "how many are parked here right now" per wait step, keyed by the
  // persisted step id. Only fetched when editing a saved automation.
  const [waitingCounts, setWaitingCounts] = useState<Record<string, number>>({})

  // Load the user's templates once — powers the send_template picker and
  // the live phone preview. Approved first so the dropdown is useful.
  // Segments load alongside so the audience filter dropdown is populated
  // without a separate round-trip per render.
  useEffect(() => {
    const supabase = createClient()
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const [{ data: tpl }, { data: seg }, { data: tg }, { data: ag }, { data: prods }, { data: checkoutCfg }] =
        await Promise.all([
          supabase
            .from("message_templates")
            .select("*")
            .eq("user_id", user.id)
            .order("status", { ascending: true })
            .order("name", { ascending: true }),
          supabase
            .from("contact_segments")
            .select("*")
            .order("name", { ascending: true }),
          // Tags + team members are RLS-scoped to the user's workspace,
          // so a plain select returns only what they're allowed to pick.
          supabase.from("tags").select("*").order("name", { ascending: true }),
          supabase.from("profiles").select("*").order("full_name", { ascending: true }),
          // Offers: per-product allowed_offers + the assistant checkout
          // config. Both RLS-scoped to the workspace. Powers the
          // `offer_chosen` condition dropdown. `title` alimenta el dropdown
          // de la condición `last_product`.
          supabase.from("shopify_products").select("title, allowed_offers"),
          supabase.from("workspace_checkout_config").select("offers").maybeSingle(),
        ])
      setTemplates((tpl as MessageTemplate[]) ?? [])
      setSegments((seg as ContactSegment[]) ?? [])
      setTags((tg as ContactTag[]) ?? [])
      setAgents((ag as Profile[]) ?? [])

      // Flatten + dedupe offer labels de ambas fuentes. Dedupe por clave
      // NORMALIZADA (trim + minúsculas) para que "1 unidad"/"1 Unidad" y
      // "2 unidades + 1 gratis"/"2 Unidades + 1 GRATIS" no salgan repetidas —
      // el auto-detect del sitio guarda el casing de la página y el manual suele
      // ir en minúsculas. Se conserva una etiqueta canónica (la primera vista).
      const byKey = new Map<string, string>()
      const addLabel = (raw: unknown) => {
        const label = String(raw ?? "").trim()
        if (!label) return
        const key = label.toLowerCase()
        if (!byKey.has(key)) byKey.set(key, label)
      }
      type OfferRow = { label?: unknown }
      for (const row of (prods as { allowed_offers?: unknown }[] | null) ?? []) {
        const list = Array.isArray(row?.allowed_offers) ? row.allowed_offers : []
        for (const o of list as OfferRow[]) {
          addLabel(typeof o === "string" ? o : o?.label)
        }
      }
      const cfgOffers = (checkoutCfg as { offers?: unknown } | null)?.offers
      for (const o of (Array.isArray(cfgOffers) ? cfgOffers : []) as OfferRow[]) {
        addLabel(o?.label)
      }
      setOffers([...byKey.values()].sort((a, b) => a.localeCompare(b)))

      // Títulos de productos (sincronizados de Shopify) para el dropdown de la
      // condición `last_product`. Dedupe + orden alfabético.
      const titles = new Set<string>()
      for (const row of (prods as { title?: unknown }[] | null) ?? []) {
        const title = String(row?.title ?? "").trim()
        if (title) titles.add(title)
      }
      setProducts([...titles].sort((a, b) => a.localeCompare(b)))
    })()
  }, [])

  // Live "waiting here now" counts per wait step. Only meaningful for a saved
  // automation; the map is keyed by the persisted step id (serverId on each
  // loaded node). Pending executions are service-role only, so this goes
  // through a dedicated endpoint.
  useEffect(() => {
    if (!initial.id) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/automations/${initial.id}/waiting`)
        if (!res.ok) return
        const body = await res.json()
        if (!cancelled && body?.counts) setWaitingCounts(body.counts as Record<string, number>)
      } catch {
        // Non-critical overlay — a failed fetch just leaves the badges hidden.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [initial.id])

  function patchTop<K extends keyof BuilderInitial>(key: K, value: BuilderInitial[K]) {
    setState((s) => ({ ...s, [key]: value }))
  }

  // --- Step tree mutations (immutable) ---

  function updateStep(path: StepPath, updater: (s: BuilderStep) => BuilderStep) {
    setState((s) => ({ ...s, steps: mapAtPath(s.steps, path, updater) }))
  }

  function addStepAt(parent: ParentScope, index: number, type: BuilderStepType) {
    const node: BuilderStep = {
      cid: cid(),
      step_type: type,
      step_config: blankConfig(type),
      branches: type === "condition" ? { yes: [], no: [] } : undefined,
      // Start the unified "Condición" with one empty path so the if/else shape
      // is visible immediately; the user fills its filter, adds more, or leaves
      // just the "en otro caso".
      switchData:
        type === "switch"
          ? { dpId: undefined, cases: [{ ckey: cid(), cfg: {}, steps: [] }], elseSteps: [] }
          : undefined,
    }
    setState((s) => ({ ...s, steps: insertAt(s.steps, parent, index, node) }))
    setExpandedId(node.cid)
  }

  function deleteStepAt(path: StepPath) {
    setState((s) => ({ ...s, steps: removeAt(s.steps, path) }))
  }

  function moveStepAt(path: StepPath, direction: -1 | 1) {
    setState((s) => ({ ...s, steps: moveAt(s.steps, path, direction) }))
  }

  async function save() {
    setSaving(true)
    try {
      const payload = {
        name: state.name || t("automations.untitledAutomation"),
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
      }

      const res = isEditing
        ? await fetchWithCsrf(`/api/automations/${initial.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetchWithCsrf(`/api/automations`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })

      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        // If the server blocked activation with validation issues,
        // surface the first concrete problem so the user can fix it
        // without opening DevTools for the full array.
        const firstIssue: { path?: string; message?: string } | undefined =
          body?.issues?.[0]
        if (firstIssue?.message) {
          toast.error(firstIssue.message, {
            description: firstIssue.path ? `en ${firstIssue.path}` : undefined,
          })
        } else {
          toast.error(body?.error ?? t("automations.saveFailed"))
        }
        return
      }
      toast.success(
        isEditing
          ? t("automations.toastSaved")
          : templatePreview
            ? t("automations.toastTemplateAdded")
            : t("automations.toastCreated"),
      )
      if (!isEditing && body?.automation?.id) {
        router.replace(`/automatizaciones/${body.automation.id}/editar`)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <TriggerContext.Provider value={state.trigger_type}>
    <TemplatesContext.Provider value={templates}>
    <SegmentsContext.Provider value={segments}>
    <TagsContext.Provider value={tags}>
    <TagsMutateContext.Provider
      value={(tag) =>
        setTags((prev) =>
          prev.some((x) => x.id === tag.id)
            ? prev
            : [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)),
        )
      }
    >
    <AgentsContext.Provider value={agents}>
    <OffersContext.Provider value={offers}>
    <ProductsContext.Provider value={products}>
    <WaitingCountsContext.Provider value={waitingCounts}>
    <div className="fixed inset-0 flex flex-col bg-background">
      {/* Top bar. At sub-sm widths the "Active" label is hidden and the
          switch moves to the right of the save button, so the name input
          gets maximum width. */}
      <header className="flex flex-shrink-0 items-center gap-2 border-b border-border bg-card/80 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:gap-3 sm:px-4">
        <button
          type="button"
          onClick={() => router.push("/automatizaciones")}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={t("automations.back")}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <input
          value={state.name}
          onChange={(e) => patchTop("name", e.target.value)}
          placeholder={t("automations.untitledAutomation")}
          className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus:bg-accent focus:outline-none sm:text-base"
        />
        {/* Activation lives in the real editor — a template preview is
            unsaved and would fail the validate.ts gate, so hide it here. */}
        {!templatePreview && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="hidden sm:inline">{t("automations.active")}</span>
            <Switch
              checked={state.is_active}
              onCheckedChange={(v) => patchTop("is_active", !!v)}
              aria-label={t("automations.active")}
            />
          </div>
        )}
        {isEditing && !templatePreview && (
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(`/automatizaciones/${initial.id}`)}
            className="border-border bg-transparent text-foreground hover:bg-muted"
          >
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">{t("automations.viewStats")}</span>
          </Button>
        )}
        <Button
          onClick={save}
          disabled={saving}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isEditing
            ? t("automations.save")
            : templatePreview
              ? t("automations.useTemplate")
              : t("automations.saveDraft")}
        </Button>
      </header>

      {templatePreview && (
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-primary/20 bg-primary/5 px-4 py-2 text-xs text-muted-foreground">
          <Zap className="h-3.5 w-3.5 shrink-0 text-accent-ink" />
          <span>{t("automations.templatePreviewBanner")}</span>
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
            {t("automations.noWhatsappCantSend")}
          </span>
          <Link href="/integraciones" className="text-accent-ink underline hover:opacity-80">
            {t("automations.connectWhatsapp")}
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
        <CanvasViewport>
          <div className="flex w-max items-start gap-0 px-8 py-10">
            <TriggerCard
              type={state.trigger_type}
              config={state.trigger_config}
              onTypeChange={(t) => patchTop("trigger_type", t)}
              onConfigChange={(c) => patchTop("trigger_config", c)}
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
            />
          </div>
        </CanvasViewport>
        {/* The WhatsApp preview now lives INLINE inside the expanded
            "Enviar plantilla" step (see StepEditor) — no separate rail. */}
      </div>
    </div>
    </WaitingCountsContext.Provider>
    </ProductsContext.Provider>
    </OffersContext.Provider>
    </AgentsContext.Provider>
    </TagsMutateContext.Provider>
    </TagsContext.Provider>
    </SegmentsContext.Provider>
    </TemplatesContext.Provider>
    </TriggerContext.Provider>
  )
}

// ------------------------------------------------------------
// Trigger card
// ------------------------------------------------------------

function TriggerCard({
  type,
  config,
  onTypeChange,
  onConfigChange,
}: {
  type: AutomationTriggerType
  config: Record<string, unknown>
  onTypeChange: (t: AutomationTriggerType) => void
  onConfigChange: (c: Record<string, unknown>) => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    // Card width: full on mobile, fixed 320px on sm+. The canvas wrapper
    // (max-w-2xl + px-4) keeps this tidy on tablet/desktop.
    <div className="z-10 w-full max-w-[320px] sm:w-80">
      <div
        className={cn(
          "rounded-lg border border-border border-l-4 bg-card shadow-lg",
          type.startsWith("shopify_")
            ? "border-l-emerald-500"
            : "border-l-blue-500",
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          <div
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg",
              type.startsWith("shopify_") ? "bg-white" : "bg-blue-500/10 text-blue-600 dark:text-blue-400",
            )}
          >
            {type.startsWith("shopify_") ? (
              <Image src="/channels/shopify.svg" alt="" width={22} height={22} />
            ) : (
              <Zap className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div
              className={cn(
                "text-[11px] uppercase tracking-wide",
                type.startsWith("shopify_") ? "text-emerald-700 dark:text-emerald-300" : "text-blue-700 dark:text-blue-300",
              )}
            >
              {type.startsWith("shopify_")
                ? t("automations.triggerEyebrowShopify")
                : t("automations.triggerEyebrow")}
            </div>
            <div className="truncate text-sm font-medium text-foreground">
              {triggerLabel(type, t)}
            </div>
            {/* Resumen de la configuración, como el nombre de plantilla que
                muestra la tarjeta de acción. Sin esto, lo que decide el
                disparador queda escondido detrás del acordeón y el lienzo
                miente por omisión: se lee "pago rechazado → enviar" cuando
                en realidad hay una espera y una comprobación en el medio. */}
            {triggerSummary(type, config, t) && (
              <div className="truncate text-[11px] text-muted-foreground">
                {triggerSummary(type, config, t)}
              </div>
            )}
          </div>
          <ChevronDown
            className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")}
          />
        </button>
        {open && (
          <div className="space-y-3 border-t border-border px-4 py-3">
            <div>
              <select
                value={type}
                onChange={(e) => onTypeChange(e.target.value as AutomationTriggerType)}
                className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
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
            {type === "keyword_match" && (
              <KeywordMatchConfig
                config={config as unknown as KeywordMatchTriggerConfig}
                onChange={onConfigChange}
              />
            )}
            {type === "tag_added" && (
              <TagSelect
                value={(config.tag_id as string) ?? ""}
                onChange={(v) => onConfigChange({ ...config, tag_id: v })}
              />
            )}
            {type === "time_based" && (
              <Input
              placeholder={t("automations.cronOrTimePlaceholder")}
                value={(config.schedule as string) ?? ""}
                onChange={(e) =>
                  onConfigChange({ ...config, schedule: e.target.value })
                }
                className="bg-muted text-foreground"
              />
            )}
            {type === "payment_rejected" && (
              <PaymentRejectedConfig config={config} onChange={onConfigChange} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Espera y antigüedad de la recuperación de pagos rechazados.
 *
 * La espera es lo que convierte "se le rechazó el pago" en "no compró": al
 * cumplirse, el sistema comprueba si la persona terminó comprando y sólo
 * escribe si no lo hizo. Por eso el texto habla de eso y no de un retardo.
 */
function PaymentRejectedConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
}) {
  const t = useT()
  // Sin Mercado Pago conectado no entra ni un pago rechazado, así que la
  // automatización se puede activar y no dispararse nunca. El aviso es lo
  // único que convierte ese silencio en algo accionable.
  const [mpConnected, setMpConnected] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    fetch('/api/integrations/mercadopago', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive) setMpConnected(j ? !!j.connected : null)
      })
      .catch(() => {
        // Un fallo de red no es "no conectado": dejar null oculta el aviso
        // en vez de mandar a reconectar algo que ya funciona.
        if (alive) setMpConnected(null)
      })
    return () => {
      alive = false
    }
  }, [])
  const num = (v: unknown, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {mpConnected === false && (
        <div className="sm:col-span-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          <p className="text-xs text-amber-800 dark:text-amber-200">
            {t("automations.mpNotConnected")}
          </p>
          <Link
            href="/integraciones"
            className="mt-1 inline-block text-xs font-medium underline underline-offset-2"
          >
            {t("automations.mpConnectCta")}
          </Link>
        </div>
      )}
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          {t("automations.mpHoursAfterLabel")}
        </label>
        <Input
          type="number"
          min={1}
          max={168}
          value={num(config.hours_after, 3)}
          onChange={(e) =>
            onChange({ ...config, hours_after: num(e.target.value, 3) })
          }
          className="bg-muted text-foreground"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          {t("automations.mpMaxAgeLabel")}
        </label>
        <Input
          type="number"
          min={1}
          max={90}
          value={num(config.max_age_days, 14)}
          onChange={(e) =>
            onChange({ ...config, max_age_days: num(e.target.value, 14) })
          }
          className="bg-muted text-foreground"
        />
      </div>
    </div>
  )
}

function KeywordMatchConfig({
  config,
  onChange,
}: {
  config: KeywordMatchTriggerConfig
  onChange: (c: Record<string, unknown>) => void
}) {
  const t = useT()
  const keywords = config?.keywords ?? []
  return (
    <div className="space-y-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          {t("automations.keywordsLabel")}
        </label>
        <Input
          value={keywords.join(", ")}
          onChange={(e) =>
            onChange({
              ...config,
              keywords: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          className="bg-muted text-foreground"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          {t("automations.matchTypeLabel")}
        </label>
        <select
          value={config?.match_type ?? "contains"}
          onChange={(e) => onChange({ ...config, match_type: e.target.value as "exact" | "contains" })}
          className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:outline-none"
        >
          <option value="contains">{t("automations.matchContains")}</option>
          <option value="exact">{t("automations.matchExact")}</option>
        </select>
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// Step list + card + connectors
// ------------------------------------------------------------

type ParentScope =
  | { kind: "root" }
  | { kind: "branch"; parentCid: string; branch: "yes" | "no" }

type StepPath = (
  | { kind: "root"; index: number }
  | { kind: "branch"; parentCid: string; branch: "yes" | "no"; index: number }
)[]

interface StepListProps {
  steps: BuilderStep[]
  parentPath: StepPath
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  updateStep: (path: StepPath, updater: (s: BuilderStep) => BuilderStep) => void
  addStepAt: (parent: ParentScope, index: number, type: BuilderStepType) => void
  deleteStepAt: (path: StepPath) => void
  moveStepAt: (path: StepPath, direction: -1 | 1) => void
}

function StepList(props: StepListProps) {
  const { steps, parentPath, ...rest } = props
  // Everything flows left-to-right — the root chain AND each condition
  // branch. A branch is just the chain continuing horizontally down its
  // own lane, so the two paths read as a fork along the same direction.
  const parentScope: ParentScope =
    parentPath.length === 0
      ? { kind: "root" }
      : (() => {
          const last = parentPath[parentPath.length - 1]
          if (last.kind !== "branch") return { kind: "root" } as const
          return { kind: "branch", parentCid: last.parentCid, branch: last.branch } as const
        })()

  return (
    <div className="flex items-start">
      <AddButton orientation="h" onPick={(t) => props.addStepAt(parentScope, 0, t)} />
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
  )
}

/** Amber pill shown on a wait card with how many contacts are parked there
 *  right now. Renders nothing unless the step is a saved wait (has a serverId)
 *  with at least one contact waiting. */
function WaitingBadge({ step }: { step: BuilderStep }) {
  const t = useT()
  const counts = useContext(WaitingCountsContext)
  if (step.step_type !== "wait" || !step.serverId) return null
  const n = counts[step.serverId] ?? 0
  if (n <= 0) return null
  return (
    <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-amber-600/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-amber-700 dark:text-amber-300">
      <Hourglass className="h-3 w-3" aria-hidden />
      {t("automations.waitingNow", { n })}
    </span>
  )
}

function StepRenderer({
  step,
  index,
  total,
  parentScope,
  parentPath,
  ...props
}: {
  step: BuilderStep
  index: number
  total: number
  parentScope: ParentScope
  parentPath: StepPath
} & Omit<StepListProps, "steps" | "parentPath">) {
  const t = useT()
  const path: StepPath = [
    ...parentPath,
    parentScope.kind === "root"
      ? { kind: "root", index }
      : { kind: "branch", parentCid: parentScope.parentCid, branch: parentScope.branch, index },
  ]
  const meta = STEP_META[step.step_type]
  const Icon = meta.icon
  const expanded = props.expandedId === step.cid
  const isCondition = step.step_type === "condition"
  const isSwitch = step.step_type === "switch"
  const isBranch = isCondition || isSwitch
  // Card widths on mobile fill the full canvas column (max-w-2xl px-4
  // still keeps them reasonable). On sm+ the original fixed widths
  // come back so the flow visual stays recognisable.
  const width = isBranch
    ? "w-full max-w-[400px] sm:w-[400px]"
    : "w-full max-w-[320px] sm:w-80"

  const cardEl = (
    <div className={cn("flex flex-col", width)}>
        <div
          className={cn(
            "rounded-lg border border-border border-l-4 bg-card shadow-lg",
            meta.border,
          )}
        >
          <button
            type="button"
            onClick={() => props.setExpandedId(expanded ? null : step.cid)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left"
          >
            <GripVertical className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden />
            <div
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-lg",
                meta.iconBg,
                meta.iconText,
              )}
            >
              {meta.brand === "whatsapp" ? (
                <Image src="/channels/whatsapp.svg" alt="" width={20} height={20} />
              ) : meta.brand === "shopify" ? (
                <Image src="/channels/shopify.svg" alt="" width={20} height={20} />
              ) : (
                <Icon className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {isBranch
                  ? t("automations.kindCondition")
                  : step.step_type === "wait"
                    ? t("automations.kindWait")
                    : t("automations.kindAction")}
              </div>
              <div className="truncate text-sm font-medium text-foreground">{t(meta.label)}</div>
              <div className="truncate text-[11px] text-muted-foreground">{previewFor(step, t)}</div>
            </div>
            <WaitingBadge step={step} />
            <ChevronDown
              className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded && "rotate-180")}
            />
          </button>
          {expanded && (
            <div className="border-t border-border px-4 py-3">
              <StepEditor
                step={step}
                onChange={(next) => props.updateStep(path, () => next)}
              />
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={index === 0}
                    aria-label={t("automations.moveBefore")}
                    onClick={() => props.moveStepAt(path, -1)}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={index === total - 1}
                    aria-label={t("automations.moveAfter")}
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
                  {t("automations.delete")}
                </Button>
              </div>
            </div>
          )}
        </div>
    </div>
  )

  return (
    <>
      {isCondition ? (
        // Condition: card on the left, its two branch lanes fanning out to
        // the right so each path keeps flowing in the chain's direction
        // instead of dropping into stacked vertical columns.
        <div className="z-10 flex items-start gap-4">
          {cardEl}
          <ConditionBranches step={step} parentPath={path} {...props} />
        </div>
      ) : isSwitch ? (
        // Switch: card on the left, one lane per case + an "en otro caso"
        // lane fanning out to the right (same visual grammar as a condition,
        // just N lanes instead of two).
        <div className="z-10 flex items-start gap-4">
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
          onPick={(t) => props.addStepAt(parentScope, index + 1, t)}
        />
      )}
    </>
  )
}

function ConditionBranches({
  step,
  parentPath,
  ...props
}: {
  step: BuilderStep
  parentPath: StepPath
} & Omit<StepListProps, "steps" | "parentPath">) {
  const t = useT()
  const yes = step.branches?.yes ?? []
  const no = step.branches?.no ?? []
  // Build the child scope by appending a branch marker. The scope the
  // StepList uses is driven by the LAST element of parentPath, so the
  // tail's `index` doesn't matter — it's replaced per child during walks.
  const yesPath: StepPath = [
    ...parentPath,
    { kind: "branch", parentCid: step.cid, branch: "yes", index: 0 },
  ]
  const noPath: StepPath = [
    ...parentPath,
    { kind: "branch", parentCid: step.cid, branch: "no", index: 0 },
  ]
  return (
    // Two lanes stacked one over the other (Sí above, No below). Each lane
    // is a horizontal chain, so the branches read as the flow forking and
    // carrying on rightward. The dashed rail ties them back to the card.
    <div className="flex flex-col gap-5 self-stretch border-l-2 border-dashed border-border pl-4">
      <BranchLane label={t("automations.branchYes")} color="border-emerald-500/40 bg-emerald-500/10 text-accent-ink">
        <StepList {...props} steps={yes} parentPath={yesPath} />
      </BranchLane>
      <BranchLane label={t("automations.branchNo")} color="border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400">
        <StepList {...props} steps={no} parentPath={noPath} />
      </BranchLane>
    </div>
  )
}

function BranchLane({
  label,
  color,
  children,
}: {
  label: string
  color: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-1">
      {/* Pill sits at the card-header line (~28px) so it aligns with the
          first step's icon row in the lane. */}
      <span
        className={cn(
          "mt-7 shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase",
          color,
        )}
      >
        {label}
      </span>
      {children}
    </div>
  )
}

// ------------------------------------------------------------
// Multi-case "Bifurcar según…" (switch) node. A builder-only card that
// compiles to nested binary conditions on save (switch-compile.ts). Its cases
// + "en otro caso" lane are edited in place on step.switchData via the switch's
// own updateStep(path) — leaf actions only, so it never touches the canvas
// path system. Decompiled chains with nested branching stay as conditions.
// ------------------------------------------------------------

/** A data point worth branching on with N discrete cases: a value the merchant
 *  compares (units, total) or picks from a set (offer, text). bool/tag/segment/
 *  message are binary → a plain "Condición" fits those better. This single
 *  predicate gates BOTH the create-time picker AND the load-time collapse, so a
 *  chain can never decompile into a switch the UI can't render or edit. */
/** Short natural label for a path lane — the case's filter rendered as a
 *  phrase (e.g. "Unidades que compró al menos 4", "Tiene la etiqueta VIP"). */
function caseShortLabel(cfg: Record<string, unknown>, t: TFn): string {
  return conditionPreview(cfg, t)
}

function SwitchBranches({
  step,
  switchPath,
  expandedId,
  setExpandedId,
  updateStep,
}: {
  step: BuilderStep
  switchPath: StepPath
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  updateStep: (path: StepPath, updater: (s: BuilderStep) => BuilderStep) => void
}) {
  const t = useT()
  const sd = step.switchData ?? { dpId: undefined, cases: [], elseSteps: [] }

  // Every mutation reshapes step.switchData through the switch's own path.
  const patch = (fn: (d: SwitchData<BuilderStep>) => SwitchData<BuilderStep>) =>
    updateStep(switchPath, (s) => ({
      ...s,
      switchData: fn(s.switchData ?? { dpId: undefined, cases: [], elseSteps: [] }),
    }))

  const addCase = () =>
    patch((d) => ({
      ...d,
      // Each path carries its own filter (edited in the lane via ConditionFields);
      // a fresh path starts empty for the user to pick a data point.
      cases: [...d.cases, { ckey: cid(), cfg: {}, steps: [] }],
    }))
  const removeCase = (ckey: string) =>
    patch((d) => ({ ...d, cases: d.cases.filter((c) => c.ckey !== ckey) }))
  const patchCaseCfg = (ckey: string, p: Record<string, unknown>) =>
    patch((d) => ({
      ...d,
      cases: d.cases.map((c) => (c.ckey === ckey ? { ...c, cfg: { ...c.cfg, ...p } } : c)),
    }))
  const mutateLane = (
    lane: string | "else",
    fn: (steps: BuilderStep[]) => BuilderStep[],
  ) =>
    patch((d) =>
      lane === "else"
        ? { ...d, elseSteps: fn(d.elseSteps) }
        : { ...d, cases: d.cases.map((c) => (c.ckey === lane ? { ...c, steps: fn(c.steps) } : c)) },
    )
  const addStep = (lane: string | "else", type: BuilderStepType) =>
    mutateLane(lane, (steps) => [
      ...steps,
      { cid: cid(), step_type: type, step_config: blankConfig(type) },
    ])
  const changeStep = (lane: string | "else", idx: number, next: BuilderStep) =>
    mutateLane(lane, (steps) => steps.map((s, i) => (i === idx ? next : s)))
  const removeStep = (lane: string | "else", idx: number) =>
    mutateLane(lane, (steps) => steps.filter((_, i) => i !== idx))
  const moveStep = (lane: string | "else", idx: number, dir: -1 | 1) =>
    mutateLane(lane, (steps) => {
      const j = idx + dir
      if (j < 0 || j >= steps.length) return steps
      const copy = [...steps]
      ;[copy[idx], copy[j]] = [copy[j], copy[idx]]
      return copy
    })

  return (
    <div className="flex flex-col gap-5 self-stretch border-l-2 border-dashed border-border pl-4">
      {sd.cases.map((c) => (
        <SwitchCaseLane
          key={c.ckey}
          label={caseShortLabel(c.cfg, t)}
          cfg={c.cfg}
          onCfg={(p) => patchCaseCfg(c.ckey, p)}
          onRemove={() => removeCase(c.ckey)}
          steps={c.steps}
          expandedId={expandedId}
          setExpandedId={setExpandedId}
          onAdd={(type) => addStep(c.ckey, type)}
          onChangeStep={(i, n) => changeStep(c.ckey, i, n)}
          onRemoveStep={(i) => removeStep(c.ckey, i)}
          onMoveStep={(i, dir) => moveStep(c.ckey, i, dir)}
        />
      ))}

      <BranchLane
        label={t("automations.switchElse")}
        color="border-slate-400/40 bg-slate-400/10 text-muted-foreground"
      >
        <SwitchLaneSteps
          steps={sd.elseSteps}
          expandedId={expandedId}
          setExpandedId={setExpandedId}
          onAdd={(type) => addStep("else", type)}
          onChangeStep={(i, n) => changeStep("else", i, n)}
          onRemoveStep={(i) => removeStep("else", i)}
          onMoveStep={(i, dir) => moveStep("else", i, dir)}
        />
      </BranchLane>

      <button
        type="button"
        onClick={addCase}
        className="inline-flex items-center gap-1.5 self-start rounded-full border-2 border-dashed border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-accent-ink"
      >
        <Plus className="h-3.5 w-3.5" />
        {t("automations.switchAddCase")}
      </button>
    </div>
  )
}

function SwitchCaseLane({
  label,
  cfg,
  onCfg,
  onRemove,
  steps,
  expandedId,
  setExpandedId,
  onAdd,
  onChangeStep,
  onRemoveStep,
  onMoveStep,
}: {
  label: string
  cfg: Record<string, unknown>
  onCfg: (p: Record<string, unknown>) => void
  onRemove: () => void
  steps: BuilderStep[]
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  onAdd: (type: BuilderStepType) => void
  onChangeStep: (i: number, n: BuilderStep) => void
  onRemoveStep: (i: number) => void
  onMoveStep: (i: number, dir: -1 | 1) => void
}) {
  const t = useT()
  return (
    <BranchLane
      label={label}
      color="border-emerald-500/40 bg-emerald-500/10 text-accent-ink"
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-1 rounded-md border border-border bg-card/60 p-2">
          <div className="min-w-[180px] flex-1">
            {/* Each path is a full condition (any data point + operator + value). */}
            <ConditionFields cfg={cfg} set={onCfg} />
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("automations.switchRemoveCase")}
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        <SwitchLaneSteps
          steps={steps}
          expandedId={expandedId}
          setExpandedId={setExpandedId}
          onAdd={onAdd}
          onChangeStep={onChangeStep}
          onRemoveStep={onRemoveStep}
          onMoveStep={onMoveStep}
        />
      </div>
    </BranchLane>
  )
}

function SwitchLaneSteps({
  steps,
  expandedId,
  setExpandedId,
  onAdd,
  onChangeStep,
  onRemoveStep,
  onMoveStep,
}: {
  steps: BuilderStep[]
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  onAdd: (type: BuilderStepType) => void
  onChangeStep: (i: number, n: BuilderStep) => void
  onRemoveStep: (i: number) => void
  onMoveStep: (i: number, dir: -1 | 1) => void
}) {
  return (
    <div className="flex items-start gap-2">
      {steps.map((s, i) => (
        <LeafStepCard
          key={s.cid}
          step={s}
          expanded={expandedId === s.cid}
          onToggle={() => setExpandedId(expandedId === s.cid ? null : s.cid)}
          onChange={(n) => onChangeStep(i, n)}
          onRemove={() => onRemoveStep(i)}
          onMoveUp={() => onMoveStep(i, -1)}
          onMoveDown={() => onMoveStep(i, 1)}
          canUp={i > 0}
          canDown={i < steps.length - 1}
        />
      ))}
      <AddButton orientation="h" types={LEAF_STEPS} onPick={onAdd} />
    </div>
  )
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
}: {
  step: BuilderStep
  expanded: boolean
  onToggle: () => void
  onChange: (s: BuilderStep) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  canUp: boolean
  canDown: boolean
}) {
  const t = useT()
  const meta = STEP_META[step.step_type]
  const Icon = meta.icon
  return (
    <div className="flex w-full max-w-[280px] flex-col sm:w-72">
      <div className={cn("rounded-lg border border-border border-l-4 bg-card shadow-sm", meta.border)}>
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
        >
          <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", meta.iconBg, meta.iconText)}>
            {meta.brand === "whatsapp" ? (
              <Image src="/channels/whatsapp.svg" alt="" width={18} height={18} />
            ) : meta.brand === "shopify" ? (
              <Image src="/channels/shopify.svg" alt="" width={18} height={18} />
            ) : (
              <Icon className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">{t(meta.label)}</div>
            <div className="truncate text-[11px] text-muted-foreground">{previewFor(step, t)}</div>
          </div>
          <WaitingBadge step={step} />
          <ChevronDown
            className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded && "rotate-180")}
          />
        </button>
        {expanded && (
          <div className="border-t border-border px-3 py-3">
            <StepEditor step={step} onChange={onChange} />
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={!canUp}
                  aria-label={t("automations.moveBefore")}
                  onClick={onMoveUp}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={!canDown}
                  aria-label={t("automations.moveAfter")}
                  onClick={onMoveDown}
                >
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
              <Button variant="destructive" size="sm" onClick={onRemove}>
                <Trash2 className="h-3.5 w-3.5" />
                {t("automations.delete")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function AddButton({
  onPick,
  orientation = "v",
  types = ADDABLE_STEPS,
}: {
  onPick: (t: BuilderStepType) => void
  orientation?: "h" | "v"
  /** Which step types the menu offers (default: the full chain menu; switch
   *  case/else lanes pass LEAF_STEPS so they can't nest branching). */
  types?: BuilderStepType[]
}) {
  const t = useT()
  const seg = orientation === "h" ? "h-[2px] w-6" : "h-6 w-[2px]"
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Menú PROPIO (portaleado a body, con onClick nativo) en vez del DropdownMenu
  // de base-ui: base-ui NO registra el click del mouse en los items cuando el
  // disparador vive dentro de la transformación CSS `scale` del lienzo zoomeable
  // (el teclado sí funcionaba, el mouse no → nada se agregaba). Un onClick nativo
  // dispara el handler sin ese hit-testing roto, y el portal evita el clip.
  const openMenu = () => {
    const r = triggerRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 4, left: r.left })
    setOpen((v) => !v)
  }

  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent) => {
      const target = e.target as Node
      // El menú está portaleado FUERA del trigger, así que hay que excluirlo
      // explícitamente — si no, un click en un item cuenta como "afuera" y
      // cierra el menú en el pointerdown antes de que dispare su onClick.
      if (
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    // Diferir el listener para no capturar el mismo click que abrió el menú.
    const id = window.setTimeout(() => document.addEventListener("pointerdown", onDoc), 0)
    document.addEventListener("keydown", onKey)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener("pointerdown", onDoc)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div
      className={cn(
        "group/add relative flex items-center",
        // Siempre a full opacidad: el "+ Añadir" es la acción principal para
        // construir el flujo, así que tiene que verse sin buscarlo.
        "opacity-100",
        // Top-align in horizontal mode so the line meets the card header
        // (cards grow downward when expanded / when conditions sprout
        // branches), ~28px ≈ half the collapsed header height.
        orientation === "h" ? "flex-row self-start mt-7" : "flex-col",
      )}
    >
      <div className={cn(seg, "bg-border")} aria-hidden />
      <button
        ref={triggerRef}
        type="button"
        onClick={openMenu}
        aria-label={t("automations.addStep")}
        aria-expanded={open}
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-full border-2 border-dashed border-primary bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-accent-ink transition-all hover:bg-primary/20",
          open && "bg-primary/20",
        )}
      >
        <Plus className="h-3.5 w-3.5" />
        {t("automations.add")}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 60 }}
            className="max-h-80 min-w-64 overflow-y-auto rounded-md border border-border bg-card py-1 shadow-lg"
          >
            <div className="border-b border-border px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("automations.chooseWhatToDo")}
            </div>
            {types.map((stepType) => {
              const m = STEP_META[stepType]
              const Icon = m.icon
              return (
                <button
                  key={stepType}
                  type="button"
                  onClick={() => {
                    onPick(stepType)
                    setOpen(false)
                  }}
                  className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-sm text-foreground hover:bg-accent"
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                      m.iconBg,
                      m.iconText,
                    )}
                  >
                    {m.brand === "whatsapp" ? (
                      <Image src="/channels/whatsapp.svg" alt="" width={14} height={14} />
                    ) : m.brand === "shopify" ? (
                      <Image src="/channels/shopify.svg" alt="" width={14} height={14} />
                    ) : (
                      <Icon className="h-3.5 w-3.5" />
                    )}
                  </span>
                  {t(m.label)}
                </button>
              )
            })}
          </div>,
          document.body,
        )}
      <div className={cn(seg, "bg-border")} aria-hidden />
    </div>
  )
}

// ------------------------------------------------------------
// Per-step config editor
// ------------------------------------------------------------

function StepEditor({
  step,
  onChange,
}: {
  step: BuilderStep
  onChange: (s: BuilderStep) => void
}) {
  const t = useT()
  const cfg = step.step_config
  const templates = useContext(TemplatesContext)
  const trigger = useContext(TriggerContext)
  const set = (patch: Record<string, unknown>) =>
    onChange({ ...step, step_config: { ...cfg, ...patch } })
  // Template preview is collapsed by default (used only by send_template).
  const [showPreview, setShowPreview] = useState(false)

  switch (step.step_type) {
    case "send_message":
      return (
        <FieldBlock label={t("automations.messageText")}>
          <Textarea
            value={(cfg.text as string) ?? ""}
            onChange={(e) => set({ text: e.target.value })}
            placeholder={t("automations.messageTextPlaceholder")}
            className="min-h-24 bg-muted text-foreground"
          />
        </FieldBlock>
      )
    case "send_template": {
      const selectedTpl = templates.find(
        (tp) => tp.name === (cfg.template_name as string),
      )
      const varIndices = selectedTpl
        ? extractVariables(selectedTpl.body_text ?? "")
        : []
      const variables = (cfg.variables as Record<string, string> | undefined) ?? {}
      const setVar = (n: number, value: string) => {
        const next = { ...variables }
        if (value) next[String(n)] = value
        else delete next[String(n)]
        set({ variables: next })
      }
      return (
        <>
          <FieldBlock label={t("automations.whatsappTemplate")}>
            {templates.length > 0 ? (
              <select
                value={(cfg.template_name as string) ?? ""}
                onChange={(e) => {
                  const tpl = templates.find((tp) => tp.name === e.target.value)
                  // Cambiar de plantilla descarta el mapeo previo (los {{n}} de
                  // la nueva no se corresponden) y PRE-MAPEA desde el campo que
                  // la plantilla declaró para cada variable ({ "1": "customer_name" }
                  // → {{vars.customer_name}}). Así no hay que mapear a mano.
                  const declared = (tpl?.variable_fields ?? {}) as Record<string, string>
                  const seeded = Object.fromEntries(
                    Object.entries(declared).map(([n, key]) => [n, `{{vars.${key}}}`]),
                  )
                  set({
                    template_name: e.target.value,
                    language: tpl?.language ?? "es",
                    variables: seeded,
                  })
                }}
                className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                <option value="">{t("automations.chooseTemplate")}</option>
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.name}>
                    {tpl.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {t("automations.noApprovedTemplates")}{" "}
                <Link href="/plantillas" className="text-accent-ink underline hover:opacity-80">
                  {t("automations.createOne")}
                </Link>
                .
              </p>
            )}
          </FieldBlock>
          {varIndices.length > 0 && (
            <FieldBlock label={t("automations.templateVariables")}>
              <div className="space-y-2">
                {varIndices.map((n) => (
                  <div key={n} className="flex items-center gap-2">
                    <span className="w-9 shrink-0 rounded-md border border-border bg-muted px-1.5 py-1 text-center text-xs font-medium tabular-nums text-muted-foreground">
                      {`{{${n}}}`}
                    </span>
                    <select
                      value={variables[String(n)] ?? ""}
                      onChange={(e) => setVar(n, e.target.value)}
                      className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
                    >
                      <option value="">{t("automations.chooseVariable")}</option>
                      {templateDataPoints(trigger).map((dp) => (
                        <option key={dp.id} value={`{{vars.${dp.templateVarKey}}}`}>
                          {t(dp.labelKey)}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              {varIndices.some((n) => !variables[String(n)]) ? (
                <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                  {t("automations.templateVarsUnmapped")}
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t("automations.templateVariablesHint")}
                </p>
              )}
            </FieldBlock>
          )}
          {selectedTpl && (
            <div className="mt-3 border-t border-border pt-3">
              <button
                type="button"
                onClick={() => setShowPreview((v) => !v)}
                className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronDown
                  className={cn(
                    "h-3 w-3 transition-transform",
                    showPreview ? "rotate-180" : "",
                  )}
                />
                {t("automations.preview")}
              </button>
              {showPreview && (
                <div className="mt-2 origin-top scale-[0.8]">
                  <WhatsappPreview
                    headerType={(selectedTpl.header_type ?? "none") as TemplateHeaderType}
                    headerText={selectedTpl.header_content ?? undefined}
                    bodyText={(selectedTpl.body_text || "").replace(
                      /\{\{\s*(\d+)\s*\}\}/g,
                      (_, n) => {
                        const m = (variables[String(n)] ?? "").match(/\{\{vars\.(\w+)\}\}/)
                        return (m && SAMPLE_BY_VAR[m[1]]) || `{{${n}}}`
                      },
                    )}
                    footerText={selectedTpl.footer_text ?? undefined}
                    buttons={
                      (selectedTpl.buttons as unknown as TemplateButtonInput[] | null) ??
                      undefined
                    }
                  />
                </div>
              )}
            </div>
          )}
        </>
      )
    }
    case "add_tag":
    case "remove_tag":
      return (
        <FieldBlock label={t("automations.tag")}>
          <TagSelect
            value={(cfg.tag_id as string) ?? ""}
            onChange={(v) => set({ tag_id: v })}
            allowCreate
          />
        </FieldBlock>
      )
    case "assign_conversation":
      return (
        <>
          <FieldBlock label={t("automations.whoToAssign")}>
            <select
              value={(cfg.mode as string) ?? "round_robin"}
              onChange={(e) => set({ mode: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="round_robin">{t("automations.assignRoundRobin")}</option>
              <option value="specific">{t("automations.assignSpecific")}</option>
            </select>
          </FieldBlock>
          {cfg.mode === "specific" && (
            <FieldBlock label={t("automations.person")}>
              <AgentSelect
                value={(cfg.agent_id as string) ?? ""}
                onChange={(v) => set({ agent_id: v })}
              />
            </FieldBlock>
          )}
        </>
      )
    case "update_contact_field":
      return (
        <>
          <FieldBlock label={t("automations.whichField")}>
            <select
              value={(cfg.field as string) ?? "name"}
              onChange={(e) => set({ field: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="name">{t("automations.fieldName")}</option>
              <option value="email">{t("automations.fieldEmail")}</option>
              <option value="company">{t("automations.fieldCompany")}</option>
            </select>
          </FieldBlock>
          <FieldBlock label={t("automations.newValue")}>
            <Input
              value={(cfg.value as string) ?? ""}
              onChange={(e) => set({ value: e.target.value })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
        </>
      )
    case "wait":
      return (
        <div className="grid grid-cols-2 gap-2">
          <FieldBlock label={t("automations.amount")}>
            <Input
              type="number"
              min={1}
              value={(cfg.amount as number) ?? 1}
              onChange={(e) => set({ amount: Math.max(1, Number(e.target.value)) })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t("automations.unit")}>
            <select
              value={(cfg.unit as string) ?? "hours"}
              onChange={(e) => set({ unit: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="minutes">{t("automations.unitMinutes")}</option>
              <option value="hours">{t("automations.unitHours")}</option>
              <option value="days">{t("automations.unitDays")}</option>
            </select>
          </FieldBlock>
        </div>
      )
    case "condition":
      return <ConditionFields cfg={cfg} set={set} />

    case "switch":
      // The paths (each with its own filter) + "en otro caso" are edited in the
      // lanes on the canvas (SwitchBranches); here we only explain the model.
      return (
        <p className="text-[11px] text-muted-foreground">{t("automations.switchHint")}</p>
      )

    case "send_webhook":
      return (
        <>
          <FieldBlock label={t("automations.url")}>
            <Input
              value={(cfg.url as string) ?? ""}
              onChange={(e) => set({ url: e.target.value })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t("automations.bodyTemplateJson")}>
            <Textarea
              value={(cfg.body_template as string) ?? ""}
              onChange={(e) => set({ body_template: e.target.value })}
              className="min-h-20 bg-muted font-mono text-xs text-foreground"
            />
          </FieldBlock>
        </>
      )
    case "voice_call":
      return <VoiceCallStepEditor cfg={cfg} set={set} />
    case "close_conversation":
      return null
    default:
      return null
  }
}

/** Voice AI call step — pick the voice agent, the call script, and an
 *  optional one-off objective. Only voice-enabled agents are offered. */
function VoiceCallStepEditor({
  cfg,
  set,
}: {
  cfg: Record<string, unknown>
  set: (patch: Record<string, unknown>) => void
}) {
  const t = useT()
  const { workspace } = useWorkspace()
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!workspace?.id) return
    let cancelled = false
    ;(async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from("ai_agents")
        .select("id, name")
        .eq("workspace_id", workspace.id)
        .eq("voice_enabled", true)
        .is("deleted_at", null)
        .order("priority", { ascending: false })
      if (!cancelled) {
        setAgents((data ?? []) as { id: string; name: string }[])
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [workspace?.id])

  const CALL_TYPES: { value: string; label: string }[] = [
    { value: "", label: t("automations.voiceCallTypeAuto") },
    { value: "order_confirmation", label: t("automations.voiceCallTypeOrder") },
    { value: "cart_recovery", label: t("automations.voiceCallTypeCart") },
    { value: "followup", label: t("automations.voiceCallTypeFollowup") },
    { value: "manual", label: t("automations.voiceCallTypeManual") },
  ]

  return (
    <>
      <FieldBlock label={t("automations.voiceCallAgent")}>
        {loading ? (
          <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
        ) : agents.length > 0 ? (
          <select
            value={(cfg.agent_id as string) ?? ""}
            onChange={(e) => set({ agent_id: e.target.value })}
            className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
          >
            <option value="">{t("automations.voiceCallPickAgent")}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-xs text-muted-foreground">{t("automations.voiceCallNoAgents")}</p>
        )}
      </FieldBlock>
      <FieldBlock label={t("automations.voiceCallType")}>
        <select
          value={(cfg.call_type as string) ?? ""}
          onChange={(e) => set({ call_type: e.target.value })}
          className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
        >
          {CALL_TYPES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </FieldBlock>
      <FieldBlock label={t("automations.voiceCallObjective")}>
        <Textarea
          value={(cfg.objective_override as string) ?? ""}
          onChange={(e) => set({ objective_override: e.target.value })}
          placeholder={t("automations.voiceCallObjectivePlaceholder")}
          className="min-h-16 bg-muted text-foreground"
        />
      </FieldBlock>
    </>
  )
}

function FieldBlock({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-2 last:mb-0">
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

// i18n key pairs [singular, plural] for the wait-step preview, resolved
// with t() inside previewFor.
const WAIT_UNIT_LABELS: Record<string, [string, string]> = {
  minutes: ["automations.waitMinuteOne", "automations.waitMinuteOther"],
  hours: ["automations.waitHourOne", "automations.waitHourOther"],
  days: ["automations.waitDayOne", "automations.waitDayOther"],
}

/** One-line natural summary of a condition, e.g. "Unidades que compró al menos 4". */
function conditionPreview(cfg: Record<string, unknown>, t: TFn): string {
  const subject = cfg.subject as string | undefined
  const operand = cfg.operand as string | undefined
  if (!subject) return t("automations.previewDefineCondition")
  if (subject === "time_of_day")
    return operand ? `${t("automations.dpTimeOfDay")}: ${operand}` : t("automations.previewDefineCondition")
  const id = dataPointIdFromCfg(subject, operand, DATA_POINTS)
  const dp = id && id !== TIME_DP_ID ? dataPointById(id) : undefined
  if (!dp) return t("automations.previewDefineCondition")
  const label = t(dp.labelKey)
  const kind = dp.condition.kind
  if (kind === "tag" || kind === "segment") return label
  if (kind === "purchased") {
    // "Compró · No · en las últimas 3 horas". El renderer de booleanos
    // genérico decía "No, es su primera compra", que acá no viene al caso:
    // la pregunta no es si alguna vez compró, sino si compró en la ventana.
    const side = cfg.value === "true" ? t("automations.purchasedYes") : t("automations.purchasedNo")
    const m = /^([0-9]+)([mhd])$/.exec(String(operand ?? "24h"))
    const n = m ? m[1] : "24"
    const u = m ? m[2] : "h"
    const unitKey = u === "m" ? "automations.unitMinutes" : u === "d" ? "automations.unitDays" : "automations.unitHours"
    return `${side} · ${t("automations.condWindowLabel").toLowerCase()} ${n} ${t(unitKey).toLowerCase()}`
  }
  if (kind === "message") return `${label}: "${(cfg.value as string) ?? ""}"`
  const opKey = NUMBER_OPS.find((o) => o.op === (cfg.op ?? "eq"))?.key
  const opLabel = opKey ? t(opKey) : ""
  const val =
    dp.valueKind === "bool"
      ? cfg.value === "false"
        ? t("automations.repeatCustomerNo")
        : t("automations.repeatCustomerYes")
      : ((cfg.value as string) ?? "")
  const v2 =
    cfg.op === "between" && cfg.value2 ? ` ${t("automations.condAnd")} ${cfg.value2}` : ""
  return `${label} ${dp.valueKind === "bool" ? "" : opLabel} ${val}${v2}`.replace(/\s+/g, " ").trim()
}

function previewFor(step: BuilderStep, t: TFn): string {
  switch (step.step_type) {
    case "send_message":
      return (step.step_config.text as string) || t("automations.previewNoTextYet")
    case "send_template":
      return (step.step_config.template_name as string) || t("automations.previewChooseTemplate")
    case "wait": {
      const amount = Number(step.step_config.amount ?? 0)
      const unit = String(step.step_config.unit ?? "hours")
      const [one, many] = WAIT_UNIT_LABELS[unit] ?? ["", ""]
      if (!amount) return t("automations.previewDefineWait")
      return `${amount} ${amount === 1 ? (one ? t(one) : "") : many ? t(many) : ""}`
    }
    case "condition":
      return conditionPreview(step.step_config, t)
    case "switch": {
      const cases = step.switchData?.cases ?? []
      if (cases.length === 0) return t("automations.switchNeedsData")
      // One path reads as a plain Sí/No; several show the count.
      if (cases.length === 1) return conditionPreview(cases[0].cfg, t)
      return t("automations.switchCaseOther", { n: cases.length })
    }
    case "send_webhook":
      return (step.step_config.url as string) || t("automations.previewNoUrl")
    case "voice_call":
      return (step.step_config.agent_id as string)
        ? t("automations.voiceCallPreview")
        : t("automations.voiceCallPickAgent")
    default:
      return ""
  }
}

// ------------------------------------------------------------
// Tree mutation helpers
// ------------------------------------------------------------

function insertAt(
  steps: BuilderStep[],
  parent: ParentScope,
  index: number,
  node: BuilderStep,
): BuilderStep[] {
  if (parent.kind === "root") {
    const copy = [...steps]
    copy.splice(index, 0, node)
    return copy
  }
  return steps.map((s) => {
    if (s.cid !== parent.parentCid || !s.branches) return s
    const list = [...s.branches[parent.branch]]
    list.splice(index, 0, node)
    return { ...s, branches: { ...s.branches, [parent.branch]: list } }
  })
}

function mapAtPath(
  steps: BuilderStep[],
  path: StepPath,
  updater: (s: BuilderStep) => BuilderStep,
): BuilderStep[] {
  if (path.length === 0) return steps
  const head = path[0]
  const rest = path.slice(1)

  if (head.kind === "root") {
    return steps.map((s, i) => {
      if (i !== head.index) return s
      return rest.length === 0
        ? updater(s)
        : { ...s, branches: walkBranches(s.branches, rest, updater) }
    })
  }
  return steps.map((s) => {
    if (s.cid !== head.parentCid || !s.branches) return s
    const bucket = s.branches[head.branch]
    const updated = bucket.map((child, i) => {
      if (i !== head.index) return child
      return rest.length === 0
        ? updater(child)
        : { ...child, branches: walkBranches(child.branches, rest, updater) }
    })
    return { ...s, branches: { ...s.branches, [head.branch]: updated } }
  })
}

function walkBranches(
  branches: BuilderStep["branches"],
  path: StepPath,
  updater: (s: BuilderStep) => BuilderStep,
): BuilderStep["branches"] {
  if (!branches) return branches
  const head = path[0]
  if (head.kind !== "branch") return branches
  const bucket = branches[head.branch]
  const rest = path.slice(1)
  const updated = bucket.map((child, i) => {
    if (i !== head.index) return child
    return rest.length === 0
      ? updater(child)
      : { ...child, branches: walkBranches(child.branches, rest, updater) }
  })
  return { ...branches, [head.branch]: updated }
}

function removeAt(steps: BuilderStep[], path: StepPath): BuilderStep[] {
  if (path.length === 0) return steps
  const head = path[0]
  const rest = path.slice(1)
  if (head.kind === "root") {
    if (rest.length === 0) return steps.filter((_, i) => i !== head.index)
    return steps.map((s, i) =>
      i !== head.index ? s : { ...s, branches: removeFromBranches(s.branches, rest) },
    )
  }
  return steps.map((s) => {
    if (s.cid !== head.parentCid || !s.branches) return s
    const bucket = s.branches[head.branch]
    const next =
      rest.length === 0
        ? bucket.filter((_, i) => i !== head.index)
        : bucket.map((child, i) =>
            i !== head.index
              ? child
              : { ...child, branches: removeFromBranches(child.branches, rest) },
          )
    return { ...s, branches: { ...s.branches, [head.branch]: next } }
  })
}

function removeFromBranches(
  branches: BuilderStep["branches"],
  path: StepPath,
): BuilderStep["branches"] {
  if (!branches) return branches
  const head = path[0]
  if (head.kind !== "branch") return branches
  const rest = path.slice(1)
  const bucket = branches[head.branch]
  const next =
    rest.length === 0
      ? bucket.filter((_, i) => i !== head.index)
      : bucket.map((child, i) =>
          i !== head.index
            ? child
            : { ...child, branches: removeFromBranches(child.branches, rest) },
        )
  return { ...branches, [head.branch]: next }
}

function moveAt(
  steps: BuilderStep[],
  path: StepPath,
  direction: -1 | 1,
): BuilderStep[] {
  if (path.length === 0) return steps
  const head = path[0]
  const rest = path.slice(1)
  const swap = <T,>(arr: T[], i: number) => {
    const j = i + direction
    if (j < 0 || j >= arr.length) return arr
    const copy = [...arr]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    return copy
  }
  if (head.kind === "root") {
    if (rest.length === 0) return swap(steps, head.index)
    return steps.map((s, i) =>
      i !== head.index ? s : { ...s, branches: moveInBranches(s.branches, rest, direction) },
    )
  }
  return steps.map((s) => {
    if (s.cid !== head.parentCid || !s.branches) return s
    const bucket = s.branches[head.branch]
    const next = rest.length === 0 ? swap(bucket, head.index) : bucket
    return { ...s, branches: { ...s.branches, [head.branch]: next } }
  })
}

function moveInBranches(
  branches: BuilderStep["branches"],
  path: StepPath,
  direction: -1 | 1,
): BuilderStep["branches"] {
  if (!branches) return branches
  const head = path[0]
  if (head.kind !== "branch") return branches
  const rest = path.slice(1)
  const bucket = branches[head.branch]
  const swap = <T,>(arr: T[], i: number) => {
    const j = i + direction
    if (j < 0 || j >= arr.length) return arr
    const copy = [...arr]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    return copy
  }
  const next = rest.length === 0 ? swap(bucket, head.index) : bucket
  return { ...branches, [head.branch]: next }
}

// ------------------------------------------------------------
// Serialize builder tree → API payload (flattened shape)
// ------------------------------------------------------------

interface ApiStep {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: ApiStep[]; no?: ApiStep[] }
}

export function toApiSteps(steps: BuilderStep[]): ApiStep[] {
  const out: ApiStep[] = []
  for (const s of steps) {
    if (s.step_type === "switch") {
      // Compile the multi-path node to the nested binary-condition spine the
      // engine runs. With no cases at all, only the "en otro caso" path
      // persists, so the save still validates.
      const cases = s.switchData?.cases ?? []
      if (cases.length === 0) {
        out.push(...toApiSteps(s.switchData?.elseSteps ?? []))
        continue
      }
      const compiled = compileSwitch<BuilderStep>(s.switchData, toApiSteps)
      if (compiled) out.push(compiled as ApiStep)
      else out.push(...toApiSteps(s.switchData?.elseSteps ?? []))
      continue
    }
    out.push({
      step_type: s.step_type,
      step_config: s.step_config,
      branches: s.branches
        ? { yes: toApiSteps(s.branches.yes), no: toApiSteps(s.branches.no) }
        : undefined,
    })
  }
  return out
}

/**
 * Convert server-returned step tree (from loadStepsTree) into the
 * builder-local shape with client ids.
 */
export interface ServerStepNode {
  id: string
  step_type: string
  step_config: Record<string, unknown>
  branches: { yes: ServerStepNode[]; no: ServerStepNode[] }
}

// ------------------------------------------------------------
// Canvas viewport — pan + zoom around the trigger/step flow.
// Keeps node geometry as plain flex layout so the existing add/move/delete
// logic is untouched; this wrapper only transforms the viewport.
// ------------------------------------------------------------

const MIN_SCALE = 0.25
const MAX_SCALE = 2

function clampScale(s: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))
}

/** Selectors a click on which should not start a pan — the user is
 *  trying to interact with a control, not move the canvas. */
const INTERACTIVE_SELECTOR =
  'input, textarea, select, button, a, label, [role="combobox"], [role="button"], [role="textbox"], [contenteditable="true"]'

function CanvasViewport({ children }: { children: React.ReactNode }) {
  const t = useT()
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const [dragging, setDragging] = useState(false)
  const hasCenteredRef = useRef(false)
  const dragRef = useRef<{
    startX: number
    startY: number
    startTx: number
    startTy: number
  } | null>(null)

  const zoomAt = useCallback(
    (clientX: number, clientY: number, nextScale: number) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const ox = clientX - rect.left
      const oy = clientY - rect.top
      const next = clampScale(nextScale)
      const ratio = next / scale
      setTx(ox - (ox - tx) * ratio)
      setTy(oy - (oy - ty) * ratio)
      setScale(next)
    },
    [scale, tx, ty],
  )

  /** Frame the workflow into the viewport with comfortable padding,
   *  scaling down if it doesn't fit at 100%. Used on first mount and
   *  whenever the user hits the "Centrar" button. */
  const fitToView = useCallback(() => {
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content) return
    // The content is rendered at scale 1 inside the transform; clientWidth
    // reflects its untransformed layout size.
    const cw = container.clientWidth
    const ch = container.clientHeight
    const w = content.scrollWidth
    const h = content.scrollHeight
    if (!w || !h) return
    const padding = 80
    const scaleFit = Math.min(
      1,
      (cw - padding) / w,
      (ch - padding) / h,
    )
    const s = clampScale(scaleFit)
    setScale(s)
    setTx((cw - w * s) / 2)
    setTy((ch - h * s) / 2)
  }, [])

  // Center the chain on first paint so the trigger card isn't pinned
  // against the left edge.
  useEffect(() => {
    if (hasCenteredRef.current) return
    const id = requestAnimationFrame(() => {
      fitToView()
      hasCenteredRef.current = true
    })
    return () => cancelAnimationFrame(id)
  }, [fitToView])

  // Native wheel listener — React's synthetic onWheel is passive in React 19,
  // so preventDefault() inside the handler is a no-op there. Bind manually.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const factor = Math.exp(-e.deltaY * 0.0015)
        zoomAt(e.clientX, e.clientY, scale * factor)
      } else {
        // Plain wheel / trackpad two-finger → pan.
        e.preventDefault()
        setTx((v) => v - e.deltaX)
        setTy((v) => v - e.deltaY)
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [scale, zoomAt])

  // Pointer-based pan + pinch-zoom. Pointer Events cover mouse, touch and
  // pen, so the builder pans with one finger and pinch-zooms with two on a
  // phone/tablet — not just left-drag on desktop. Middle mouse still pans.
  // Clicks on form controls/buttons pass through so inputs/menus keep
  // working. `touch-action: none` on the container (below) stops the page
  // from scrolling/zooming under the gesture. setPointerCapture replaces the
  // old window-level mouse listeners.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchRef = useRef<{
    startDist: number
    startScale: number
    cx: number
    cy: number
  } | null>(null)

  function onPointerDown(e: React.PointerEvent) {
    const target = e.target as HTMLElement
    if (target.closest(INTERACTIVE_SELECTOR)) return
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return

    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    e.currentTarget.setPointerCapture?.(e.pointerId)

    if (pointersRef.current.size === 2) {
      dragRef.current = null
      setDragging(false)
      const [a, b] = [...pointersRef.current.values()]
      pinchRef.current = {
        startDist: Math.hypot(a.x - b.x, a.y - b.y),
        startScale: scale,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
      }
    } else if (pointersRef.current.size === 1) {
      e.preventDefault()
      dragRef.current = { startX: e.clientX, startY: e.clientY, startTx: tx, startTy: ty }
      setDragging(true)
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointersRef.current.has(e.pointerId)) return
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pinchRef.current && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinchRef.current.startDist > 0) {
        const ratio = dist / pinchRef.current.startDist
        zoomAt(pinchRef.current.cx, pinchRef.current.cy, pinchRef.current.startScale * ratio)
      }
      return
    }
    if (dragRef.current) {
      setTx(dragRef.current.startTx + (e.clientX - dragRef.current.startX))
      setTy(dragRef.current.startTy + (e.clientY - dragRef.current.startY))
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pointersRef.current.delete(e.pointerId)
    if (pointersRef.current.size < 2) pinchRef.current = null
    if (pointersRef.current.size === 0) {
      dragRef.current = null
      setDragging(false)
    }
  }

  function zoomByButton(delta: number) {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, scale + delta)
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
      style={{ touchAction: "none" }}
      className={cn(
        "relative flex-1 overflow-hidden select-none",
        dragging ? "cursor-grabbing" : "cursor-grab",
      )}
    >
      {/* Dot grid — moves with the viewport so panning feels physical. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--border) 1px, transparent 1px)",
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
      <div className="absolute bottom-4 right-4 flex items-center gap-0.5 rounded-lg border border-border bg-card/95 px-1 py-1 shadow-lg backdrop-blur">
        <button
          type="button"
          onClick={() => zoomByButton(-0.1)}
          className="flex h-10 w-10 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:h-auto lg:w-auto lg:p-1.5"
          title={t("automations.zoomOutTitle")}
          aria-label={t("automations.zoomOut")}
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={fitToView}
          className="min-w-[3.5rem] rounded px-1 py-1 text-center text-xs tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={t("automations.centerAndFit")}
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          onClick={() => zoomByButton(0.1)}
          className="flex h-10 w-10 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:h-auto lg:w-auto lg:p-1.5"
          title={t("automations.zoomInTitle")}
          aria-label={t("automations.zoomIn")}
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <div className="mx-1 h-4 w-px bg-border" />
        <button
          type="button"
          onClick={fitToView}
          className="flex h-10 w-10 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:h-auto lg:w-auto lg:p-1.5"
          title={t("automations.centerFlowTitle")}
          aria-label={t("automations.center")}
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>

    </div>
  )
}

/** True when every step is a flat action (no branches, not a switch/condition)
 *  → safe to render inside a self-contained switch case/else lane. */
function allLeaf(steps: BuilderStep[]): boolean {
  return steps.every(
    (s) => !s.branches && s.step_type !== "switch" && s.step_type !== "condition",
  )
}

export function fromServerSteps(nodes: StepShape[]): BuilderStep[] {
  return nodes.map((n) => {
    // Collapse a switch-shaped same-data-point condition chain back into one
    // multi-case node — but only when every case + else is a flat action list.
    // Anything with nested branching stays as plain conditions so no step is
    // ever hidden by the leaf-only switch card.
    if (n.step_type === "condition") {
      const sd = collapseSwitch<BuilderStep>(n, fromServerSteps, cid)
      // Present as the unified multi-path "Condición" card ONLY when every path
      // + the "en otro caso" is a flat action list — each case now edits its own
      // filter via ConditionFields, so any data point (number/offer/tag/segment/
      // time/…) is fine. A branch that itself branches stays a plain binary
      // condition card so no step is ever hidden.
      if (sd && sd.cases.every((c) => allLeaf(c.steps)) && allLeaf(sd.elseSteps)) {
        return {
          cid: cid(),
          step_type: "switch" as BuilderStepType,
          step_config: {},
          switchData: sd,
        }
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
        n.step_type === "condition"
          ? {
              yes: fromServerSteps(n.branches?.yes ?? []),
              no: fromServerSteps(n.branches?.no ?? []),
            }
          : undefined,
    }
  })
}
