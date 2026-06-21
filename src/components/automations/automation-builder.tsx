"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
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
  Webhook,
  CircleSlash,
  Zap,
  Loader2,
  ArrowRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  X as XIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { useT } from "@/hooks/use-locale"
import type { TFn } from "@/lib/i18n/translate"
import { cn } from "@/lib/utils"
import { WhatsappPreview } from "@/components/templates/whatsapp-preview"
import type {
  TemplateButtonInput,
  TemplateHeaderType,
} from "@/lib/whatsapp/template-components"

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

/** Team members. Powers the agent picker when a conversation is assigned
 *  to a specific person — name in the menu, user id under the hood. */
const AgentsContext = createContext<Profile[]>([])

// ------------------------------------------------------------
// Types (builder-local — mirror the flattened rows we POST)
// ------------------------------------------------------------

export interface BuilderStep {
  /** Client id; the API assigns real UUIDs server-side. */
  cid: string
  step_type: AutomationStepType
  step_config: Record<string, unknown>
  branches?: { yes: BuilderStep[]; no: BuilderStep[] }
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
const STEP_META: Record<AutomationStepType, StepMeta> = {
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
}

// `send_message` (free-text) is intentionally NOT in the picker — Meta
// requires an approved template for any send that may fall outside the
// 24-hour customer-service window, which is true for every automation
// that includes a `wait` step. The type stays in the union so legacy
// rows still load, but new steps must be a template.
const ADDABLE_STEPS: AutomationStepType[] = [
  "send_template",
  "add_tag",
  "remove_tag",
  "assign_conversation",
  "update_contact_field",
  "wait",
  "condition",
  "send_webhook",
  "close_conversation",
]

// Selectable triggers are intentionally limited to Shopify events +
// "tag added". The other trigger types still exist in the engine/types
// (so any legacy automation keeps firing and renders its label via
// TRIGGER_META), they're just not offered when building a new one.
// `label` holds an i18n key, resolved with t() inside the trigger card.
const TRIGGER_OPTIONS: { value: AutomationTriggerType; label: string }[] = [
  { value: "tag_added", label: "automations.triggerTagAdded" },
  { value: "shopify_order_created", label: "automations.triggerShopifyOrderCreated" },
  { value: "shopify_order_fulfilled", label: "automations.triggerShopifyOrderFulfilled" },
  { value: "shopify_abandoned_checkout", label: "automations.triggerShopifyAbandonedCheckout" },
]

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
// Common order data a merchant might branch on. The `key` is the real
// context.vars name the Shopify webhook seeds (see buildVarsForOrder in
// the orders webhook); the label is what the user sees.
// `label` holds an i18n key, resolved with t() inside the condition fields.
const ORDER_DATA_OPTIONS: { key: string; label: string }[] = [
  { key: "is_repeat_customer", label: "automations.orderDataRepeatCustomer" },
  { key: "total_price", label: "automations.orderDataTotalPrice" },
  { key: "item_count", label: "automations.orderDataItemCount" },
  { key: "first_item", label: "automations.orderDataFirstItem" },
  { key: "currency", label: "automations.orderDataCurrency" },
  { key: "order_number", label: "automations.orderDataOrderNumber" },
  { key: "tracking_number", label: "automations.orderDataTrackingNumber" },
]

function ConditionFields({
  cfg,
  set,
}: {
  cfg: Record<string, unknown>
  set: (patch: Record<string, unknown>) => void
}) {
  const t = useT()
  const segments = useContext(SegmentsContext)
  const subject = (cfg.subject as string) ?? "tag_presence"
  return (
    <>
      <FieldBlock label={t("automations.conditionWhatToCheck")}>
        <select
          value={subject}
          onChange={(e) => set({ subject: e.target.value, operand: "", value: "" })}
          className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
        >
          <option value="tag_presence">{t("automations.conditionSubjectTagPresence")}</option>
          <option value="in_segment">{t("automations.conditionSubjectInSegment")}</option>
          <option value="contact_field">{t("automations.conditionSubjectContactField")}</option>
          <option value="message_content">{t("automations.conditionSubjectMessageContent")}</option>
          <option value="time_of_day">{t("automations.conditionSubjectTimeOfDay")}</option>
          <option value="context_var">{t("automations.conditionSubjectContextVar")}</option>
        </select>
      </FieldBlock>

      {subject === "tag_presence" && (
        <FieldBlock label={t("automations.tag")}>
          <TagSelect
            value={(cfg.operand as string) ?? ""}
            onChange={(v) => set({ operand: v })}
          />
        </FieldBlock>
      )}

      {subject === "in_segment" && (
        <FieldBlock label={t("automations.segment")}>
          <select
            value={(cfg.operand as string) ?? ""}
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

      {subject === "contact_field" && (
        <>
          <FieldBlock label={t("automations.field")}>
            <select
              value={(cfg.operand as string) ?? "name"}
              onChange={(e) => set({ operand: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="name">{t("automations.fieldName")}</option>
              <option value="email">{t("automations.fieldEmail")}</option>
              <option value="company">{t("automations.fieldCompany")}</option>
            </select>
          </FieldBlock>
          <FieldBlock label={t("automations.equals")}>
            <Input
              value={(cfg.value as string) ?? ""}
              onChange={(e) => set({ value: e.target.value })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
        </>
      )}

      {subject === "message_content" && (
        <FieldBlock label={t("automations.messageContains")}>
          {/* Engine matches on `value`; we mirror it into `operand` so the
              activation check (which requires a non-empty operand for every
              condition) passes without a second field. */}
          <Input
            value={(cfg.value as string) ?? ""}
            onChange={(e) => set({ value: e.target.value, operand: e.target.value })}
            placeholder={t("automations.messageContainsPlaceholder")}
            className="bg-muted text-foreground"
          />
        </FieldBlock>
      )}

      {subject === "time_of_day" && (
        <FieldBlock label={t("automations.betweenTheseHours")}>
          <Input
            value={(cfg.operand as string) ?? ""}
            onChange={(e) => set({ operand: e.target.value })}
            placeholder="09:00-18:00"
            className="bg-muted text-foreground"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("automations.timeRangeHint")}
          </p>
        </FieldBlock>
      )}

      {subject === "context_var" && (
        <>
          <FieldBlock label={t("automations.orderData")}>
            <select
              value={(cfg.operand as string) ?? ""}
              onChange={(e) => set({ operand: e.target.value, value: "" })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="">{t("automations.chooseData")}</option>
              {ORDER_DATA_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {t(o.label)}
                </option>
              ))}
            </select>
          </FieldBlock>
          {cfg.operand === "is_repeat_customer" ? (
            <FieldBlock label={t("automations.whenItIs")}>
              <select
                value={(cfg.value as string) ?? "true"}
                onChange={(e) => set({ value: e.target.value })}
                className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
              >
                <option value="true">{t("automations.repeatCustomerYes")}</option>
                <option value="false">{t("automations.repeatCustomerNo")}</option>
              </select>
            </FieldBlock>
          ) : cfg.operand ? (
            <FieldBlock label={t("automations.equals")}>
              <Input
                value={(cfg.value as string) ?? ""}
                onChange={(e) => set({ value: e.target.value })}
                className="bg-muted text-foreground"
              />
            </FieldBlock>
          ) : null}
        </>
      )}
    </>
  )
}

/** Tag dropdown — name in the menu, tag id in the value. Used anywhere a
 *  step or condition needs to point at a tag without the user knowing it
 *  has an id at all. */
function TagSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const t = useT()
  const tags = useContext(TagsContext)
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

function blankConfig(type: AutomationStepType): Record<string, unknown> {
  switch (type) {
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
      return { subject: "tag_presence", operand: "", value: "" }
    case "send_webhook":
      return { url: "", headers: {}, body_template: "" }
    case "close_conversation":
      return {}
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
  const router = useRouter()
  const fetchWithCsrf = useFetchWithCsrf()
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
  const [previewOpen, setPreviewOpen] = useState(false)

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
      const [{ data: tpl }, { data: seg }, { data: tg }, { data: ag }] =
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
        ])
      setTemplates((tpl as MessageTemplate[]) ?? [])
      setSegments((seg as ContactSegment[]) ?? [])
      setTags((tg as ContactTag[]) ?? [])
      setAgents((ag as Profile[]) ?? [])
    })()
  }, [])

