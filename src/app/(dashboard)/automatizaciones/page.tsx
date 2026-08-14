"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import Link from "@/components/i18n/locale-link"
import { useLocalizedRouter } from "@/hooks/use-localized-router"
import { toast } from "sonner"
import {
  Zap,
  Plus,
  MoreVertical,
  Copy,
  Pencil,
  Trash2,
  BarChart3,
  AlertTriangle,
  PackageCheck,
  Repeat2,
  ShoppingCart,
  CreditCard,
  Sparkles,
  Star,
  Truck,
  ArrowRight,
  Loader2,
} from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { toShortId } from "@/lib/short-id"
import { useWorkspace } from "@/hooks/use-workspace"
import { useActiveConnections } from "@/hooks/use-active-connections"
import type { Automation } from "@/types"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  listTemplates,
  automationTemplateNameKey,
  automationTemplateDescKey,
  type AutomationTemplateDefinition,
  type TemplateIconName,
} from "@/lib/automations/templates"
import { formatRelative } from "@/lib/automations/trigger-meta"
import { cn } from "@/lib/utils"
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf"
import { useT } from "@/hooks/use-locale"

// String → Lucide icon component. Keeping the catalog import-free of
// react means this map lives in the page that renders the gallery.
const ICON_BY_NAME: Record<TemplateIconName, typeof Zap> = {
  "shopping-cart": ShoppingCart,
  "credit-card": CreditCard,
  "package-check": PackageCheck,
  truck: Truck,
  star: Star,
  "repeat-2": Repeat2,
}

