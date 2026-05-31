"use client";

/**
 * Linear-list flow editor.
 *
 * The whole flow (header, trigger config, node list, validation panel)
 * is owned by this single component. State lives client-side as a
 * single `BuilderState` object; `Save` PUTs the whole structure to
 * `/api/flows/[id]`; `Activate` hits `/api/flows/[id]/activate`.
 *
 * Why one big file: keeps the diff between fields + the form code
 * obvious, matches the existing `automation-builder.tsx` shape, and
 * sidesteps over-componentization for a UI that will be replaced by a
 * react-flow canvas in v2 anyway. The node-config sub-forms live in
 * the same file as small components rather than separate modules.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CircleCheck,
  CircleAlert,
  History,
  Loader2,
  Plus,
  Save,
  Trash2,
  Workflow,
  ChevronDown,
  ChevronUp,
  MessageCircle,
  ListChecks,
  ListPlus,
  CornerDownRight,
  UserPlus,
  Flag,
  PlayCircle,
  PauseCircle,
  Inbox,
  GitFork,
  Tag,
  Image as ImageIcon,
  Video,
  FileText,
  ExternalLink,
  Hourglass,
  Sparkles,
  ShoppingBag,
  MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  validateFlowForActivation,
  type ValidationIssue,
} from "@/lib/flows/validate";
import { CanvasViewport } from "@/components/canvas/canvas-viewport";
import type { FlowNodeRow, FlowRow } from "@/lib/flows/types";

interface FlowBuilderProps {
  initialFlow: FlowRow;
  initialNodes: FlowNodeRow[];
}

// ============================================================
// Local state shape — mirrors the DB but the configs are typed
// loosely (Record<string, unknown>) since each node_type carries a
// different shape. The sub-form components narrow as needed.
// ============================================================

type NodeType =
  | "start"
  | "send_message"
  | "send_buttons"
  | "send_list"
  | "send_image"
  | "send_video"
  | "send_document"
  | "send_cta_url"
  | "collect_input"
  | "condition"
  | "set_tag"
  | "handoff"
  | "wait"
  | "ai_intent"
  | "shopify_lookup"
  | "end";

interface BuilderNode {
  node_key: string;
  node_type: NodeType;
  config: Record<string, unknown>;
}

interface BuilderState {
  name: string;
  description: string;
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: Record<string, unknown>;
  entry_node_id: string | null;
  status: FlowRow["status"];
  nodes: BuilderNode[];
}

// ============================================================
// Per-node-type metadata used to render icons + labels everywhere
// the user sees a node summary.
// ============================================================

const NODE_META: Record<
  NodeType,
  { label: string; icon: typeof Workflow; color: string; bg: string }
> = {
  start: {
    label: "Inicio",
    icon: PlayCircle,
    color: "text-emerald-400",
    bg: "bg-emerald-500/15",
  },
  send_message: {
    label: "Enviar mensaje",
    icon: MessageCircle,
    color: "text-emerald-500",
    bg: "bg-white",
  },
  send_buttons: {
    label: "Enviar botones",
    icon: ListChecks,
    color: "text-amber-400",
    bg: "bg-amber-500/15",
  },
  send_list: {
    label: "Enviar lista",
    icon: ListPlus,
    color: "text-indigo-400",
    bg: "bg-indigo-500/15",
  },
  collect_input: {
    label: "Pedir un dato al cliente",
    icon: Inbox,
    color: "text-teal-400",
    bg: "bg-teal-500/15",
  },
  condition: {
    label: "Si / Si no",
    icon: GitFork,
    color: "text-fuchsia-400",
    bg: "bg-fuchsia-500/15",
  },
  set_tag: {
    label: "Etiquetar al cliente",
    icon: Tag,
    color: "text-pink-400",
    bg: "bg-pink-500/15",
  },
  handoff: {
    label: "Pasar a un humano",
    icon: UserPlus,
    color: "text-amber-400",
    bg: "bg-amber-500/15",
  },
  send_image: {
    label: "Enviar imagen",
    icon: ImageIcon,
    color: "text-sky-400",
    bg: "bg-sky-500/15",
  },
  send_video: {
    label: "Enviar video",
    icon: Video,
    color: "text-sky-400",
    bg: "bg-sky-500/15",
  },
  send_document: {
    label: "Enviar documento",
    icon: FileText,
    color: "text-sky-400",
    bg: "bg-sky-500/15",
  },
  send_cta_url: {
    label: "Botón con enlace",
    icon: ExternalLink,
    color: "text-indigo-400",
    bg: "bg-indigo-500/15",
  },
  wait: {
    label: "Esperar",
    icon: Hourglass,
    color: "text-slate-300",
    bg: "bg-slate-500/15",
  },
  ai_intent: {
    label: "Entender con IA",
    icon: Sparkles,
    color: "text-fuchsia-400",
    bg: "bg-fuchsia-500/15",
  },
  shopify_lookup: {
    label: "Buscar en Shopify",
    icon: ShoppingBag,
    color: "text-emerald-400",
    bg: "bg-emerald-500/15",
  },
  end: {
    label: "Fin",
    icon: Flag,
    color: "text-muted-foreground",
    bg: "bg-muted",
  },
};

// ============================================================
// Helpers
// ============================================================

function slugify(s: string, fallback: string): string {
  const cleaned = s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

function uniqueNodeKey(base: string, existing: BuilderNode[]): string {
  if (!existing.some((n) => n.node_key === base)) return base;
  let i = 2;
  while (existing.some((n) => n.node_key === `${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}

// Short, single-line content summary used in the collapsed NodeCard
// header — lets users scan a 10-node flow without expanding every card.
// Returns null when there's nothing meaningful to show (start/end, or
// a freshly-added node with no fields filled in).
function truncate(s: string, max = 80): string {
  const clean = s.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1) + "…";
}

function summarizeNode(node: BuilderNode): string | null {
  const cfg = node.config;
  switch (node.node_type) {
    case "start":
    case "end":
      return null;
    case "send_message": {
      const text = typeof cfg.text === "string" ? cfg.text : "";
      return text.length > 0 ? truncate(text) : null;
    }
    case "send_buttons": {
      const text = typeof cfg.text === "string" ? cfg.text : "";
      const buttons = Array.isArray(cfg.buttons)
        ? (cfg.buttons as Array<Record<string, unknown>>)
        : [];
      const titles = buttons
        .map((b) => (typeof b.title === "string" ? b.title : ""))
        .filter(Boolean)
        .join(" / ");
      if (text.length > 0) {
        return titles ? `${truncate(text, 40)} · ${truncate(titles, 35)}` : truncate(text);
      }
      return titles || null;
    }
    case "send_list": {
      const text = typeof cfg.text === "string" ? cfg.text : "";
      const sections = Array.isArray(cfg.sections)
        ? (cfg.sections as Array<Record<string, unknown>>)
        : [];
      const rowCount = sections.reduce<number>((sum, s) => {
        const rows = Array.isArray(s.rows) ? s.rows : [];
        return sum + rows.length;
      }, 0);
      if (text.length > 0) {
        return rowCount > 0
          ? `${truncate(text, 50)} · ${rowCount} opción${rowCount === 1 ? "" : "es"}`
          : truncate(text);
      }
      return rowCount > 0
        ? `${rowCount} opción${rowCount === 1 ? "" : "es"} en ${sections.length} sección${sections.length === 1 ? "" : "es"}`
        : null;
    }
    case "collect_input": {
      const prompt = typeof cfg.prompt_text === "string" ? cfg.prompt_text : "";
      const varKey = typeof cfg.var_key === "string" ? cfg.var_key : "";
      if (prompt.length > 0) {
        return varKey ? `${truncate(prompt, 50)} → vars.${varKey}` : truncate(prompt);
      }
      return varKey ? `→ vars.${varKey}` : null;
    }
    case "condition": {
      const subjectKey =
        typeof cfg.subject_key === "string" ? cfg.subject_key : "";
      if (!subjectKey) return null;
      const subject =
        cfg.subject === "tag"
          ? "tag"
          : cfg.subject === "contact_field"
            ? "field"
            : "var";
      const subjectStr =
        subject === "tag" ? `tiene etiqueta ${truncate(subjectKey, 24)}` : `${subject}.${subjectKey}`;
      const op =
        cfg.operator === "equals"
          ? "=="
          : cfg.operator === "contains"
            ? "contiene"
            : cfg.operator === "present"
              ? "existe"
              : cfg.operator === "absent"
                ? "no existe"
                : "";
      const value = typeof cfg.value === "string" ? cfg.value : "";
      const valStr =
        (cfg.operator === "equals" || cfg.operator === "contains") && value
          ? ` "${truncate(value, 20)}"`
          : "";
      return subject === "tag" ? subjectStr : `${subjectStr} ${op}${valStr}`;
    }
    case "set_tag": {
      const mode = cfg.mode === "remove" ? "Quitar" : "Añadir";
      const tagId = typeof cfg.tag_id === "string" ? cfg.tag_id : "";
      // No tag name available without an async lookup here; show a
      // short prefix of the UUID so users can disambiguate between
      // multiple set_tag nodes at a glance.
      return tagId ? `${mode} etiqueta ${tagId.slice(0, 8)}…` : `${mode} etiqueta (ninguna elegida)`;
    }
    case "handoff": {
      const note = typeof cfg.note === "string" ? cfg.note : "";
      return note.length > 0 ? truncate(note) : null;
    }
    case "send_image":
    case "send_video":
    case "send_document": {
      const url = typeof cfg.url === "string" ? cfg.url : "";
      const caption = typeof cfg.caption === "string" ? cfg.caption : "";
      if (caption) return truncate(caption);
      return url ? truncate(url, 60) : null;
    }
    case "send_cta_url": {
      const title = typeof cfg.button_title === "string" ? cfg.button_title : "";
      const url = typeof cfg.url === "string" ? cfg.url : "";
      return title || url ? `${title} → ${truncate(url, 40)}` : null;
    }
    case "wait": {
      const n = Number(cfg.amount ?? 0);
      const unit = String(cfg.unit ?? "minutes");
      return n > 0 ? `${n} ${unit}` : null;
    }
    case "ai_intent": {
      const list = Array.isArray(cfg.intents) ? cfg.intents : [];
      return list.length > 0
        ? `${list.length} intenc${list.length === 1 ? "ión" : "iones"}`
        : null;
    }
    case "shopify_lookup": {
      const kind = String(cfg.kind ?? "");
      const KIND_LABEL: Record<string, string> = {
        order_by_number: "Pedido por número",
        order_by_email: "Pedido por correo",
        last_order: "Último pedido del contacto",
        product_by_handle: "Producto por handle",
      };
      return KIND_LABEL[kind] ?? null;
    }
  }
}

function defaultConfigFor(type: NodeType): Record<string, unknown> {
  switch (type) {
    case "start":
      return { next_node_key: "" };
    case "send_message":
      return { text: "", next_node_key: "" };
    case "send_buttons":
      return {
        text: "",
        buttons: [{ reply_id: "yes", title: "Sí", next_node_key: "" }],
      };
    case "send_list":
      return {
        text: "",
        button_label: "Ver opciones",
        sections: [
          {
            title: "",
            rows: [
              { reply_id: "row_1", title: "Opción 1", next_node_key: "" },
            ],
          },
        ],
      };
    case "collect_input":
      return {
        prompt_text: "",
        var_key: "answer",
        next_node_key: "",
      };
    case "condition":
      return {
        subject: "var",
        subject_key: "",
        operator: "equals",
        value: "",
        true_next: "",
        false_next: "",
      };
    case "set_tag":
      return { mode: "add", tag_id: "", next_node_key: "" };
    case "handoff":
      return { note: "" };
    case "send_image":
    case "send_video":
      return { url: "", caption: "", next_node_key: "" };
    case "send_document":
      return { url: "", filename: "", caption: "", next_node_key: "" };
    case "send_cta_url":
      return {
        text: "",
        button_title: "Ver más",
        url: "https://",
        next_node_key: "",
      };
    case "wait":
      return { amount: 1, unit: "hours", next_node_key: "" };
    case "ai_intent":
      return {
        prompt_text: "",
        intents: [
          { intent_key: "yes", description: "El cliente acepta", next_node_key: "" },
          { intent_key: "no", description: "El cliente rechaza", next_node_key: "" },
        ],
        fallback_next_key: "",
      };
    case "shopify_lookup":
      return {
        kind: "order_by_number",
        input_var: "order_number",
        output_prefix: "order",
        found_next_key: "",
        not_found_next_key: "",
      };
    case "end":
      return {};
  }
}

// ============================================================
// Root component
// ============================================================

export function FlowBuilder({ initialFlow, initialNodes }: FlowBuilderProps) {
  const router = useRouter();

  const [state, setState] = useState<BuilderState>(() => ({
    name: initialFlow.name,
    description: initialFlow.description ?? "",
    trigger_type: initialFlow.trigger_type,
    trigger_config: initialFlow.trigger_config as Record<string, unknown>,
    entry_node_id: initialFlow.entry_node_id,
    status: initialFlow.status,
    nodes: initialNodes.map((n) => ({
      node_key: n.node_key,
      node_type: n.node_type as NodeType,
      config: n.config as Record<string, unknown>,
    })),
  }));

  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(
    // Collapsed by default — a fresh template can have 10+ nodes and
    // dumping all their config forms on the canvas at once is a wall
    // of fields for a first-time user. Click a card to expand it.
    () => new Set<string>(),
  );
  // Tracks whether the in-memory state has user edits that haven't been
  // PUT yet. We use a wrapper setState (`setStateDirty`) for user edits;
  // status-only changes after the activate API succeeds use raw setState
  // so they don't falsely re-flag the form as dirty.
  const [dirty, setDirty] = useState(false);
  const setStateDirty = useCallback<typeof setState>((updaterOrValue) => {
    setDirty(true);
    setState(updaterOrValue);
  }, []);

  // Used by jumpToNode() to scroll the target into view + flash its border.
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [flashedKey, setFlashedKey] = useState<string | null>(null);

  // Browser-level reload / tab-close / external-link guard. SPA
  // navigation (sidebar links, back button) isn't covered here — Next 16
  // routes through the App Router and beforeunload doesn't fire on
  // client-side route changes. That's a follow-up; this catches the
  // accidental refresh / closed-window class of data loss.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore the return value but require something
      // truthy to actually show the native prompt.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // ---- Validation ----
  const issues = useMemo<ValidationIssue[]>(
    () =>
      validateFlowForActivation(
        {
          name: state.name,
          trigger_type: state.trigger_type,
          trigger_config: state.trigger_config,
          entry_node_id: state.entry_node_id,
        },
        state.nodes,
      ),
    [state],
  );
  const blockers = issues.filter((i) => i.severity === "error");
  const canActivate = blockers.length === 0;

  // ---- Save (PUT) ----
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/flows/${initialFlow.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: state.name,
          description: state.description || null,
          trigger_type: state.trigger_type,
          trigger_config: state.trigger_config,
          entry_node_id: state.entry_node_id,
          nodes: state.nodes,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Save failed: ${res.status}`);
      }
      setDirty(false);
      toast.success("Guardado.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo guardar";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }, [initialFlow.id, state]);

  // ---- Activate / Pause / Archive ----
  const handleStatus = useCallback(
    async (next: BuilderState["status"]) => {
      if (next === "active" && !canActivate) {
        toast.error("Corrige los errores antes de activar.");
        return;
      }
      setActivating(true);
      try {
        // Always save first so the activation validator sees the
        // latest state — the user shouldn't have to remember "save
        // then activate".
        if (next === "active") {
          await handleSave();
        }
        const res = await fetch(`/api/flows/${initialFlow.id}/activate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: next }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? `Status update failed: ${res.status}`);
        }
        setState((s) => ({ ...s, status: next }));
        toast.success(
          next === "active"
            ? "Activado."
            : next === "archived"
              ? "Archivado."
              : "Borrador.",
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "No se pudo actualizar el estado";
        toast.error(msg);
      } finally {
        setActivating(false);
      }
    },
    [canActivate, handleSave, initialFlow.id],
  );

  // ---- Delete ----
  const handleDelete = useCallback(async () => {
    const yes = window.confirm(`¿Eliminar "${state.name}"?`);
    if (!yes) return;
    try {
      const res = await fetch(`/api/flows/${initialFlow.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      router.push("/flows");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo eliminar";
      toast.error(msg);
    }
  }, [initialFlow.id, router, state.name]);

  // ---- Node helpers ----
  const updateNode = useCallback(
    (key: string, patch: Partial<BuilderNode>) => {
      setStateDirty((s) => ({
        ...s,
        nodes: s.nodes.map((n) => (n.node_key === key ? { ...n, ...patch } : n)),
      }));
    },
    [setStateDirty],
  );

  const updateNodeConfig = useCallback(
    (key: string, configPatch: Record<string, unknown>) => {
      setStateDirty((s) => ({
        ...s,
        nodes: s.nodes.map((n) =>
          n.node_key === key ? { ...n, config: { ...n.config, ...configPatch } } : n,
        ),
      }));
    },
    [setStateDirty],
  );

  const addNode = useCallback(
    (type: NodeType) => {
      const meta = NODE_META[type];
      const base = slugify(meta.label, type);
      setStateDirty((s) => {
        const node_key = uniqueNodeKey(base, s.nodes);
        const next: BuilderNode = {
          node_key,
          node_type: type,
          config: defaultConfigFor(type),
        };
        setExpanded((prev) => new Set([...prev, node_key]));
        return {
          ...s,
          nodes: [...s.nodes, next],
          // If this is the first node and it's a start, pick it as
          // the entry automatically. Saves a click.
          entry_node_id:
            s.entry_node_id ??
            (type === "start" ? node_key : s.entry_node_id ?? null),
        };
      });
    },
    [setStateDirty],
  );

  const removeNode = useCallback(
    (key: string) => {
      setStateDirty((s) => ({
        ...s,
        nodes: s.nodes.filter((n) => n.node_key !== key),
        entry_node_id: s.entry_node_id === key ? null : s.entry_node_id,
      }));
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    },
    [setStateDirty],
  );

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Jump-to-node: invoked when a user clicks an issue in the validation
  // panel. Expand the offending card (so the broken field is visible),
  // scroll it into the viewport, then flash its border so the eye lands
  // on it. requestAnimationFrame defers the scroll until after React
  // commits the expanded layout.
  const jumpToNode = useCallback((key: string) => {
    setExpanded((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    setFlashedKey(key);
    requestAnimationFrame(() => {
      const el = nodeRefs.current.get(key);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    window.setTimeout(() => {
      setFlashedKey((cur) => (cur === key ? null : cur));
    }, 1600);
  }, []);

  const setNodeRef = useCallback(
    (key: string) => (el: HTMLDivElement | null) => {
      if (el) nodeRefs.current.set(key, el);
      else nodeRefs.current.delete(key);
    },
    [],
  );

  // Trigger + entry picker collapsed by default. They're configuration
  // most users touch once; surface them behind a small toggle so the
  // canvas owns the screen.
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ---- Render ----
  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      <div className="flex-shrink-0 border-b border-border bg-card/40 px-4 py-3">
        <Header
          state={state}
          setState={setStateDirty}
          dirty={dirty}
          saving={saving}
          activating={activating}
          onSave={handleSave}
          onStatus={handleStatus}
          onDelete={handleDelete}
          canActivate={canActivate}
          onBack={() => router.push("/flows")}
          onViewRuns={() => router.push(`/flows/${initialFlow.id}/runs`)}
        />
      </div>

      {/* Configuración (trigger + entry) — colapsada por defecto para
          que el canvas quede limpio al abrir el flujo. */}
      <div className="flex-shrink-0 border-b border-border bg-card/20 px-4 py-2">
        <button
          type="button"
          onClick={() => setSettingsOpen((v) => !v)}
          className="flex w-full items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
        >
          {settingsOpen ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
          Cuándo dispara
        </button>
        {settingsOpen && (
          <div className="mt-3 space-y-3 pb-2">
            <TriggerPanel
              state={state}
              setState={setStateDirty}
              triggerIssues={issues.filter((i) => i.scope === "trigger")}
            />
            <EntryPicker state={state} setState={setStateDirty} />
          </div>
        )}
      </div>

      {/* Canvas — pan / zoom / drag, mismo wrapper que automatizaciones */}
      <div className="relative flex min-h-0 flex-1">
        <CanvasViewport>
          <div className="flex w-max items-start gap-0 px-8 py-10">
            {state.nodes.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card/60 px-8 py-10 text-center">
                <p className="text-sm text-muted-foreground">
                  Empezá añadiendo el primer nodo de tu flujo.
                </p>
                <AddNodeInlineButton onAdd={addNode} />
              </div>
            ) : (
              <>
                <AddNodeInlineButton onAdd={addNode} />
                {state.nodes.map((node) => (
                  <div key={node.node_key} className="flex items-start gap-0">
                    <div className="w-[320px] sm:w-[360px]">
                      <NodeCard
                        node={node}
                        allNodes={state.nodes}
                        expanded={expanded.has(node.node_key)}
                        isEntry={state.entry_node_id === node.node_key}
                        isFlashed={flashedKey === node.node_key}
                        cardRef={setNodeRef(node.node_key)}
                        issues={issues.filter(
                          (i) =>
                            i.scope === "node" && i.node_key === node.node_key,
                        )}
                        onToggle={() => toggleExpanded(node.node_key)}
                        onUpdate={(patch) => updateNode(node.node_key, patch)}
                        onUpdateConfig={(patch) =>
                          updateNodeConfig(node.node_key, patch)
                        }
                        onRemove={() => removeNode(node.node_key)}
                        onSetEntry={() =>
                          setStateDirty((s) => ({
                            ...s,
                            entry_node_id: node.node_key,
                          }))
                        }
                      />
                    </div>
                    <AddNodeInlineButton onAdd={addNode} />
                  </div>
                ))}
              </>
            )}
          </div>
        </CanvasViewport>
      </div>

      <div className="z-10 flex-shrink-0 border-t border-border bg-card/40 shadow-xl shadow-black/40">
        <ValidationPanel issues={issues} onJump={jumpToNode} />
      </div>
    </div>
  );
}

