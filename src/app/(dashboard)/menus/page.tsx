"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Workflow,
  Plus,
  Trash2,
  Pencil,
  Loader2,
  MessageSquare,
  FilePlus2,
  Sparkles,
  ArrowLeft,
  Check,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { SupportModeSwitcher } from "@/components/support/mode-switcher";
import { cn } from "@/lib/utils";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import { listFlowTemplates, type FlowTemplate } from "@/lib/flows/templates";

/**
 * Flows list page.
 *
 * "Nuevo menú" opens a two-step picker: first the user chooses between
 * cloning a template or starting blank, then either confirms the
 * template or types a name. The template path skips the name input —
 * the user can rename inside the editor.
 */

interface FlowRow {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "archived";
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: { keywords?: string[] } | Record<string, unknown>;
  execution_count: number;
  last_executed_at: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_LABELS: Record<FlowRow["status"], string> = {
  draft: "Borrador",
  active: "Activo",
  archived: "Archivado",
};

const STATUS_COLORS: Record<FlowRow["status"], string> = {
  draft: "border-border bg-muted text-foreground",
  active: "border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  archived: "border-border bg-muted/50 text-muted-foreground",
};

type CreateStep = "choose" | "name" | "template";

export default function FlowsPage() {
  const router = useRouter();
  const fetchWithCsrf = useFetchWithCsrf();
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [step, setStep] = useState<CreateStep>("choose");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const flowsRes = await fetch("/api/flows", { cache: "no-store" });
        if (!flowsRes.ok) {
          throw new Error(`Failed to load flows: ${flowsRes.status}`);
        }
        const flowsJson = (await flowsRes.json()) as { flows: FlowRow[] };
        if (!cancelled) setFlows(flowsJson.flows ?? []);
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          toast.error("No se pudieron cargar los menús.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function openCreate() {
    setStep("choose");
    setNewName("");
    setCreateOpen(true);
  }

  function closeCreate() {
    if (creating) return;
    setCreateOpen(false);
  }

  async function handleCreateBlank() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetchWithCsrf("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) throw new Error(`Create failed: ${res.status}`);
      const json = (await res.json()) as { flow: FlowRow };
      setCreateOpen(false);
      setNewName("");
      router.push(`/menus/${json.flow.id}`);
    } catch (err) {
      console.error(err);
      toast.error("No se pudo crear el menú.");
    } finally {
      setCreating(false);
    }
  }