export default function AutomationsPage() {
  const router = useLocalizedRouter()
  const t = useT()
  const fetchWithCsrf = useFetchWithCsrf()
  const { workspace, loading: wsLoading } = useWorkspace()
  const connections = useActiveConnections()
  const [automations, setAutomations] = useState<Automation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Automation | null>(null)
  const [deleting, setDeleting] = useState(false)

  const allTemplates = useMemo(() => listTemplates(), [])
  // Contexto de pasarelas: decide qué recetas tienen sentido para este
  // comercio. Ver /api/automations/template-context.
  const [gatewayCtx, setGatewayCtx] = useState<{ mercadopago: boolean } | null>(null)
  useEffect(() => {
    let alive = true
    fetch("/api/automations/template-context", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j) {
          setGatewayCtx({ mercadopago: !!j.payments?.mercadopago })
        }
      })
      .catch(() => {
        /* sin contexto se cae al caso conservador de abajo */
      })
    return () => {
      alive = false
    }
  }, [])
  const templates = useMemo(() => {
    // Mientras carga se ocultan las recetas con pasarela: aparecer y
    // desaparecer es peor que tardar un instante en aparecer.
    return allTemplates.filter((tpl) => {
      if (!tpl.requiresGateway) return true
      // Sólo con la pasarela conectada. El descubrimiento ya no depende de
      // esta tarjeta: Mercado Pago es un conector visible en Integraciones,
      // junto a las tiendas, así que el camino es conectar y ahí aparece la
      // receta — y no al revés. La heurística por región dejó de hacer
      // falta con eso.
      return Boolean(gatewayCtx?.mercadopago)
    })
  }, [allTemplates, gatewayCtx])
  // The automation engine sends exclusively via WhatsApp (meta-send.ts →
  // whatsapp_config). The module layout only requires *some* channel, so a
  // workspace with e.g. only email connected still needs this WA-specific gate.
  const whatsappConnected = connections.channels.has("whatsapp")
  const whatsappLabel = connections.labels.get("whatsapp")

  async function load(workspaceId: string) {
    try {
      const supabase = createClient()
      const { data, error: fetchErr } = await supabase
        .from("automations")
        .select("*")
        .eq("workspace_id", workspaceId)
        // Hide soft-deleted rows (migration 059's deleted_at) so a deleted
        // automation disappears from the list instead of lingering.
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
      if (fetchErr) throw fetchErr
      setAutomations((data ?? []) as Automation[])
    } catch (err) {
      setError(t("automations.loadFailed"))
    }
  }

  useEffect(() => {
    if (!workspace?.id) return
    load(workspace.id)
  }, [workspace?.id])

  async function toggleActive(a: Automation, next: boolean) {
    // Optimistic flip so the switch feels instant.
    setAutomations((prev) =>
      prev?.map((x) => (x.id === a.id ? { ...x, is_active: next } : x)) ?? prev,
    )
    const res = await fetchWithCsrf(`/api/automations/${a.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ is_active: next }),
    })
    if (!res.ok) {
      setAutomations((prev) =>
        prev?.map((x) => (x.id === a.id ? { ...x, is_active: !next } : x)) ?? prev,
      )
      const body = await res.json().catch(() => ({}))
      toast.error(body?.error ?? t("automations.updateFailed"))
      return
    }
    toast.success(next ? t("automations.toastActivated") : t("automations.toastPaused"))
  }

  async function duplicate(a: Automation) {
    const res = await fetchWithCsrf(`/api/automations/${a.id}/duplicate`, { method: "POST" })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body?.error ?? t("automations.duplicateFailed"))
      return
    }
    toast.success(t("automations.toastDuplicated"))
    if (workspace?.id) load(workspace.id)
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    const res = await fetchWithCsrf(`/api/automations/${pendingDelete.id}`, { method: "DELETE" })
    setDeleting(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body?.error ?? t("automations.deleteFailed"))
      return
    }
    toast.success(t("automations.toastDeleted"))
    setPendingDelete(null)
    if (workspace?.id) load(workspace.id)
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          {t("automations.retry")}
        </Button>
      </div>
    )
  }

  if (automations === null || wsLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent-ink" />
      </div>
    )
  }

  return (
    <div className="space-y-10">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t("automations.pageTitle")}
          </h1>
        </div>
        <Button
          variant="outline"
          onClick={() => router.push("/automatizaciones/nueva")}
          className="shrink-0"
        >
          <Plus className="h-4 w-4" />
          {t("automations.createFromScratch")}
        </Button>
      </header>

      {/* Channel notice. Automations send only through WhatsApp; make that
          explicit and warn when there's no connected WhatsApp to send from. */}
      {!connections.loading &&
        (whatsappConnected ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Image src="/channels/whatsapp.svg" alt="" width={14} height={14} />
            <span>
              {t("automations.runsThroughWhatsapp")}
              {whatsappLabel ? (
                <span className="font-medium text-foreground"> ({whatsappLabel})</span>
              ) : null}
              .
            </span>
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0">
              <p className="font-medium text-foreground">
                {t("automations.noWhatsappTitle")}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("automations.automationsSendViaWhatsapp")}{" "}
                <Link href="/integraciones" className="text-accent-ink underline hover:opacity-80">
                  {t("automations.connectWhatsapp")}
                </Link>
              </p>
            </div>
          </div>
        ))}

      <section aria-labelledby="templates-heading">
        <div className="mb-4 flex items-baseline justify-between">
          <h2
            id="templates-heading"
            className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {t("automations.readyTemplates")}
          </h2>
          <span className="text-xs text-muted-foreground">
            {t("automations.availableCount", { n: templates.length })}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((tpl) => (
            <TemplateCard
              key={tpl.slug}
              template={tpl}
              onView={() => router.push(`/automatizaciones/nueva?template=${tpl.slug}`)}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="installed-heading">
        <div className="mb-4 flex items-baseline justify-between">
          <h2
            id="installed-heading"
            className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {t("automations.myAutomations")}
          </h2>
          {automations.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {automations.length === 1
                ? t("automations.installedCountOne", { n: 1 })
                : t("automations.installedCountOther", { n: automations.length })}
            </span>
          )}
        </div>

        {automations.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 px-6 py-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-accent-ink">
              <Zap className="size-6" />
            </div>
            <p className="mt-3 text-sm font-semibold text-foreground">
              {t("automations.emptyInstalled")}
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {automations.map((a) => (
              <AutomationCard
                key={a.id}
                automation={a}
                onToggle={(next) => toggleActive(a, next)}
                // Card click opens the canvas editor (where you build/add
                // steps). "View stats" goes to the stats/detail page.
                onOpen={() => router.push(`/automatizaciones/${toShortId(a.id)}/editar`)}
                onEdit={() => router.push(`/automatizaciones/${toShortId(a.id)}/editar`)}
                onDuplicate={() => duplicate(a)}
                onStats={() => router.push(`/automatizaciones/${toShortId(a.id)}`)}
                onDelete={() => setPendingDelete(a)}
              />
            ))}
          </ul>
        )}
      </section>

      <Dialog open={!!pendingDelete} onOpenChange={(v) => !v && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("automations.deleteDialogTitlePrefix")}{" "}
              <span className="text-foreground">{pendingDelete?.name}</span>?
            </DialogTitle>
            <DialogDescription>
              {t("automations.deleteDialogDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPendingDelete(null)}
              disabled={deleting}
            >
              {t("automations.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {t("automations.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ------------------------------------------------------------
// Template gallery card. Minimal: icon top-left, title + 2-line
// description, tag pills bottom-left, "Ver plantilla" CTA bottom-right.
// The whole card is clickable: it opens the template in the canvas to
// preview it (nothing is saved until the user hits "Usar plantilla" there).
// ------------------------------------------------------------
function TemplateCard({
  template,
  onView,
}: {
  template: AutomationTemplateDefinition
  onView: () => void
}) {
  const t = useT()
  const Icon = ICON_BY_NAME[template.icon] ?? Sparkles
  return (
    <button
      type="button"
      onClick={onView}
      className={cn(
        "group relative flex h-full flex-col rounded-xl border border-border bg-card p-4 text-left transition-all",
        "hover:border-foreground/30 hover:bg-card/90",
      )}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-accent-ink">
        <Icon className="h-[18px] w-[18px]" />
      </div>

      <div className="mt-3 text-sm font-semibold text-foreground">
        {t(automationTemplateNameKey(template.slug))}
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
        {t(automationTemplateDescKey(template.slug))}
      </p>

      {/* Las píldoras existían en el catálogo pero nunca se dibujaban. Son
          el resumen de lo que hace la receta —de dónde salen los datos y
          cuánto espera— y verlo antes de abrirla evita tener que deducirlo
          del párrafo. */}
      {template.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {template.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-end justify-end gap-2 pt-1">
        <span
          className={cn(
            "inline-flex items-center gap-1 text-xs font-medium text-accent-ink",
            "opacity-80 transition-opacity group-hover:opacity-100",
          )}
        >
          {t("automations.viewTemplate")}
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </button>
  )
}

// ------------------------------------------------------------
// Installed automation card. Same visual rhythm as TemplateCard but
// has an active toggle and a "..." menu instead of an install CTA.
// ------------------------------------------------------------
function AutomationCard({
  automation,
  onToggle,
  onOpen,
  onEdit,
  onDuplicate,
  onStats,
  onDelete,
}: {
  automation: Automation
  onToggle: (next: boolean) => void
  /** Card body click → open the canvas editor. */
  onOpen: () => void
  onEdit: () => void
  onDuplicate: () => void
  /** "View stats" → the stats/detail page. */
  onStats: () => void
  onDelete: () => void
}) {
  const t = useT()
  return (
    <li className="group relative flex h-full flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:border-foreground/30">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-accent-ink">
            <Zap className="h-[18px] w-[18px]" />
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">
              {automation.name}
            </span>
            {automation.is_active && (
              <span className="relative flex h-2 w-2" aria-label={t("automations.active")}>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
            )}
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          <Switch
            checked={automation.is_active}
            onCheckedChange={(v) => onToggle(!!v)}
            aria-label={automation.is_active ? t("automations.deactivate") : t("automations.activate")}
          />
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t("automations.openMenu")}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[popup-open]:bg-accent"
            >
              <MoreVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="h-4 w-4" />
                {t("automations.edit")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}>
                <Copy className="h-4 w-4" />
                {t("automations.duplicate")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 className="h-4 w-4" />
                {t("automations.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Footer: compact run summary (data, not redundant text) + a visible
          shortcut to the run history. */}
      <div className="mt-4 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">
          <span className="tabular-nums">
            {automation.execution_count === 1
              ? t("automations.executionCountOne", { n: 1 })
              : t("automations.executionCountOther", { n: automation.execution_count })}
          </span>
          {" · "}
          <span>{t("automations.lastRun", { time: formatRelative(automation.last_executed_at) })}</span>
        </span>
        <button
          type="button"
          onClick={onStats}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accent-ink opacity-80 transition-opacity hover:opacity-100"
        >
          <BarChart3 className="h-3.5 w-3.5" />
          {t("automations.viewStats")}
        </button>
      </div>
    </li>
  )
}