// ============================================================
// Header
// ============================================================

function Header({
  state,
  setState,
  dirty,
  saving,
  activating,
  onSave,
  onStatus,
  onDelete,
  canActivate,
  onBack,
  onViewRuns,
}: {
  state: BuilderState;
  setState: React.Dispatch<React.SetStateAction<BuilderState>>;
  dirty: boolean;
  saving: boolean;
  activating: boolean;
  onSave: () => void;
  onStatus: (s: BuilderState["status"]) => void;
  onDelete: () => void;
  canActivate: boolean;
  onBack: () => void;
  onViewRuns: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        aria-label="Volver a flujos"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <Input
        value={state.name}
        onChange={(e) =>
          setState((s) => ({ ...s, name: e.target.value }))
        }
        placeholder="Nombre del flujo"
        className="min-w-0 max-w-xs flex-1 border-transparent bg-transparent px-2 text-base font-semibold focus-visible:border-border focus-visible:bg-card"
      />
      <StatusBadge status={state.status} />
      {dirty && (
        <span className="hidden h-1.5 w-1.5 rounded-full bg-amber-400 sm:inline-block" title="Cambios sin guardar" />
      )}
      <div className="ml-auto flex items-center gap-1.5">
        {state.status === "active" ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onStatus("draft")}
            disabled={activating}
          >
            {activating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PauseCircle className="h-3.5 w-3.5" />
            )}
            Pausar
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onStatus("active")}
            disabled={activating || !canActivate}
            title={!canActivate ? "Corrige los errores antes de activar" : undefined}
          >
            {activating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlayCircle className="h-3.5 w-3.5" />
            )}
            Activar
          </Button>
        )}
        <Button onClick={onSave} disabled={saving} size="sm">
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Guardar
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Más opciones"
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="border-border bg-card">
            <DropdownMenuItem onClick={() => onViewRuns()}>
              <History className="h-3.5 w-3.5" />
              Ejecuciones
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onDelete}
              className="text-red-400 focus:bg-red-500/10 focus:text-red-300"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Eliminar flujo
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: BuilderState["status"] }) {
  const cls = {
    draft: "border-border bg-muted text-foreground",
    active: "border-emerald-600/40 bg-emerald-500/10 text-emerald-300",
    archived: "border-border bg-muted/50 text-muted-foreground",
  }[status];
  const label = {
    draft: "Borrador",
    active: "Activo",
    archived: "Archivado",
  }[status];
  return (
    <Badge variant="outline" className={cn("shrink-0", cls)}>
      {label}
    </Badge>
  );
}