  function patchTop<K extends keyof BuilderInitial>(key: K, value: BuilderInitial[K]) {
    setState((s) => ({ ...s, [key]: value }))
  }

  // --- Step tree mutations (immutable) ---

  function updateStep(path: StepPath, updater: (s: BuilderStep) => BuilderStep) {
    setState((s) => ({ ...s, steps: mapAtPath(s.steps, path, updater) }))
  }

  function addStepAt(parent: ParentScope, index: number, type: AutomationStepType) {
    const node: BuilderStep = {
      cid: cid(),
      step_type: type,
      step_config: blankConfig(type),
      branches: type === "condition" ? { yes: [], no: [] } : undefined,
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
    <TemplatesContext.Provider value={templates}>
    <SegmentsContext.Provider value={segments}>
    <TagsContext.Provider value={tags}>
    <AgentsContext.Provider value={agents}>
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

        {/* Live phone preview — collapsible. Only useful for steps that
            actually render a message (send_message / send_template); we
            tuck it away by default so the canvas gets the full width
            and the user opens it from the floating button when needed. */}
        {previewOpen && (
          <aside className="hidden w-[340px] shrink-0 overflow-y-auto border-l border-border bg-card/40 px-4 py-6 lg:block">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-medium text-foreground">{t("automations.preview")}</p>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={t("automations.closePreview")}
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            <MessagePreviewRail steps={state.steps} expandedId={expandedId} />
          </aside>
        )}
        {!previewOpen && (
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="hidden absolute right-4 top-20 z-10 items-center gap-1.5 rounded-lg border border-border bg-card/95 px-3 py-1.5 text-xs text-foreground shadow-lg backdrop-blur transition-colors hover:bg-accent lg:inline-flex"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            {t("automations.preview")}
          </button>
        )}
      </div>
    </div>
    </AgentsContext.Provider>
    </TagsContext.Provider>
    </SegmentsContext.Provider>
    </TemplatesContext.Provider>
  )
}

// ------------------------------------------------------------
// Live phone preview rail
// ------------------------------------------------------------

/** Depth-first search for a step by cid across the branch tree. */
function findStepByCid(steps: BuilderStep[], cid: string | null): BuilderStep | null {
  if (!cid) return null
  for (const s of steps) {
    if (s.cid === cid) return s
    if (s.branches) {
      const found =
        findStepByCid(s.branches.yes, cid) ?? findStepByCid(s.branches.no, cid)
      if (found) return found
    }
  }
  return null
}

/** First send_message / send_template anywhere in the tree (fallback). */
function firstMessageStep(steps: BuilderStep[]): BuilderStep | null {
  for (const s of steps) {
    if (s.step_type === "send_message" || s.step_type === "send_template") return s
    if (s.branches) {
      const found =
        firstMessageStep(s.branches.yes) ?? firstMessageStep(s.branches.no)
      if (found) return found
    }
  }
  return null
}

function MessagePreviewRail({
  steps,
  expandedId,
}: {
  steps: BuilderStep[]
  expandedId: string | null
}) {
  const t = useT()
  const templates = useContext(TemplatesContext)

  // Prefer the step being edited; otherwise show the first message step.
  const expanded = findStepByCid(steps, expandedId)
  const target =
    expanded &&
    (expanded.step_type === "send_message" || expanded.step_type === "send_template")
      ? expanded
      : firstMessageStep(steps)

  const preview = useMemo(() => {
    if (!target) return null
    if (target.step_type === "send_message") {
      return {
        headerType: "none" as TemplateHeaderType,
        bodyText: (target.step_config.text as string) || "",
        footerText: undefined as string | undefined,
        buttons: undefined as TemplateButtonInput[] | undefined,
      }
    }
    // send_template → resolve the chosen template's content.
    const name = target.step_config.template_name as string | undefined
    const tpl = templates.find((t) => t.name === name)
    if (!tpl) {
      return {
        headerType: "none" as TemplateHeaderType,
        bodyText: name
          ? t("automations.templateLabel", { name })
          : t("automations.selectTemplatePlaceholder"),
        footerText: undefined,
        buttons: undefined,
      }
    }
    return {
      headerType: (tpl.header_type ?? "none") as TemplateHeaderType,
      headerText: tpl.header_content ?? undefined,
      bodyText: tpl.body_text || "",
      footerText: tpl.footer_text ?? undefined,
      buttons: undefined as TemplateButtonInput[] | undefined,
    }
  }, [target, templates, t])

  return (
    <div className="space-y-3">
      {preview ? (
        <WhatsappPreview
          headerType={preview.headerType}
          headerText={
            "headerText" in preview ? (preview.headerText as string | undefined) : undefined
          }
          bodyText={preview.bodyText}
          footerText={preview.footerText}
          buttons={preview.buttons}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("automations.addMessageStepHint")}
        </p>
      )}
    </div>
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
              {(() => {
                const opt = TRIGGER_OPTIONS.find((o) => o.value === type)
                return opt ? t(opt.label) : type
              })()}
            </div>
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
          </div>
        )}
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
  addStepAt: (parent: ParentScope, index: number, type: AutomationStepType) => void
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
  // Card widths on mobile fill the full canvas column (max-w-2xl px-4
  // still keeps them reasonable). On sm+ the original fixed widths
  // come back so the flow visual stays recognisable.
  const width = isCondition
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
                {isCondition
                  ? t("automations.kindCondition")
                  : step.step_type === "wait"
                    ? t("automations.kindWait")
                    : t("automations.kindAction")}
              </div>
              <div className="truncate text-sm font-medium text-foreground">{t(meta.label)}</div>
              <div className="truncate text-[11px] text-muted-foreground">{previewFor(step, t)}</div>
            </div>
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
      ) : (
        <div className="z-10">{cardEl}</div>
      )}

      <AddButton
        orientation="h"
        onPick={(t) => props.addStepAt(parentScope, index + 1, t)}
      />
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

