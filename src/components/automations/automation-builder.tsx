"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowLeft,
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
  ArrowDown,
  ArrowUp,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Layers,
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
} from "@/types"
import type { ContactSegment } from "@/lib/segments/types"
import { createClient } from "@/lib/supabase/client"
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
  label: string
  icon: typeof Zap
  /** Left-border accent color per spec. */
  border: string
}

const STEP_META: Record<AutomationStepType, StepMeta> = {
  send_message: { label: "Enviar mensaje", icon: MessageSquare, border: "border-l-primary" },
  send_template: { label: "Enviar plantilla", icon: FileText, border: "border-l-primary" },
  add_tag: { label: "Añadir etiqueta", icon: Tag, border: "border-l-primary" },
  remove_tag: { label: "Quitar etiqueta", icon: TagIcon, border: "border-l-primary" },
  assign_conversation: { label: "Asignar conversación", icon: UserCheck, border: "border-l-primary" },
  update_contact_field: { label: "Actualizar campo del contacto", icon: PencilLine, border: "border-l-primary" },
  wait: { label: "Esperar", icon: Hourglass, border: "border-l-border" },
  condition: { label: "Condición (Si/Si no)", icon: GitBranch, border: "border-l-amber-500" },
  send_webhook: { label: "Enviar webhook", icon: Webhook, border: "border-l-primary" },
  close_conversation: { label: "Cerrar conversación", icon: CircleSlash, border: "border-l-primary" },
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

const TRIGGER_OPTIONS: { value: AutomationTriggerType; label: string }[] = [
  { value: "new_message_received", label: "Nuevo mensaje recibido" },
  { value: "first_inbound_message", label: "Primer mensaje del contacto" },
  { value: "keyword_match", label: "Coincidencia de palabra clave" },
  { value: "new_contact_created", label: "Nuevo contacto creado" },
  { value: "conversation_assigned", label: "Conversación asignada" },
  { value: "tag_added", label: "Etiqueta añadida" },
  { value: "time_based", label: "Programada" },
  { value: "shopify_abandoned_checkout", label: "Carrito abandonado (Shopify)" },
  { value: "shopify_order_created", label: "Nuevo pedido (Shopify)" },
  { value: "shopify_order_fulfilled", label: "Pedido despachado (Shopify)" },
]

/**
 * Sub-bar between the header and the canvas. Lets the user scope the
 * whole automation to a saved segment — the engine will skip firing
 * for contacts that don't currently match.
 */
function AudienceStrip({
  segments,
  value,
  onChange,
}: {
  segments: ContactSegment[]
  value: string | null
  onChange: (v: string | null) => void
}) {
  const selected = value ? segments.find((s) => s.id === value) : null
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card/40 px-4 py-2 text-xs">
      <Layers className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-muted-foreground">Audiencia:</span>
      {segments.length === 0 ? (
        <a href="/contacts?tab=segments" className="text-muted-foreground underline hover:text-foreground">
          Crear segmento
        </a>
      ) : (
        <>
          <select
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value || null)}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">Todos los contactos</option>
            {segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {selected && (
            <button
              type="button"
              onClick={() => onChange(null)}
              title="Quitar filtro"
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Condition step body. Lives in its own component so it can pull the
 * saved-segment list from SegmentsContext (the `in_segment` subject
 * needs a real dropdown, not a free-text segment-id field).
 */
function ConditionFields({
  cfg,
  set,
}: {
  cfg: Record<string, unknown>
  set: (patch: Record<string, unknown>) => void
}) {
  const segments = useContext(SegmentsContext)
  const subject = (cfg.subject as string) ?? "tag_presence"
  return (
    <>
      <FieldBlock label="Sujeto">
        <select
          value={subject}
          onChange={(e) => set({ subject: e.target.value, operand: "", value: "" })}
          className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
        >
          <option value="tag_presence">Presencia de etiqueta</option>
          <option value="contact_field">Campo del contacto</option>
          <option value="message_content">Contenido del mensaje</option>
          <option value="time_of_day">Hora del día</option>
          <option value="in_segment">Pertenece a un segmento</option>
          <option value="context_var">Variable del evento (Shopify, etc.)</option>
        </select>
      </FieldBlock>
      {subject === "in_segment" ? (
        <FieldBlock label="Segmento">
          <select
            value={(cfg.operand as string) ?? ""}
            onChange={(e) => set({ operand: e.target.value })}
            className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
          >
            <option value=""></option>
            {segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </FieldBlock>
      ) : (
        <FieldBlock label="Operando">
          <Input
            placeholder={
              subject === "time_of_day"
                ? "HH:mm-HH:mm"
                : subject === "contact_field"
                ? "nombre / correo / empresa"
                : subject === "tag_presence"
                ? "ID de la etiqueta"
                : subject === "context_var"
                ? "is_repeat_customer / total_price / tracking_number…"
                : ""
            }
            value={(cfg.operand as string) ?? ""}
            onChange={(e) => set({ operand: e.target.value })}
            className="bg-muted text-foreground"
          />
        </FieldBlock>
      )}
      {(subject === "contact_field" ||
        subject === "message_content" ||
        subject === "context_var") && (
        <FieldBlock label="Valor">
          <Input
            value={(cfg.value as string) ?? ""}
            onChange={(e) => set({ value: e.target.value })}
            className="bg-muted text-foreground"
          />
        </FieldBlock>
      )}
    </>
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

export function AutomationBuilder({ initial }: { initial: BuilderInitial }) {
  const router = useRouter()
  const isEditing = !!initial.id
  const [state, setState] = useState<BuilderInitial>(initial)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [segments, setSegments] = useState<ContactSegment[]>([])
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
      const [{ data: tpl }, { data: seg }] = await Promise.all([
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
      ])
      setTemplates((tpl as MessageTemplate[]) ?? [])
      setSegments((seg as ContactSegment[]) ?? [])
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
        name: state.name || "Automatización sin título",
        description: state.description || null,
        trigger_type: state.trigger_type,
        trigger_config: state.trigger_config,
        audience_segment_id: state.audience_segment_id ?? null,
        is_active: state.is_active,
        steps: toApiSteps(state.steps),
      }

      const res = isEditing
        ? await fetch(`/api/automations/${initial.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/automations`, {
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
          toast.error(body?.error ?? "No se pudo guardar")
        }
        return
      }
      toast.success(isEditing ? "Guardada" : "Creada")
      if (!isEditing && body?.automation?.id) {
        router.replace(`/automations/${body.automation.id}/edit`)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <TemplatesContext.Provider value={templates}>
    <SegmentsContext.Provider value={segments}>
    <div className="fixed inset-0 flex flex-col bg-background">
      {/* Top bar. At sub-sm widths the "Active" label is hidden and the
          switch moves to the right of the save button, so the name input
          gets maximum width. */}
      <header className="flex flex-shrink-0 items-center gap-2 border-b border-border bg-card/80 px-3 py-3 sm:gap-3 sm:px-4">
        <button
          type="button"
          onClick={() => router.push("/automations")}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Atrás"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <input
          value={state.name}
          onChange={(e) => patchTop("name", e.target.value)}
          placeholder="Automatización sin título"
          className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus:bg-accent focus:outline-none sm:text-base"
        />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="hidden sm:inline">Activa</span>
          <Switch
            checked={state.is_active}
            onCheckedChange={(v) => patchTop("is_active", !!v)}
            aria-label="Activa"
          />
        </div>
        <Button
          onClick={save}
          disabled={saving}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isEditing ? "Guardar" : "Guardar borrador"}
        </Button>
      </header>

      <AudienceStrip
        segments={segments}
        value={state.audience_segment_id ?? null}
        onChange={(v) => patchTop("audience_segment_id", v)}
      />

      {/* Body: canvas + live phone preview rail (like the template builder). */}
      <div className="relative flex min-h-0 flex-1">
        {/* Canvas — Miro-style infinite viewport: pan with middle mouse or
            Space+drag, zoom with Ctrl+wheel, trackpad two-finger scrolls,
            buttons for explicit zoom + reset. Trigger → steps still flow
            left-to-right inside; condition branches stay vertical. */}
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
              <p className="text-xs font-medium text-foreground">Vista previa</p>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Cerrar vista previa"
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
            Vista previa
          </button>
        )}
      </div>
    </div>
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
        bodyText: name ? `Plantilla: ${name}` : "Selecciona una plantilla…",
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
  }, [target, templates])

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
          Añade un paso de mensaje para ver la vista previa.
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
  const [open, setOpen] = useState(false)
  return (
    // Card width: full on mobile, fixed 320px on sm+. The canvas wrapper
    // (max-w-2xl + px-4) keeps this tidy on tablet/desktop.
    <div className="z-10 w-full max-w-[320px] sm:w-80">
      <div className="rounded-lg border border-border border-l-4 border-l-blue-500 bg-card shadow-lg">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-500/10 text-blue-400">
            <Zap className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wide text-blue-300">Activador</div>
            <div className="truncate text-sm font-medium text-foreground">
              {TRIGGER_OPTIONS.find((o) => o.value === type)?.label ?? type}
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
                    {o.label}
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
              <Input
              placeholder="ID de la etiqueta"
                value={(config.tag_id as string) ?? ""}
                onChange={(e) =>
                  onConfigChange({ ...config, tag_id: e.target.value })
                }
                className="bg-muted text-foreground"
              />
            )}
            {type === "time_based" && (
              <Input
              placeholder="Expresión cron o HH:mm"
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
  const keywords = config?.keywords ?? []
  return (
    <div className="space-y-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Palabras clave (separadas por comas)
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
          Tipo de coincidencia
        </label>
        <select
          value={config?.match_type ?? "contains"}
          onChange={(e) => onChange({ ...config, match_type: e.target.value as "exact" | "contains" })}
          className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:outline-none"
        >
          <option value="contains">Contiene</option>
          <option value="exact">Exacta</option>
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
  // Root flow runs horizontally; condition branches (non-empty parentPath)
  // keep the vertical stack so each lane reads top-to-bottom.
  const horizontal = parentPath.length === 0
  const parentScope: ParentScope =
    parentPath.length === 0
      ? { kind: "root" }
      : (() => {
          const last = parentPath[parentPath.length - 1]
          if (last.kind !== "branch") return { kind: "root" } as const
          return { kind: "branch", parentCid: last.parentCid, branch: last.branch } as const
        })()

  return (
    <div className={cn(horizontal ? "flex items-start" : "flex flex-col items-center")}>
      <AddButton
        orientation={horizontal ? "h" : "v"}
        onPick={(t) => props.addStepAt(parentScope, 0, t)}
      />
      {steps.map((step, idx) => (
        <StepRenderer
          key={step.cid}
          step={step}
          index={idx}
          total={steps.length}
          horizontal={horizontal}
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
  horizontal,
  parentScope,
  parentPath,
  ...props
}: {
  step: BuilderStep
  index: number
  total: number
  horizontal: boolean
  parentScope: ParentScope
  parentPath: StepPath
} & Omit<StepListProps, "steps" | "parentPath">) {
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

  return (
    <>
      <div className={cn("z-10 flex flex-col", width)}>
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
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-foreground">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {isCondition ? "Condición" : step.step_type === "wait" ? "Espera" : "Acción"}
              </div>
              <div className="truncate text-sm font-medium text-foreground">{meta.label}</div>
              <div className="truncate text-[11px] text-muted-foreground">{previewFor(step)}</div>
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
                    aria-label="Subir"
                    onClick={() => props.moveStepAt(path, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={index === total - 1}
                    aria-label="Bajar"
                    onClick={() => props.moveStepAt(path, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => props.deleteStepAt(path)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Eliminar
                </Button>
              </div>
            </div>
          )}
        </div>

        {isCondition && (
          <ConditionBranches step={step} parentPath={path} {...props} />
        )}
      </div>

      <AddButton
        orientation={horizontal ? "h" : "v"}
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
    // Stack Yes/No vertically on mobile — two columns at 375px would
    // cram each branch to ~170px which is too narrow for the nested
    // cards. Two-column grid returns on sm+.
    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <BranchColumn label="Sí" color="text-accent-ink">
        <StepList {...props} steps={yes} parentPath={yesPath} />
      </BranchColumn>
      <BranchColumn label="No" color="text-rose-400">
        <StepList {...props} steps={no} parentPath={noPath} />
      </BranchColumn>
    </div>
  )
}

function BranchColumn({
  label,
  color,
  children,
}: {
  label: string
  color: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center">
      <div className={cn("mb-2 text-[11px] font-semibold uppercase", color)}>{label}</div>
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
  const seg = orientation === "h" ? "h-[2px] w-4" : "h-4 w-[2px]"
  return (
    <div
      className={cn(
        "relative flex items-center",
        // Top-align in horizontal mode so the line meets the card header
        // (cards grow downward when expanded / when conditions sprout
        // branches), ~28px ≈ half the collapsed header height.
        orientation === "h" ? "flex-row self-start mt-7" : "flex-col",
      )}
    >
      <div className={cn(seg, "bg-border")} aria-hidden />
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-border bg-background text-muted-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-accent-ink data-[popup-open]:border-primary data-[popup-open]:bg-primary/20 data-[popup-open]:text-accent-ink"
          aria-label="Añadir paso"
        >
          <Plus className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-80 min-w-56 overflow-y-auto border-border bg-card"
        >
          {ADDABLE_STEPS.map((t) => {
            const Icon = STEP_META[t].icon
            return (
              <DropdownMenuItem key={t} onClick={() => onPick(t)}>
                <Icon className="h-4 w-4" />
                {STEP_META[t].label}
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
  const cfg = step.step_config
  const templates = useContext(TemplatesContext)
  const set = (patch: Record<string, unknown>) =>
    onChange({ ...step, step_config: { ...cfg, ...patch } })

  switch (step.step_type) {
    case "send_message":
      return (
        <FieldBlock label="Texto del mensaje">
          <Textarea
            value={(cfg.text as string) ?? ""}
            onChange={(e) => set({ text: e.target.value })}
            placeholder="¡Hola! Gracias por escribirnos…"
            className="min-h-24 bg-muted text-foreground"
          />
        </FieldBlock>
      )
    case "send_template":
      return (
        <>
          <FieldBlock label="Plantilla">
            {templates.length > 0 ? (
              <select
                value={(cfg.template_name as string) ?? ""}
                onChange={(e) => {
                  const tpl = templates.find((t) => t.name === e.target.value)
                  set({
                    template_name: e.target.value,
                    language: tpl?.language ?? (cfg.language as string) ?? "es",
                  })
                }}
                className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
              >
                <option value=""></option>
                {templates.map((t) => (
                  <option key={t.id} value={t.name}>
                    {t.name} ({t.language}) · {t.status ?? "Draft"}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                value={(cfg.template_name as string) ?? ""}
                onChange={(e) => set({ template_name: e.target.value })}
                placeholder="nombre_de_plantilla"
                className="bg-muted text-foreground"
              />
            )}
          </FieldBlock>
          <FieldBlock label="Idioma">
            <Input
              value={(cfg.language as string) ?? ""}
              onChange={(e) => set({ language: e.target.value })}
              placeholder="es"
              className="bg-muted text-foreground"
            />
          </FieldBlock>
        </>
      )
    case "add_tag":
    case "remove_tag":
      return (
        <FieldBlock label="ID de la etiqueta">
          <Input
            value={(cfg.tag_id as string) ?? ""}
            onChange={(e) => set({ tag_id: e.target.value })}
            className="bg-muted text-foreground"
          />
        </FieldBlock>
      )
    case "assign_conversation":
      return (
        <>
          <FieldBlock label="Modo">
            <select
              value={(cfg.mode as string) ?? "round_robin"}
              onChange={(e) => set({ mode: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="round_robin">Reparto rotativo</option>
              <option value="specific">Agente específico</option>
            </select>
          </FieldBlock>
          {cfg.mode === "specific" && (
            <FieldBlock label="ID del agente">
              <Input
                value={(cfg.agent_id as string) ?? ""}
                onChange={(e) => set({ agent_id: e.target.value })}
                className="bg-muted text-foreground"
              />
            </FieldBlock>
          )}
        </>
      )
    case "update_contact_field":
      return (
        <>
          <FieldBlock label="Campo">
            <select
              value={(cfg.field as string) ?? "name"}
              onChange={(e) => set({ field: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="name">Nombre</option>
              <option value="email">Correo</option>
              <option value="company">Empresa</option>
            </select>
          </FieldBlock>
          <FieldBlock label="Valor">
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
          <FieldBlock label="Cantidad">
            <Input
              type="number"
              min={1}
              value={(cfg.amount as number) ?? 1}
              onChange={(e) => set({ amount: Math.max(1, Number(e.target.value)) })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label="Unidad">
            <select
              value={(cfg.unit as string) ?? "hours"}
              onChange={(e) => set({ unit: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="minutes">Minutos</option>
              <option value="hours">Horas</option>
              <option value="days">Días</option>
            </select>
          </FieldBlock>
        </div>
      )
    case "condition":
      return <ConditionFields cfg={cfg} set={set} />

    case "send_webhook":
      return (
        <>
          <FieldBlock label="URL">
            <Input
              value={(cfg.url as string) ?? ""}
              onChange={(e) => set({ url: e.target.value })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label="Plantilla del cuerpo (JSON)">
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

function previewFor(step: BuilderStep): string {
  switch (step.step_type) {
    case "send_message":
      return (step.step_config.text as string) || "sin texto aún"
    case "send_template":
      return (step.step_config.template_name as string) || "elige una plantilla"
    case "wait":
      return `${step.step_config.amount ?? "?"} ${step.step_config.unit ?? ""}`
    case "condition":
      return `cuando ${step.step_config.subject ?? "?"}`
    case "send_webhook":
      return (step.step_config.url as string) || "sin URL"
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

  // Pan whenever the user left-drags on empty canvas (no Space needed).
  // Middle mouse anywhere still pans. Clicks that land on form controls
  // or buttons pass through untouched so inputs/menus keep working.
  function onMouseDown(e: React.MouseEvent) {
    const target = e.target as HTMLElement
    if (e.button !== 0 && e.button !== 1) return
    if (e.button === 0 && target.closest(INTERACTIVE_SELECTOR)) return
    e.preventDefault()
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startTx: tx,
      startTy: ty,
    }
    setDragging(true)
  }

  useEffect(() => {
    function move(e: MouseEvent) {
      if (!dragRef.current) return
      setTx(dragRef.current.startTx + (e.clientX - dragRef.current.startX))
      setTy(dragRef.current.startTy + (e.clientY - dragRef.current.startY))
    }
    function up() {
      if (dragRef.current) {
        dragRef.current = null
        setDragging(false)
      }
    }
    window.addEventListener("mousemove", move)
    window.addEventListener("mouseup", up)
    return () => {
      window.removeEventListener("mousemove", move)
      window.removeEventListener("mouseup", up)
    }
  }, [])

  function zoomByButton(delta: number) {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, scale + delta)
  }

  return (
    <div
      ref={containerRef}
      onMouseDown={onMouseDown}
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
          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Reducir (Ctrl + rueda)"
          aria-label="Reducir"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={fitToView}
          className="min-w-[3.5rem] rounded px-1 py-1 text-center text-xs tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Centrar y ajustar"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          onClick={() => zoomByButton(0.1)}
          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Ampliar (Ctrl + rueda)"
          aria-label="Ampliar"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <div className="mx-1 h-4 w-px bg-border" />
        <button
          type="button"
          onClick={fitToView}
          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Centrar todo el flujo"
          aria-label="Centrar"
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