// ============================================================
// Trigger panel
// ============================================================

function TriggerPanel({
  state,
  setState,
  triggerIssues,
}: {
  state: BuilderState;
  setState: React.Dispatch<React.SetStateAction<BuilderState>>;
  triggerIssues: ValidationIssue[];
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">Activador</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Cuándo</label>
          <Select
            value={state.trigger_type}
            onValueChange={(v) =>
              setState((s) => ({
                ...s,
                trigger_type: v as BuilderState["trigger_type"],
                trigger_config:
                  v === "keyword" ? { keywords: [] } : v === "manual" ? {} : {},
              }))
            }
          >
            <SelectTrigger className="bg-muted">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="keyword">
                Un mensaje contiene una palabra clave
              </SelectItem>
              <SelectItem value="first_inbound_message">
                Primer mensaje entrante del cliente
              </SelectItem>
              <SelectItem value="manual">
                Solo manual (sin activación automática)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        {state.trigger_type === "keyword" && (
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Palabras clave
            </label>
            <Input
              value={
                Array.isArray(state.trigger_config.keywords)
                  ? (state.trigger_config.keywords as string[]).join(", ")
                  : ""
              }
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  trigger_config: {
                    ...s.trigger_config,
                    keywords: e.target.value
                      .split(",")
                      .map((k) => k.trim())
                      .filter(Boolean),
                  },
                }))
              }
              placeholder="soporte, ayuda, hola"
              className="bg-muted"
            />
          </div>
        )}
      </div>
      {triggerIssues.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          {triggerIssues.map((i, ix) => (
            <IssueLine key={ix} issue={i} />
          ))}
        </div>
      )}
    </section>
  );
}

