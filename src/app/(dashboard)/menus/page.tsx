"use client";

import { useEffect, useState } from "react";
import { useLocalizedRouter } from "@/hooks/use-localized-router";
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
  ArrowRight,
  Check,
  MousePointerClick,
  List,
  Link2,
  PenLine,
  Search,
  Flag,
  UserPlus,
  HelpCircle,
  Package,
  ShoppingBag,
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
import { toShortId } from "@/lib/short-id";
import { useT, useLocale } from "@/hooks/use-locale";
import type { TFn } from "@/lib/i18n/translate";
import {
  listFlowTemplates,
  flowTemplateNameKey,
  flowTemplateDescKey,
  type FlowTemplate,
} from "@/lib/flows/templates";

/**
 * Flows list page.
 *
 * "Nuevo flujo" opens a two-step picker: first the user chooses between
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

type CreateStep = "choose" | "name" | "template" | "preview";

export default function FlowsPage() {
  const router = useLocalizedRouter();
  const t = useT();
  const { locale } = useLocale();
  const fetchWithCsrf = useFetchWithCsrf();
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [step, setStep] = useState<CreateStep>("choose");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<FlowTemplate | null>(null);

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
          toast.error(t("flows.loadFailed"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openCreate() {
    setStep("choose");
    setNewName("");
    setSelectedTemplate(null);
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
      toast.error(t("flows.createFailed"));
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
      toast.error(t("flows.useTemplateFailed"));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(flow: FlowRow) {
    const yes = window.confirm(t("flows.confirmDelete", { name: flow.name }));
    if (!yes) return;
    try {
      const res = await fetchWithCsrf(`/api/flows/${flow.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      setFlows((prev) => prev.filter((f) => f.id !== flow.id));
      toast.success(t("flows.deleted"));
    } catch (err) {
      console.error(err);
      toast.error(t("flows.deleteRowFailed"));
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const templates = listFlowTemplates(locale);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <SupportModeSwitcher current="flows" />

      {/* El botón solo cuando ya hay flujos: en vacío manda el CTA del empty
          state, sin duplicar la acción. */}
      {flows.length > 0 && (
        <div className="flex justify-end">
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {t("flows.newFlow")}
          </Button>
        </div>
      )}

      {flows.length === 0 ? (
        <EmptyState onCreate={openCreate} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {flows.map((flow) => (
            <FlowCard
              key={flow.id}
              flow={flow}
              onEdit={() => router.push(`/menus/${toShortId(flow.id)}`)}
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
                  toast.success(next ? t("flows.flowActivated") : t("flows.flowPaused"));
                } catch {
                  // Rollback en error.
                  setFlows((prev) =>
                    prev.map((f) =>
                      f.id === flow.id
                        ? { ...f, status: next ? "draft" : "active" }
                        : f,
                    ),
                  );
                  toast.error(t("flows.statusChangeFailed"));
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
            step === "choose"
              ? "sm:max-w-md"
              : step === "preview"
                ? "sm:max-w-4xl"
                : "sm:max-w-lg",
          )}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {step !== "choose" && (
                <button
                  onClick={() => setStep(step === "preview" ? "template" : "choose")}
                  disabled={creating}
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                  aria-label={t("flows.back")}
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              {step === "choose" && t("flows.createTitleChoose")}
              {step === "name" && t("flows.createTitleName")}
              {step === "template" && t("flows.createTitleTemplate")}
              {step === "preview" && (selectedTemplate?.name ?? t("flows.createTitlePreview"))}
            </DialogTitle>
          </DialogHeader>

          {step === "choose" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ChoiceCard
                icon={<Sparkles className="h-5 w-5 text-accent-ink" />}
                title={t("flows.choiceTemplateTitle")}
                description={t("flows.choiceTemplateDesc")}
                badge={t("flows.recommended")}
                onClick={() => setStep("template")}
              />
              <ChoiceCard
                icon={<FilePlus2 className="h-5 w-5 text-muted-foreground" />}
                title={t("flows.choiceBlankTitle")}
                description={t("flows.choiceBlankDesc")}
                onClick={() => setStep("name")}
              />
            </div>
          )}

          {step === "name" && (
            <>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("flows.namePlaceholder")}
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
                  {t("flows.back")}
                </Button>
                <Button
                  onClick={handleCreateBlank}
                  disabled={!newName.trim() || creating}
                >
                  {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("flows.createBlankFlow")}
                </Button>
              </DialogFooter>
            </>
          )}

          {step === "template" && (
            <div className="space-y-2">
              {templates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("flows.noTemplates")}
                </p>
              ) : (
                templates.map((tpl) => (
                  <TemplateCard
                    key={tpl.slug}
                    template={tpl}
                    onSelect={() => {
                      // "Ver" abre el LIENZO real con la plantilla cargada
                      // (preview sin guardar); ahí el botón "Usar plantilla"
                      // la crea. Reemplaza el viejo preview en modal.
                      closeCreate();
                      router.push(`/menus/nueva?template=${encodeURIComponent(tpl.slug)}`);
                    }}
                  />
                ))
              )}
            </div>
          )}

          {step === "preview" && selectedTemplate && (
            <TemplatePreview
              template={selectedTemplate}
              creating={creating}
              onUse={() => handleUseTemplate(selectedTemplate)}
            />
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

// Per-template icon (from FlowTemplate.icon) and per-node-type icon/label
// for the preview outline. Kept module-level so they're built once.
const TEMPLATE_ICONS: Record<FlowTemplate["icon"], typeof MessageSquare> = {
  MessageSquare,
  HelpCircle,
  UserPlus,
  Package,
  ShoppingBag,
};

const NODE_ICONS: Record<string, typeof MessageSquare> = {
  send_message: MessageSquare,
  send_buttons: MousePointerClick,
  send_list: List,
  send_cta_url: Link2,
  collect_input: PenLine,
  shopify_lookup: Search,
  ai_intent: Sparkles,
  handoff: UserPlus,
  end: Flag,
};

const NODE_LABELS: Record<string, string> = {
  send_message: "flows.nodeMessage",
  send_buttons: "flows.nodeButtons",
  send_list: "flows.nodeList",
  send_cta_url: "flows.nodeCtaUrl",
  collect_input: "flows.nodeQuestion",
  shopify_lookup: "flows.nodeShopify",
  ai_intent: "flows.nodeAi",
  handoff: "flows.nodeHandoffToHuman",
  end: "flows.nodeEnd",
};

/** One readable line per node for the preview outline. */
function summarizeNode(node: { node_type: string; config: object }, t: TFn): string {
  const c = node.config as Record<string, unknown>;
  switch (node.node_type) {
    case "send_message":
      return String(c.text ?? "");
    case "send_buttons": {
      const buttons = (c.buttons as Array<{ title?: string }>) ?? [];
      const opts = buttons.map((b) => b.title).filter(Boolean).join(" · ");
      return [String(c.text ?? ""), opts && `›  ${opts}`].filter(Boolean).join("  ");
    }
    case "send_list": {
      const sections = (c.sections as Array<{ rows?: Array<{ title?: string }> }>) ?? [];
      const rows = sections.flatMap((s) => s.rows ?? []).map((r) => r.title).filter(Boolean).join(" · ");
      return [String(c.text ?? ""), rows && `›  ${rows}`].filter(Boolean).join("  ");
    }
    case "send_cta_url":
      return `${String(c.text ?? "")}  ›  [${String(c.button_title ?? t("flows.summaryOpen"))}]`;
    case "collect_input":
      return String(c.prompt_text ?? "");
    case "shopify_lookup":
      return t("flows.summaryShopifyLookup");
    case "ai_intent":
      return `${String(c.prompt_text ?? "")} ${t("flows.summaryAiRoute")}`;
    case "handoff":
      return t("flows.summaryHandoff");
    case "end":
      return t("flows.summaryEnd");
    default:
      return "";
  }
}

function TemplateCard({
  template,
  onSelect,
}: {
  template: FlowTemplate;
  onSelect: () => void;
}) {
  const t = useT();
  const Icon = TEMPLATE_ICONS[template.icon] ?? MessageSquare;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3 text-left transition-colors hover:border-foreground/40 hover:bg-muted/60"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-accent-ink" />
          <h4 className="truncate text-sm font-medium text-foreground">
            {t(flowTemplateNameKey(template.slug))}
          </h4>
          <Badge variant="outline" className="border-border text-[10px]">
            {t("flows.stepsCount", { n: template.nodes.length })}
          </Badge>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t(flowTemplateDescKey(template.slug))}
        </p>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accent-ink opacity-80 transition-opacity group-hover:opacity-100">
        {t("flows.view")}
        <ArrowRight className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}

function TemplatePreview({
  template,
  creating,
  onUse,
}: {
  template: FlowTemplate;
  creating: boolean;
  onUse: () => void;
}) {
  const t = useT();
  const Icon = TEMPLATE_ICONS[template.icon] ?? MessageSquare;
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-accent-ink">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{t(flowTemplateNameKey(template.slug))}</h3>
            <Badge variant="outline" className="border-border text-[10px]">
              {t("flows.stepsCount", { n: template.nodes.length })}
            </Badge>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t(flowTemplateDescKey(template.slug))}
          </p>
        </div>
      </div>

      {/* Canvas-style preview: disparador → pasos de izquierda a derecha,
          igual que el lienzo real, para que se vea el flujo antes de usarlo. */}
      <div
        className="max-h-[52vh] overflow-auto rounded-lg border border-border p-4"
        style={{
          backgroundImage:
            'radial-gradient(rgba(128,128,128,0.18) 1px, transparent 1px)',
          backgroundSize: '16px 16px',
        }}
      >
        <div className="flex min-w-max items-center gap-2">
          {/* Disparador */}
          <div className="flex w-44 shrink-0 flex-col rounded-lg border border-primary/50 bg-primary/10 p-2.5">
            <span className="text-[10px] uppercase tracking-wide text-accent-ink">
              {t("flows.trigger")}
            </span>
            <p className="mt-0.5 text-xs font-medium text-foreground">
              {t("flows.flowStart")}
            </p>
          </div>
          {template.nodes.map((node) => {
            const NodeIcon = NODE_ICONS[node.node_type] ?? MessageSquare;
            return (
              <div key={node.node_key} className="flex shrink-0 items-center gap-2">
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex w-44 shrink-0 flex-col rounded-lg border border-border bg-card p-2.5 shadow-sm">
                  <div className="flex items-center gap-1.5">
                    <NodeIcon className="h-3.5 w-3.5 shrink-0 text-accent-ink" />
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {NODE_LABELS[node.node_type] ? t(NODE_LABELS[node.node_type]) : node.node_type}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-4 text-xs text-foreground">
                    {summarizeNode(node, t)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <DialogFooter>
        <Button onClick={onUse} disabled={creating} className="w-full sm:w-auto">
          {creating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          {t("flows.useTemplate")}
        </Button>
      </DialogFooter>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/50 px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <Workflow className="h-6 w-6 text-muted-foreground" />
      </div>
      <h2 className="mt-4 text-base font-medium text-foreground">
        {t("flows.emptyTitle")}
      </h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {t("flows.emptyDescription")}
      </p>
      <Button onClick={onCreate} className="mt-5">
        <Plus className="h-4 w-4" />
        {t("flows.createFirstFlow")}
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
  const t = useT();
  const triggerSummary = describeTrigger(flow, t);
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
              flow.status === "active" ? t("flows.pauseFlow") : t("flows.activateFlow")
            }
          />
        ) : (
          <Badge variant="outline" className="shrink-0 gap-1 text-[10px]">
            {t("flows.archived")}
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
          {flow.execution_count === 1 ? t("flows.timesUsedOne") : t("flows.timesUsedMany")}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
          {t("flows.edit")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-red-600 dark:text-red-400 hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-300"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t("flows.delete")}
        </Button>
      </div>
    </div>
  );
}

function describeTrigger(flow: FlowRow, t: TFn): string {
  if (flow.trigger_type === "keyword") {
    const keywords = Array.isArray(flow.trigger_config.keywords)
      ? (flow.trigger_config.keywords as string[])
      : [];
    if (keywords.length === 0)
      return t("flows.triggerKeywordNone");
    return t("flows.triggerKeywordWith", { keywords: keywords.join(", ") });
  }
  if (flow.trigger_type === "first_inbound_message") {
    return t("flows.triggerFirstMessage");
  }
  return t("flows.triggerManual");
}