function AddButton({
  onPick,
  orientation = "v",
}: {
  onPick: (t: AutomationStepType) => void
  orientation?: "h" | "v"
}) {
  const t = useT()
  const seg = orientation === "h" ? "h-[2px] w-6" : "h-6 w-[2px]"
  return (
    <div
      className={cn(
        "group/add relative flex items-center",
        // Top-align in horizontal mode so the line meets the card header
        // (cards grow downward when expanded / when conditions sprout
        // branches), ~28px ≈ half the collapsed header height.
        orientation === "h" ? "flex-row self-start mt-7" : "flex-col",
      )}
    >
      <div className={cn(seg, "bg-border")} aria-hidden />
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full border-2 border-dashed border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-all",
            "hover:border-primary hover:bg-primary/10 hover:text-accent-ink",
            "data-[popup-open]:border-primary data-[popup-open]:bg-primary/15 data-[popup-open]:text-accent-ink",
          )}
          aria-label={t("automations.addStep")}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("automations.add")}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-80 min-w-64 overflow-y-auto border-border bg-card"
        >
          <div className="border-b border-border px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("automations.chooseWhatToDo")}
          </div>
          {ADDABLE_STEPS.map((stepType) => {
            const m = STEP_META[stepType]
            const Icon = m.icon
            return (
              <DropdownMenuItem key={stepType} onClick={() => onPick(stepType)}>
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
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
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
  const set = (patch: Record<string, unknown>) =>
    onChange({ ...step, step_config: { ...cfg, ...patch } })

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
    case "send_template":
      return (
        <FieldBlock label={t("automations.whatsappTemplate")}>
          {templates.length > 0 ? (
            <select
              value={(cfg.template_name as string) ?? ""}
              onChange={(e) => {
                const tpl = templates.find((tp) => tp.name === e.target.value)
                set({
                  template_name: e.target.value,
                  language: tpl?.language ?? "es",
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
      )
    case "add_tag":
    case "remove_tag":
      return (
        <FieldBlock label={t("automations.tag")}>
          <TagSelect
            value={(cfg.tag_id as string) ?? ""}
            onChange={(v) => set({ tag_id: v })}
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
    case "close_conversation":
      return null
    default:
      return null
  }
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

// i18n keys for the condition-step preview line, resolved with t().
const CONDITION_SUBJECT_PREVIEW: Record<string, string> = {
  tag_presence: "automations.conditionPreviewTagPresence",
  in_segment: "automations.conditionPreviewInSegment",
  contact_field: "automations.conditionPreviewContactField",
  message_content: "automations.conditionPreviewMessageContent",
  time_of_day: "automations.conditionPreviewTimeOfDay",
  context_var: "automations.conditionPreviewContextVar",
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
    case "condition": {
      const key = CONDITION_SUBJECT_PREVIEW[String(step.step_config.subject ?? "")]
      return key ? t(key) : t("automations.previewDefineCondition")
    }
    case "send_webhook":
      return (step.step_config.url as string) || t("automations.previewNoUrl")
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
  return steps.map((s) => ({
    step_type: s.step_type,
    step_config: s.step_config,
    branches: s.branches
      ? { yes: toApiSteps(s.branches.yes), no: toApiSteps(s.branches.no) }
      : undefined,
  }))
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

export function fromServerSteps(nodes: ServerStepNode[]): BuilderStep[] {
  return nodes.map((n) => ({
    cid: cid(),
    step_type: n.step_type as AutomationStepType,
    step_config: n.step_config ?? {},
    branches:
      n.step_type === "condition"
        ? {
            yes: fromServerSteps(n.branches?.yes ?? []),
            no: fromServerSteps(n.branches?.no ?? []),
          }
        : undefined,
  }))
}