// ============================================================
// Entry-node picker
// ============================================================

function EntryPicker({
  state,
  setState,
}: {
  state: BuilderState;
  setState: React.Dispatch<React.SetStateAction<BuilderState>>;
}) {
  if (state.nodes.length === 0) return null;
  return (
    <section className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
      <CornerDownRight className="h-4 w-4 shrink-0 text-accent-ink" />
      <span className="text-xs text-muted-foreground">Nodo de entrada:</span>
      <NodeKeySelect
        value={state.entry_node_id}
        nodes={state.nodes}
        onChange={(key) =>
          setState((s) => ({ ...s, entry_node_id: key }))
        }
        placeholder=""
        className="flex-1 max-w-xs"
      />
    </section>
  );
}

// ============================================================
// Node card — collapsed summary + expanded config form
// ============================================================

function NodeCard({
  node,
  allNodes,
  expanded,
  isEntry,
  isFlashed,
  cardRef,
  issues,
  onToggle,
  onUpdate,
  onUpdateConfig,
  onRemove,
  onSetEntry,
}: {
  node: BuilderNode;
  allNodes: BuilderNode[];
  expanded: boolean;
  isEntry: boolean;
  isFlashed: boolean;
  cardRef: (el: HTMLDivElement | null) => void;
  issues: ValidationIssue[];
  onToggle: () => void;
  onUpdate: (patch: Partial<BuilderNode>) => void;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  onRemove: () => void;
  onSetEntry: () => void;
}) {
  const meta = NODE_META[node.node_type];
  const hasError = issues.some((i) => i.severity === "error");
  const preview = summarizeNode(node);
  return (
    <div
      ref={cardRef}
      className={cn(
        "rounded-lg border bg-card transition-shadow duration-500",
        hasError
          ? "border-red-500/40"
          : isEntry
            ? "border-primary/50"
            : "border-border",
        isFlashed &&
          "ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            meta.bg,
          )}
        >
          <meta.icon className={cn("h-4 w-4", meta.color)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">
              {meta.label}
            </span>
            {isEntry && (
              <Badge
                variant="outline"
                className="border-primary/40 bg-primary/10 text-[10px] text-accent-ink"
              >
                Inicio
              </Badge>
            )}
          </div>
          {preview ? (
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
              {preview}
            </p>
          ) : (
            <p className="mt-0.5 text-xs italic text-muted-foreground">
              Sin configurar
            </p>
          )}
        </div>
        {hasError && (
          <CircleAlert className="h-3.5 w-3.5 shrink-0 text-red-400" />
        )}
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-border px-4 py-4">
          <NodeConfigForm
            node={node}
            allNodes={allNodes}
            onUpdate={onUpdate}
            onUpdateConfig={onUpdateConfig}
          />
          <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
            <div className="flex items-center gap-2">
              {!isEntry && (
                <Button variant="ghost" size="sm" onClick={onSetEntry}>
                  Marcar como entrada
                </Button>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemove}
              className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Eliminar nodo
            </Button>
          </div>
          {issues.length > 0 && (
            <div className="mt-3 flex flex-col gap-1 rounded-md bg-red-500/5 p-2">
              {issues.map((i, ix) => (
                <IssueLine key={ix} issue={i} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Per-node-type config form
// ============================================================

function NodeConfigForm({
  node,
  allNodes,
  onUpdate,
  onUpdateConfig,
}: {
  node: BuilderNode;
  allNodes: BuilderNode[];
  onUpdate: (patch: Partial<BuilderNode>) => void;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  const cfg = node.config;
  // Internal identifiers (node_key, reply_id columns on buttons/list rows)
  // are auto-generated and the runner is the only consumer. Hide them by
  // default so the form reads as plain editing; expose under "Advanced"
  // for the rare case where someone wants to lock a key for stable
  // analytics or external integration.
  const [showAdvanced, setShowAdvanced] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      {node.node_type === "start" && (
        <NextNodeRow
          value={(cfg as { next_node_key?: string }).next_node_key ?? ""}
          allNodes={allNodes}
          currentKey={node.node_key}
          onChange={(v) => onUpdateConfig({ next_node_key: v })}
          label="Advances to"
        />
      )}

      {node.node_type === "send_message" && (
        <>
          <TextRow
            label="Texto enviado al cliente"
            value={(cfg as { text?: string }).text ?? ""}
            onChange={(v) => onUpdateConfig({ text: v })}
          />
          <NextNodeRow
            value={(cfg as { next_node_key?: string }).next_node_key ?? ""}
            allNodes={allNodes}
            currentKey={node.node_key}
            onChange={(v) => onUpdateConfig({ next_node_key: v })}
            label="Avanza a"
          />
        </>
      )}

      {node.node_type === "send_buttons" && (
        <SendButtonsForm
          cfg={cfg as SendButtonsCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
          showAdvanced={showAdvanced}
        />
      )}

      {node.node_type === "send_list" && (
        <SendListForm
          cfg={cfg as SendListCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
          showAdvanced={showAdvanced}
        />
      )}

      {node.node_type === "collect_input" && (
        <>
          <TextRow
            label="Mensaje que se envía al cliente"
            value={(cfg as { prompt_text?: string }).prompt_text ?? ""}
            onChange={(v) => onUpdateConfig({ prompt_text: v })}
            rows={2}
          />
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Clave de variable
            </label>
            <Input
              value={(cfg as { var_key?: string }).var_key ?? ""}
              onChange={(e) =>
                onUpdateConfig({
                  var_key: e.target.value.replace(/[^a-zA-Z0-9_]/g, ""),
                })
              }
              placeholder="nombre"
              className="bg-muted font-mono text-xs"
            />
          </div>
          <NextNodeRow
            value={(cfg as { next_node_key?: string }).next_node_key ?? ""}
            allNodes={allNodes}
            currentKey={node.node_key}
            onChange={(v) => onUpdateConfig({ next_node_key: v })}
            label="Tras capturar, avanza a"
          />
        </>
      )}

      {node.node_type === "condition" && (
        <ConditionForm
          cfg={cfg as ConditionCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
        />
      )}

      {node.node_type === "set_tag" && (
        <SetTagForm
          cfg={cfg as SetTagCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
        />
      )}

      {node.node_type === "handoff" && (
        <TextRow
          label="Nota interna (para el agente que retome la conversación)"
          value={(cfg as { note?: string }).note ?? ""}
          onChange={(v) => onUpdateConfig({ note: v })}
          rows={2}
        />
      )}

      {(node.node_type === "send_image" ||
        node.node_type === "send_video" ||
        node.node_type === "send_document") && (
        <>
          <TextRow
            label="URL del archivo (https)"
            value={(cfg as { url?: string }).url ?? ""}
            onChange={(v) => onUpdateConfig({ url: v })}
          />
          {node.node_type === "send_document" && (
            <TextRow
              label="Nombre que ve el cliente"
              value={(cfg as { filename?: string }).filename ?? ""}
              onChange={(v) => onUpdateConfig({ filename: v })}
            />
          )}
          <TextRow
            label="Pie / descripción (opcional)"
            value={(cfg as { caption?: string }).caption ?? ""}
            onChange={(v) => onUpdateConfig({ caption: v })}
            rows={2}
          />
          <NextNodeRow
            value={(cfg as { next_node_key?: string }).next_node_key ?? ""}
            allNodes={allNodes}
            currentKey={node.node_key}
            onChange={(v) => onUpdateConfig({ next_node_key: v })}
            label="Avanza a"
          />
        </>
      )}

      {node.node_type === "send_cta_url" && (
        <>
          <TextRow
            label="Texto del mensaje"
            value={(cfg as { text?: string }).text ?? ""}
            onChange={(v) => onUpdateConfig({ text: v })}
            rows={2}
          />
          <TextRow
            label="Texto del botón (≤ 20 caracteres)"
            value={(cfg as { button_title?: string }).button_title ?? ""}
            onChange={(v) => onUpdateConfig({ button_title: v })}
          />
          <TextRow
            label="URL a abrir (https)"
            value={(cfg as { url?: string }).url ?? ""}
            onChange={(v) => onUpdateConfig({ url: v })}
          />
          <NextNodeRow
            value={(cfg as { next_node_key?: string }).next_node_key ?? ""}
            allNodes={allNodes}
            currentKey={node.node_key}
            onChange={(v) => onUpdateConfig({ next_node_key: v })}
            label="Avanza a"
          />
        </>
      )}

      {node.node_type === "wait" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Cantidad
              </label>
              <Input
                type="number"
                min={1}
                value={String((cfg as { amount?: number }).amount ?? 1)}
                onChange={(e) =>
                  onUpdateConfig({ amount: Number(e.target.value) })
                }
                className="bg-muted text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Unidad
              </label>
              <select
                value={String((cfg as { unit?: string }).unit ?? "hours")}
                onChange={(e) => onUpdateConfig({ unit: e.target.value })}
                className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
              >
                <option value="minutes">Minutos</option>
                <option value="hours">Horas</option>
                <option value="days">Días</option>
              </select>
            </div>
          </div>
          <NextNodeRow
            value={(cfg as { next_node_key?: string }).next_node_key ?? ""}
            allNodes={allNodes}
            currentKey={node.node_key}
            onChange={(v) => onUpdateConfig({ next_node_key: v })}
            label="Después de la espera, avanza a"
          />
        </>
      )}

      {node.node_type === "ai_intent" && (
        <AiIntentForm
          cfg={cfg as AiIntentCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
        />
      )}

      {node.node_type === "shopify_lookup" && (
        <>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Qué buscar
            </label>
            <select
              value={String((cfg as { kind?: string }).kind ?? "order_by_number")}
              onChange={(e) => onUpdateConfig({ kind: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="order_by_number">Pedido por número</option>
              <option value="order_by_email">Pedido por correo</option>
              <option value="last_order">Último pedido del contacto</option>
              <option value="product_by_handle">Producto por handle</option>
            </select>
          </div>
          {((cfg as { kind?: string }).kind ?? "order_by_number") !==
            "last_order" && (
            <TextRow
              label={
                "Variable de entrada (de un nodo \"Capturar entrada\" previo)"
              }
              value={(cfg as { input_var?: string }).input_var ?? ""}
              onChange={(v) => onUpdateConfig({ input_var: v })}
            />
          )}
          <TextRow
            label="Prefijo donde guardar el resultado"
            value={(cfg as { output_prefix?: string }).output_prefix ?? "order"}
            onChange={(v) => onUpdateConfig({ output_prefix: v })}
          />
          <NextNodeRow
            value={(cfg as { found_next_key?: string }).found_next_key ?? ""}
            allNodes={allNodes}
            currentKey={node.node_key}
            onChange={(v) => onUpdateConfig({ found_next_key: v })}
            label="Si encuentra → avanza a"
          />
          <NextNodeRow
            value={(cfg as { not_found_next_key?: string }).not_found_next_key ?? ""}
            allNodes={allNodes}
            currentKey={node.node_key}
            onChange={(v) => onUpdateConfig({ not_found_next_key: v })}
            label="Si no encuentra → avanza a"
          />
        </>
      )}

      <div className="border-t border-border pt-3">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {showAdvanced ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
          {showAdvanced ? "Ocultar" : "Mostrar"} opciones avanzadas
        </button>
        {showAdvanced && (
          <div className="mt-3 flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Clave del nodo
              </label>
              <Input
                value={node.node_key}
                onChange={(e) =>
                  onUpdate({ node_key: slugify(e.target.value, node.node_key) })
                }
                className="bg-muted font-mono text-xs"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- send_buttons form ----

interface SendButtonsCfg {
  text?: string;
  footer_text?: string;
  buttons?: Array<{ reply_id: string; title: string; next_node_key: string }>;
}

function SendButtonsForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
  showAdvanced,
}: {
  cfg: SendButtonsCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  showAdvanced: boolean;
}) {
  const buttons = cfg.buttons ?? [];
  const updateButton = (
    idx: number,
    patch: Partial<NonNullable<SendButtonsCfg["buttons"]>[number]>,
  ) => {
    onUpdateConfig({
      buttons: buttons.map((b, i) => (i === idx ? { ...b, ...patch } : b)),
    });
  };
  const addButton = () =>
    onUpdateConfig({
      buttons: [
        ...buttons,
        {
          reply_id: `btn_${buttons.length + 1}`,
          title: "Option",
          next_node_key: "",
        },
      ],
    });
  const removeButton = (idx: number) =>
    onUpdateConfig({ buttons: buttons.filter((_, i) => i !== idx) });

  return (
    <>
      <TextRow
        label="Texto del cuerpo"
        value={cfg.text ?? ""}
        onChange={(v) => onUpdateConfig({ text: v })}
        rows={3}
      />
      <TextRow
        label="Pie de página"
        value={cfg.footer_text ?? ""}
        onChange={(v) => onUpdateConfig({ footer_text: v })}
      />
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-xs text-muted-foreground">
            Botones (1–3)
          </label>
        </div>
        <div className="flex flex-col gap-3">
          {buttons.map((b, i) => (
            <div
              key={i}
              className={cn(
                "grid grid-cols-1 gap-2 rounded-md border border-border bg-muted/40 p-3",
                showAdvanced
                  ? "md:grid-cols-[1fr_2fr_2fr_auto]"
                  : "md:grid-cols-[2fr_2fr_auto]",
              )}
            >
              {showAdvanced && (
                <Input
                  value={b.reply_id}
                  onChange={(e) =>
                    updateButton(i, {
                      reply_id: slugify(e.target.value, `btn_${i + 1}`),
                    })
                  }
                  placeholder="reply_id"
                  className="bg-muted font-mono text-xs"
                />
              )}
              <Input
                value={b.title}
                onChange={(e) => updateButton(i, { title: e.target.value })}
                placeholder="Título visible"
                className="bg-muted"
                maxLength={20}
              />
              <NodeKeySelect
                value={b.next_node_key || null}
                nodes={allNodes}
                excludeKey={currentKey}
                onChange={(v) => updateButton(i, { next_node_key: v ?? "" })}
                placeholder=""
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeButton(i)}
                className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
        {buttons.length < 3 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={addButton}
            className="mt-2"
          >
            <Plus className="h-3.5 w-3.5" />
            Añadir botón
          </Button>
        )}
      </div>
    </>
  );
}

// ---- send_list form ----

interface SendListCfg {
  text?: string;
  button_label?: string;
  footer_text?: string;
  sections?: Array<{
    title?: string;
    rows: Array<{
      reply_id: string;
      title: string;
      description?: string;
      next_node_key: string;
    }>;
  }>;
}

function SendListForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
  showAdvanced,
}: {
  cfg: SendListCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  showAdvanced: boolean;
}) {
  const sections = cfg.sections ?? [];
  const totalRows = sections.reduce((sum, s) => sum + s.rows.length, 0);

  const updateSection = (
    sIdx: number,
    patch: Partial<NonNullable<SendListCfg["sections"]>[number]>,
  ) => {
    onUpdateConfig({
      sections: sections.map((s, i) =>
        i === sIdx ? { ...s, ...patch } : s,
      ),
    });
  };
  const addSection = () =>
    onUpdateConfig({
      sections: [
        ...sections,
        {
          title: "",
          rows: [
            {
              reply_id: `row_${totalRows + 1}`,
              title: `Option ${totalRows + 1}`,
              next_node_key: "",
            },
          ],
        },
      ],
    });
  const removeSection = (sIdx: number) =>
    onUpdateConfig({ sections: sections.filter((_, i) => i !== sIdx) });
  const updateRow = (
    sIdx: number,
    rIdx: number,
    patch: Partial<
      NonNullable<SendListCfg["sections"]>[number]["rows"][number]
    >,
  ) => {
    onUpdateConfig({
      sections: sections.map((s, i) =>
        i === sIdx
          ? {
              ...s,
              rows: s.rows.map((r, j) => (j === rIdx ? { ...r, ...patch } : r)),
            }
          : s,
      ),
    });
  };
  const addRow = (sIdx: number) =>
    onUpdateConfig({
      sections: sections.map((s, i) =>
        i === sIdx
          ? {
              ...s,
              rows: [
                ...s.rows,
                {
                  reply_id: `row_${totalRows + 1}`,
                  title: `Option ${totalRows + 1}`,
                  next_node_key: "",
                },
              ],
            }
          : s,
      ),
    });
  const removeRow = (sIdx: number, rIdx: number) =>
    onUpdateConfig({
      sections: sections.map((s, i) =>
        i === sIdx ? { ...s, rows: s.rows.filter((_, j) => j !== rIdx) } : s,
      ),
    });

  return (
    <>
      <TextRow
        label="Texto del cuerpo"
        value={cfg.text ?? ""}
        onChange={(v) => onUpdateConfig({ text: v })}
        rows={3}
      />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TextRow
          label="Texto del botón que despliega la lista"
          value={cfg.button_label ?? ""}
          onChange={(v) => onUpdateConfig({ button_label: v })}
        />
        <TextRow
          label="Pie de página"
          value={cfg.footer_text ?? ""}
          onChange={(v) => onUpdateConfig({ footer_text: v })}
        />
      </div>

      <div className="mt-2">
        <label className="mb-2 block text-xs text-muted-foreground">
          Filas (1–10 en total)
        </label>
        {sections.map((section, sIdx) => (
          <div
            key={sIdx}
            className="mb-3 rounded-md border border-border bg-muted/40 p-3"
          >
            <div className="mb-2 flex items-center gap-2">
              <Input
                value={section.title ?? ""}
                onChange={(e) =>
                  updateSection(sIdx, { title: e.target.value })
                }
                placeholder={`Título de la sección ${sIdx + 1}`}
                className="bg-muted text-xs"
              />
              {sections.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeSection(sIdx)}
                  className="shrink-0 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                  aria-label="Eliminar sección"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {section.rows.map((row, rIdx) => (
              <div
                key={rIdx}
                className={cn(
                  "mb-2 grid grid-cols-1 gap-2",
                  showAdvanced
                    ? "md:grid-cols-[1fr_2fr_2fr_auto]"
                    : "md:grid-cols-[2fr_2fr_auto]",
                )}
              >
                {showAdvanced && (
                  <Input
                    value={row.reply_id}
                    onChange={(e) =>
                      updateRow(sIdx, rIdx, {
                        reply_id: slugify(
                          e.target.value,
                          `row_${rIdx + 1}`,
                        ),
                      })
                    }
                    placeholder="reply_id"
                    className="bg-muted font-mono text-xs"
                  />
                )}
                <Input
                  value={row.title}
                  onChange={(e) =>
                    updateRow(sIdx, rIdx, { title: e.target.value })
                  }
                  placeholder="Título de la fila"
                  className="bg-muted"
                  maxLength={24}
                />
                <NodeKeySelect
                  value={row.next_node_key || null}
                  nodes={allNodes}
                  excludeKey={currentKey}
                  onChange={(v) =>
                    updateRow(sIdx, rIdx, { next_node_key: v ?? "" })
                  }
                  placeholder=""
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeRow(sIdx, rIdx)}
                  className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {totalRows < 10 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => addRow(sIdx)}
                className="mt-1"
              >
                <Plus className="h-3.5 w-3.5" />
                Añadir fila
              </Button>
            )}
          </div>
        ))}
        {/* WhatsApp's interactive-list spec caps sections at 10. Group rows
            by category (Billing / Support / Sales etc.) to give customers a
            scannable menu. */}
        {sections.length < 10 && (
          <Button
            variant="outline"
            size="sm"
            onClick={addSection}
          >
            <Plus className="h-3.5 w-3.5" />
            Añadir sección
          </Button>
        )}
      </div>
    </>
  );
}

// ---- condition form ----

interface ConditionCfg {
  subject?: "var" | "tag" | "contact_field";
  subject_key?: string;
  operator?: "equals" | "contains" | "present" | "absent";
  value?: string;
  true_next?: string;
  false_next?: string;
}

interface UserTag {
  id: string;
  name: string;
  color?: string;
}

function ConditionForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
}: {
  cfg: ConditionCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  const [tags, setTags] = useState<UserTag[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tags").catch(() => null);
        if (!res || !res.ok) return;
        const json = (await res.json()) as { tags?: UserTag[] };
        if (!cancelled) setTags(json.tags ?? []);
      } catch {
        // Tags endpoint absent on older deployments — fall back to a
        // plain text input so the condition is still authorable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const subject = cfg.subject ?? "var";
  const operator = cfg.operator ?? "equals";
  const showValue = operator === "equals" || operator === "contains";

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Si</label>
          <Select
            value={subject}
            onValueChange={(v) =>
              onUpdateConfig({ subject: v as ConditionCfg["subject"] })
            }
          >
            <SelectTrigger className="bg-muted">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="var">Variable capturada</SelectItem>
              <SelectItem value="tag">El contacto tiene la etiqueta</SelectItem>
              <SelectItem value="contact_field">Campo del contacto</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-2">
          <label className="mb-1 block text-xs text-muted-foreground">
            {subject === "var"
              ? "nombre de variable"
              : subject === "tag"
                ? "Etiqueta"
                : "Campo"}
          </label>
          {subject === "tag" && tags.length > 0 ? (
            <Select
              value={cfg.subject_key ?? ""}
              onValueChange={(v) => onUpdateConfig({ subject_key: v })}
            >
              <SelectTrigger className="bg-muted">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tags.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : subject === "contact_field" ? (
            <Select
              value={cfg.subject_key ?? ""}
              onValueChange={(v) => onUpdateConfig({ subject_key: v })}
            >
              <SelectTrigger className="bg-muted">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">nombre</SelectItem>
                <SelectItem value="email">correo</SelectItem>
                <SelectItem value="phone">teléfono</SelectItem>
                <SelectItem value="company">empresa</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={cfg.subject_key ?? ""}
              onChange={(e) => onUpdateConfig({ subject_key: e.target.value })}
              placeholder={subject === "var" ? "correo" : "UUID de la etiqueta"}
              className="bg-muted font-mono text-xs"
            />
          )}
        </div>
      </div>

      <div
        className={cn(
          "grid grid-cols-1 gap-3",
          showValue ? "md:grid-cols-2" : "",
        )}
      >
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Operador</label>
          <Select
            value={operator}
            onValueChange={(v) =>
              onUpdateConfig({ operator: v as ConditionCfg["operator"] })
            }
          >
            <SelectTrigger className="bg-muted">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="present">existe</SelectItem>
              <SelectItem value="absent">no existe</SelectItem>
              <SelectItem value="equals">es igual a</SelectItem>
              <SelectItem value="contains">contiene</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {showValue && (
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Valor</label>
            <Input
              value={cfg.value ?? ""}
              onChange={(e) => onUpdateConfig({ value: e.target.value })}
              className="bg-muted"
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <NextNodeRow
          value={cfg.true_next ?? ""}
          allNodes={allNodes}
          currentKey={currentKey}
          onChange={(v) => onUpdateConfig({ true_next: v })}
          label="Si es verdadero → avanza a"
        />
        <NextNodeRow
          value={cfg.false_next ?? ""}
          allNodes={allNodes}
          currentKey={currentKey}
          onChange={(v) => onUpdateConfig({ false_next: v })}
          label="Si es falso → avanza a"
        />
      </div>
    </>
  );
}

// ---- set_tag form ----

interface SetTagCfg {
  mode?: "add" | "remove";
  tag_id?: string;
  next_node_key?: string;
}

function SetTagForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
}: {
  cfg: SetTagCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  const [tags, setTags] = useState<UserTag[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tags").catch(() => null);
        if (!res || !res.ok) return;
        const json = (await res.json()) as { tags?: UserTag[] };
        if (!cancelled) setTags(json.tags ?? []);
      } catch {
        // No tags endpoint — fall back to raw UUID input.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Acción</label>
          <Select
            value={cfg.mode ?? "add"}
            onValueChange={(v) =>
              onUpdateConfig({ mode: v as SetTagCfg["mode"] })
            }
          >
            <SelectTrigger className="bg-muted">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="add">Añadir etiqueta</SelectItem>
              <SelectItem value="remove">Quitar etiqueta</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Etiqueta</label>
          {tags.length > 0 ? (
            <Select
              value={cfg.tag_id ?? ""}
              onValueChange={(v) => onUpdateConfig({ tag_id: v })}
            >
              <SelectTrigger className="bg-muted">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tags.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={cfg.tag_id ?? ""}
              onChange={(e) => onUpdateConfig({ tag_id: e.target.value })}
              placeholder="UUID de la etiqueta"
              className="bg-muted font-mono text-xs"
            />
          )}
        </div>
      </div>
      <NextNodeRow
        value={cfg.next_node_key ?? ""}
        allNodes={allNodes}
        currentKey={currentKey}
        onChange={(v) => onUpdateConfig({ next_node_key: v })}
        label="Luego avanza a"
      />
    </>
  );
}

// ---- Smaller field components ----

function TextRow({
  label,
  value,
  onChange,
  rows = 1,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      {rows > 1 ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          className="bg-muted"
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="bg-muted"
        />
      )}
    </div>
  );
}

function NextNodeRow({
  value,
  allNodes,
  currentKey,
  onChange,
  label,
}: {
  value: string;
  allNodes: BuilderNode[];
  currentKey: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <NodeKeySelect
        value={value || null}
        nodes={allNodes}
        excludeKey={currentKey}
        onChange={(v) => onChange(v ?? "")}
        placeholder=""
      />
    </div>
  );
}

function NodeKeySelect({
  value,
  nodes,
  excludeKey,
  onChange,
  placeholder,
  className,
}: {
  value: string | null;
  nodes: BuilderNode[];
  excludeKey?: string;
  onChange: (v: string | null) => void;
  placeholder?: string;
  className?: string;
}) {
  const options = nodes.filter((n) => n.node_key !== excludeKey);
  return (
    <Select
      value={value ?? "__none__"}
      onValueChange={(v) => onChange(v === "__none__" ? null : v)}
    >
      <SelectTrigger className={cn("bg-muted", className)}>
        <SelectValue placeholder={placeholder ?? "—"} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">— Ninguno —</SelectItem>
        {options.map((n) => {
          const Icon = NODE_META[n.node_type].icon;
          return (
            <SelectItem key={n.node_key} value={n.node_key}>
              <span className="inline-flex items-center gap-1.5">
                <Icon
                  className={cn("h-3 w-3", NODE_META[n.node_type].color)}
                />
                {n.node_key}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

// ============================================================
// Add-node menu
// ============================================================

// All node types user can add, including the v2 Shopify-tuned set.
const ADDABLE_NODE_TYPES: NodeType[] = [
  "send_buttons",
  "send_list",
  "send_message",
  "send_image",
  "send_video",
  "send_document",
  "send_cta_url",
  "collect_input",
  "ai_intent",
  "shopify_lookup",
  "condition",
  "set_tag",
  "wait",
  "handoff",
  "end",
];

/**
 * Compact pill rendered between every pair of nodes in the canvas —
 * same visual language as the automations builder's AddButton. Opens
 * the full picker so the user can drop any node type at that spot.
 */
function AddNodeInlineButton({
  onAdd,
}: {
  onAdd: (type: NodeType) => void;
}) {
  return (
    <div className="flex shrink-0 items-center self-start pt-7">
      <div className="h-[2px] w-6 bg-border" aria-hidden />
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full border-2 border-dashed border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-all",
            "hover:border-primary hover:bg-primary/10 hover:text-accent-ink",
            "data-[popup-open]:border-primary data-[popup-open]:bg-primary/15 data-[popup-open]:text-accent-ink",
          )}
          aria-label="Añadir nodo"
        >
          <Plus className="h-3.5 w-3.5" />
          Añadir
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-80 min-w-64 overflow-y-auto border-border bg-card"
        >
          <div className="border-b border-border px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Elegí qué nodo añadir
          </div>
          {ADDABLE_NODE_TYPES.map((t) => {
            const meta = NODE_META[t];
            return (
              <DropdownMenuItem key={t} onClick={() => onAdd(t)}>
                <meta.icon className={cn("h-3.5 w-3.5", meta.color)} />
                {meta.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="h-[2px] w-6 bg-border" aria-hidden />
    </div>
  );
}

// ============================================================
// Validation panel — bottom of the editor
// ============================================================

function ValidationPanel({
  issues,
  onJump,
}: {
  issues: ValidationIssue[];
  onJump: (key: string) => void;
}) {
  if (issues.length === 0) {
    // Slate-950 base + emerald accents so the panel stays readable when
    // sticky-positioned over scrolled-behind node cards (a translucent
    // bg-emerald-500/10 would bleed through ugly).
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-600/50 bg-card p-3 text-sm font-medium text-emerald-300">
        <CircleCheck className="h-4 w-4 shrink-0" />
        Listo para activar.
      </div>
    );
  }
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3",
        errors.length > 0 ? "border-red-500/40" : "border-amber-500/40",
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        {errors.length > 0 ? (
          <CircleAlert className="h-4 w-4 text-red-400" />
        ) : (
          <CircleAlert className="h-4 w-4 text-amber-400" />
        )}
        {errors.length} error{errors.length === 1 ? "" : "es"},{" "}
        {warnings.length} advertencia{warnings.length === 1 ? "" : "s"}
      </div>
      <div className="flex flex-col gap-1">
        {issues.map((i, ix) => (
          <IssueLine key={ix} issue={i} onJump={onJump} />
        ))}
      </div>
    </div>
  );
}

function IssueLine({
  issue,
  onJump,
}: {
  issue: ValidationIssue;
  onJump?: (key: string) => void;
}) {
  const tone =
    issue.severity === "error" ? "text-red-300" : "text-amber-300";
  const iconTone =
    issue.severity === "error" ? "text-red-400" : "text-amber-400";
  const body = (
    <>
      <CircleAlert className={cn("mt-0.5 h-3 w-3 shrink-0", iconTone)} />
      <span className="min-w-0 flex-1">
        {issue.node_key && (
          <code className="mr-1 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
            {issue.node_key}
          </code>
        )}
        {issue.message}
      </span>
    </>
  );

  // Only node-scoped issues can jump; trigger-scoped issues have no
  // destination (the trigger panel is already at the top of the page).
  if (issue.node_key && onJump) {
    return (
      <button
        type="button"
        onClick={() => onJump(issue.node_key!)}
        className={cn(
          "flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-accent",
          tone,
        )}
        aria-label={`Ir al nodo ${issue.node_key}`}
      >
        {body}
      </button>
    );
  }
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md px-2 py-1 text-xs",
        tone,
      )}
    >
      {body}
    </div>
  );
}

interface AiIntentCfg {
  prompt_text?: string;
  intents?: Array<{ intent_key: string; description: string; next_node_key: string }>;
  fallback_next_key?: string;
}

function AiIntentForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
}: {
  cfg: AiIntentCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  const intents = cfg.intents ?? [];
  const updateIntent = (
    idx: number,
    patch: Partial<NonNullable<AiIntentCfg['intents']>[number]>,
  ) => {
    onUpdateConfig({
      intents: intents.map((i, j) => (j === idx ? { ...i, ...patch } : i)),
    });
  };
  const addIntent = () =>
    onUpdateConfig({
      intents: [
        ...intents,
        { intent_key: `intent_${intents.length + 1}`, description: '', next_node_key: '' },
      ],
    });
  const removeIntent = (idx: number) =>
    onUpdateConfig({ intents: intents.filter((_, j) => j !== idx) });

  return (
    <>
      <TextRow
        label="Mensaje al cliente antes de esperar su respuesta (opcional)"
        value={cfg.prompt_text ?? ''}
        onChange={(v) => onUpdateConfig({ prompt_text: v })}
        rows={2}
      />
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          Intenciones a clasificar
        </label>
        <div className="space-y-2">
          {intents.map((it, idx) => (
            <div
              key={idx}
              className="rounded-md border border-border bg-muted/40 p-2"
            >
              <div className="mb-2 grid grid-cols-2 gap-2">
                <Input
                  value={it.intent_key}
                  onChange={(e) => updateIntent(idx, { intent_key: e.target.value })}
                  placeholder="intent_key"
                  className="bg-background font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => removeIntent(idx)}
                  className="self-start justify-self-end rounded p-1 text-muted-foreground hover:bg-accent hover:text-red-400"
                  aria-label="Quitar intención"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <Input
                value={it.description}
                onChange={(e) => updateIntent(idx, { description: e.target.value })}
                placeholder="Cuándo aplica (ej: 'cliente pregunta por envíos')"
                className="mb-2 bg-background text-sm"
              />
              <NextNodeRow
                value={it.next_node_key}
                allNodes={allNodes}
                currentKey={currentKey}
                onChange={(v) => updateIntent(idx, { next_node_key: v })}
                label="Si coincide → avanza a"
              />
            </div>
          ))}
          <button
            type="button"
            onClick={addIntent}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:border-foreground/40 hover:text-foreground"
          >
            <Plus className="h-3 w-3" />
            Añadir intención
          </button>
        </div>
      </div>
      <NextNodeRow
        value={cfg.fallback_next_key ?? ''}
        allNodes={allNodes}
        currentKey={currentKey}
        onChange={(v) => onUpdateConfig({ fallback_next_key: v })}
        label="Si ninguna intención coincide → avanza a"
      />
    </>
  );
}