  async function handleUseTemplate(template: FlowTemplate) {
    setCreating(true);
    try {
      const res = await fetchWithCsrf("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_slug: template.slug }),
      });
      if (!res.ok) throw new Error(`Create failed: ${res.status}`);
      const json = (await res.json()) as { flow: FlowRow };
      setCreateOpen(false);
      router.push(`/menus/${json.flow.id}`);
    } catch (err) {
      console.error(err);
      toast.error("No se pudo usar la plantilla.");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(flow: FlowRow) {
    const yes = window.confirm(`¿Eliminar "${flow.name}"?`);
    if (!yes) return;
    try {
      const res = await fetchWithCsrf(`/api/flows/${flow.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      setFlows((prev) => prev.filter((f) => f.id !== flow.id));
      toast.success("Eliminado.");
    } catch (err) {
      console.error(err);
      toast.error("No se pudo eliminar.");
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const templates = listFlowTemplates();

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <SupportModeSwitcher current="flows" />

      <div className="flex justify-end">
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Nuevo menú
        </Button>
      </div>

      {flows.length === 0 ? (
        <EmptyState onCreate={openCreate} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {flows.map((flow) => (
            <FlowCard
              key={flow.id}
              flow={flow}
              onEdit={() => router.push(`/menus/${flow.id}`)}
              onDelete={() => handleDelete(flow)}
              onToggle={async (next) => {
                // Optimistic flip así el switch se siente instantáneo.
                setFlows((prev) =>
                  prev.map((f) =>
                    f.id === flow.id
                      ? { ...f, status: next ? "active" : "draft" }
                      : f,
                  ),
                );
                try {
                  const res = await fetchWithCsrf(`/api/flows/${flow.id}/activate`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      status: next ? "active" : "draft",
                    }),
                  });
                  if (!res.ok) throw new Error("activate failed");
                  toast.success(next ? "Flujo activado" : "Flujo pausado");
                } catch {
                  // Rollback en error.
                  setFlows((prev) =>
                    prev.map((f) =>
                      f.id === flow.id
                        ? { ...f, status: next ? "draft" : "active" }
                        : f,
                    ),
                  );
                  toast.error("No se pudo cambiar el estado");
                }
              }}
            />
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={(o) => (o ? openCreate() : closeCreate())}>
        <DialogContent
          className={cn(
            "bg-card text-foreground",
            step === "choose" ? "sm:max-w-md" : "sm:max-w-lg",
          )}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {step !== "choose" && (
                <button
                  onClick={() => setStep("choose")}
                  disabled={creating}
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                  aria-label="Volver"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              {step === "choose" && "¿Cómo quieres empezar?"}
              {step === "name" && "Nombre del menú"}
              {step === "template" && "Elige una plantilla"}
            </DialogTitle>
          </DialogHeader>

          {step === "choose" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ChoiceCard
                icon={<Sparkles className="h-5 w-5 text-accent-ink" />}
                title="Usar una plantilla"
                description="Empiezas con un menú de ejemplo y lo editas."
                badge="Recomendado"
                onClick={() => setStep("template")}
              />
              <ChoiceCard
                icon={<FilePlus2 className="h-5 w-5 text-muted-foreground" />}
                title="Empezar en blanco"
                description="Lienzo en blanco. Tú armas cada paso desde cero."
                onClick={() => setStep("name")}
              />
            </div>
          )}

          {step === "name" && (
            <>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ej: Menú de bienvenida"
                className="bg-muted"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateBlank();
                }}
              />
              <DialogFooter>
                <Button
                  variant="ghost"
                  onClick={() => setStep("choose")}
                  disabled={creating}
                >
                  Volver
                </Button>
                <Button
                  onClick={handleCreateBlank}
                  disabled={!newName.trim() || creating}
                >
                  {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                  Crear menú vacío
                </Button>
              </DialogFooter>
            </>
          )}

          {step === "template" && (
            <div className="space-y-2">
              {templates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Todavía no hay plantillas disponibles.
                </p>
              ) : (
                templates.map((tpl) => (
                  <TemplateCard
                    key={tpl.slug}
                    template={tpl}
                    onUse={() => handleUseTemplate(tpl)}
                    disabled={creating}
                  />
                ))
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ChoiceCard({
  icon,
  title,
  description,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col items-start gap-2 rounded-lg border border-border bg-muted/30 p-4 text-left transition-colors hover:border-foreground/40 hover:bg-muted/60"
    >
      <div className="flex w-full items-start justify-between gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-background">
          {icon}
        </div>
        {badge && (
          <Badge className="border-primary/30 bg-primary/10 text-[10px] text-accent-ink">
            {badge}
          </Badge>
        )}
      </div>
      <div>
        <h4 className="text-sm font-medium text-foreground">{title}</h4>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}

function TemplateCard({
  template,
  onUse,
  disabled,
}: {
  template: FlowTemplate;
  onUse: () => void;
  disabled: boolean;
}) {
  const stepCount = template.nodes.length;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 shrink-0 text-accent-ink" />
          <h4 className="truncate text-sm font-medium text-foreground">
            {template.name}
          </h4>
          <Badge variant="outline" className="border-border text-[10px]">
            {stepCount} pasos
          </Badge>
        </div>
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
          {template.description}
        </p>
      </div>
      <Button onClick={onUse} disabled={disabled} size="sm" className="shrink-0">
        {disabled ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Check className="h-3.5 w-3.5" />
        )}
        Usar
      </Button>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/50 px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <Workflow className="h-6 w-6 text-muted-foreground" />
      </div>
      <h2 className="mt-4 text-base font-medium text-foreground">
        Sin menús todavía
      </h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Un menú es la conversación que ve tu cliente cuando escribe.
        Empieza con una plantilla lista o créalo desde cero.
      </p>
      <Button onClick={onCreate} className="mt-5">
        <Plus className="h-4 w-4" />
        Crear mi primer menú
      </Button>
    </div>
  );
}

function FlowCard({
  flow,
  onEdit,
  onDelete,
  onToggle,
}: {
  flow: FlowRow;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (next: boolean) => void | Promise<void>;
}) {
  const triggerSummary = describeTrigger(flow);
  return (
    <div className="flex flex-col rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/30">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Workflow className="h-4 w-4 shrink-0 text-accent-ink" />
          <h3 className="truncate text-sm font-semibold text-foreground">
            {flow.name}
          </h3>
        </div>
        {/* Toggle on/off al lado del título. Reemplaza el badge
            "Borrador / Activo" + el botón "Activar" del editor: ahora
            el merchant prende o apaga desde la lista misma. Disabled
            cuando el flujo está archivado (no aplica). */}
        {flow.status !== "archived" ? (
          <Switch
            checked={flow.status === "active"}
            onCheckedChange={(v) => onToggle(!!v)}
            aria-label={
              flow.status === "active" ? "Pausar flujo" : "Activar flujo"
            }
          />
        ) : (
          <Badge variant="outline" className="shrink-0 gap-1 text-[10px]">
            Archivado
          </Badge>
        )}
      </div>

      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
        {flow.description || triggerSummary}
      </p>

      <div className="mt-4 flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="h-3 w-3" />
          {flow.execution_count}{" "}
          {flow.execution_count === 1 ? "vez usado" : "veces usado"}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
          Editar
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-red-600 dark:text-red-400 hover:bg-red-500/10 hover:text-red-300"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Eliminar
        </Button>
      </div>
    </div>
  );
}

function describeTrigger(flow: FlowRow): string {
  if (flow.trigger_type === "keyword") {
    const keywords = Array.isArray(flow.trigger_config.keywords)
      ? (flow.trigger_config.keywords as string[])
      : [];
    if (keywords.length === 0)
      return "Se activa cuando el cliente escribe una palabra clave (ninguna definida)";
    return `Se activa con: ${keywords.join(", ")}`;
  }
  if (flow.trigger_type === "first_inbound_message") {
    return "Se activa con el primer mensaje del cliente";
  }
  return "Lo activas tú a mano";
}
