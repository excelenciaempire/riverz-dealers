"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Zap,
  Plus,
  MoreVertical,
  Copy,
  Pencil,
  Trash2,
  FileText,
  PackageCheck,
  Repeat2,
  ShoppingCart,
  Sparkles,
  Star,
  Truck,
  ArrowRight,
  Loader2,
} from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { useWorkspace } from "@/hooks/use-workspace"
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
  type AutomationTemplateDefinition,
  type TemplateIconName,
} from "@/lib/automations/templates"
import { triggerMeta, formatRelative } from "@/lib/automations/trigger-meta"
import { cn } from "@/lib/utils"
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf"

// String → Lucide icon component. Keeping the catalog import-free of
// react means this map lives in the page that renders the gallery.
const ICON_BY_NAME: Record<TemplateIconName, typeof Zap> = {
  "shopping-cart": ShoppingCart,
  "package-check": PackageCheck,
  truck: Truck,
  star: Star,
  "repeat-2": Repeat2,
}

export default function AutomationsPage() {
  const router = useRouter()
  const fetchWithCsrf = useFetchWithCsrf()
  const { workspace, loading: wsLoading } = useWorkspace()
  const [automations, setAutomations] = useState<Automation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Automation | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)

  const templates = useMemo(() => listTemplates(), [])

  async function load(workspaceId: string) {
    try {
      const supabase = createClient()
      const { data, error: fetchErr } = await supabase
        .from("automations")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
      if (fetchErr) throw fetchErr
      setAutomations((data ?? []) as Automation[])
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar las automatizaciones")
    }
  }

  useEffect(() => {
    if (!workspace?.id) return
    load(workspace.id)
  }, [workspace?.id])

  async function installTemplate(slug: string) {
    if (installing) return
    if (!workspace?.id) {
      toast.error("Workspace no disponible")
      return
    }
    setInstalling(slug)
    const res = await fetchWithCsrf("/api/automations/install-from-template", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ template_id: slug, workspace_id: workspace.id }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body?.error ?? "No se pudo instalar la plantilla")
      setInstalling(null)
      return
    }
    const body = (await res.json()) as { automation?: { id?: string } }
    const id = body.automation?.id
    if (!id) {
      toast.error("Plantilla instalada pero no se obtuvo el id")
      setInstalling(null)
      return
    }
    toast.success("Plantilla lista. Completá los campos y activala.")
    router.push(`/automatizaciones/${id}/editar`)
  }

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
      toast.error(body?.error ?? "No se pudo actualizar")
      return
    }
    toast.success(next ? "Activada" : "Pausada")
  }

  async function duplicate(a: Automation) {
    const res = await fetchWithCsrf(`/api/automations/${a.id}/duplicate`, { method: "POST" })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body?.error ?? "No se pudo duplicar")
      return
    }
    toast.success("Duplicada")
    if (workspace?.id) load(workspace.id)
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    const res = await fetchWithCsrf(`/api/automations/${pendingDelete.id}`, { method: "DELETE" })
    setDeleting(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body?.error ?? "No se pudo eliminar")
      return
    }
    toast.success("Eliminada")
    setPendingDelete(null)
    if (workspace?.id) load(workspace.id)
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reintentar
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
            Automatizaciones
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Empezá desde una plantilla lista o construí la tuya desde cero.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => router.push("/automatizaciones/nueva")}
          className="shrink-0"
        >
          <Plus className="h-4 w-4" />
          Crear desde cero
        </Button>
      </header>

      <section aria-labelledby="templates-heading">
        <div className="mb-4 flex items-baseline justify-between">
          <h2
            id="templates-heading"
            className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Plantillas listas
          </h2>
          <span className="text-xs text-muted-foreground">
            {templates.length} disponibles
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((t) => (
            <TemplateCard
              key={t.slug}
              template={t}
              installing={installing === t.slug}
              disabled={installing !== null && installing !== t.slug}
              onInstall={() => installTemplate(t.slug)}
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
            Mis automatizaciones
          </h2>
          {automations.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {automations.length} instalada{automations.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {automations.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 px-6 py-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-accent-ink">
              <Zap className="size-6" />
            </div>
            <p className="mt-3 text-sm font-semibold text-foreground">
              Todavía no instalaste ninguna
            </p>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">
              Tocá una plantilla de arriba y la dejamos lista en 2 clicks.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {automations.map((a) => (
              <AutomationCard
                key={a.id}
                automation={a}
                onToggle={(next) => toggleActive(a, next)}
                onView={() => router.push(`/automatizaciones/${a.id}`)}
                onEdit={() => router.push(`/automatizaciones/${a.id}/editar`)}
                onDuplicate={() => duplicate(a)}
                onLogs={() => router.push(`/automatizaciones/${a.id}/registros`)}
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
              ¿Eliminar <span className="text-foreground">{pendingDelete?.name}</span>?
            </DialogTitle>
            <DialogDescription>
              Se eliminará también su historial de ejecuciones.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPendingDelete(null)}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ------------------------------------------------------------
// Template gallery card. Minimal: icon top-left, title + 2-line
// description, tag pills bottom-left, "Usar plantilla" CTA bottom-right.
// The whole card is clickable for one-tap install.
// ------------------------------------------------------------
function TemplateCard({
  template,
  installing,
  disabled,
  onInstall,
}: {
  template: AutomationTemplateDefinition
  installing: boolean
  disabled: boolean
  onInstall: () => void
}) {
  const Icon = ICON_BY_NAME[template.icon] ?? Sparkles
  return (
    <button
      type="button"
      onClick={onInstall}
      disabled={disabled || installing}
      className={cn(
        "group relative flex h-full flex-col rounded-xl border border-border bg-card p-4 text-left transition-all",
        "hover:border-foreground/30 hover:bg-card/90",
        "disabled:cursor-not-allowed disabled:opacity-60",
      )}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-accent-ink">
        <Icon className="h-[18px] w-[18px]" />
      </div>

      <div className="mt-3 text-sm font-semibold text-foreground">
        {template.name}
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
        {template.description}
      </p>

      <div className="mt-4 flex items-end justify-between gap-2 pt-1">
        <div className="flex flex-wrap gap-1.5">
          {template.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-full border border-border bg-background/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 text-xs font-medium text-accent-ink",
            "opacity-80 transition-opacity group-hover:opacity-100",
          )}
        >
          {installing ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Instalando
            </>
          ) : (
            <>
              Usar plantilla
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </>
          )}
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
  onView,
  onEdit,
  onDuplicate,
  onLogs,
  onDelete,
}: {
  automation: Automation
  onToggle: (next: boolean) => void
  onView: () => void
  onEdit: () => void
  onDuplicate: () => void
  onLogs: () => void
  onDelete: () => void
}) {
  const meta = triggerMeta(automation.trigger_type)
  return (
    <li className="group relative flex h-full flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:border-foreground/30">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={onView}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-accent-ink">
            <Zap className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-foreground">
                {automation.name}
              </span>
              {automation.is_active && (
                <span className="relative flex h-2 w-2" aria-label="activa">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </span>
              )}
            </div>
            {automation.description && (
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                {automation.description}
              </p>
            )}
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          <Switch
            checked={automation.is_active}
            onCheckedChange={(v) => onToggle(!!v)}
            aria-label={automation.is_active ? "Desactivar" : "Activar"}
          />
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Abrir menú"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[popup-open]:bg-accent"
            >
              <MoreVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="h-4 w-4" />
                Editar
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}>
                <Copy className="h-4 w-4" />
                Duplicar
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onLogs}>
                <FileText className="h-4 w-4" />
                Ver registros
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 className="h-4 w-4" />
                Eliminar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 font-medium",
            meta.pillClass,
          )}
        >
          {meta.label}
        </span>
        <span className="tabular-nums">
          {automation.execution_count} ejecución
          {automation.execution_count === 1 ? "" : "es"}
        </span>
        <span aria-hidden>·</span>
        <span>última {formatRelative(automation.last_executed_at)}</span>
      </div>
    </li>
  )
}
