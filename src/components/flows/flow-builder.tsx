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
  Zap,
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
import {
  CanvasViewport,
  useCanvasTransform,
} from "@/components/canvas/canvas-viewport";
import { WhatsappBubblePreview } from "@/components/flows/whatsapp-bubble-preview";
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
  /**
   * Coordenadas en el lienzo libre. 0/0 significa "todavía no
   * posicionado" — el auto-layout las completa la primera vez y a
   * partir de ahí persisten en flow_nodes (PUT /api/flows/[id]).
   */
  position_x: number;
  position_y: number;
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
      position_x: typeof n.position_x === 'number' ? n.position_x : 0,
      position_y: typeof n.position_y === 'number' ? n.position_y : 0,
    })),
  }));

  // ---- One-shot auto-layout when nothing is positioned yet ----
  // El disparador queda anclado en TRIGGER_POS (no draggeable, no se
  // persiste — siempre vive en el mismo lugar del lienzo). Los demás
  // nodos sí se posicionan libremente y persisten en flow_nodes.
  const layoutInitRef = useRef(false);
  useEffect(() => {
    if (layoutInitRef.current) return;
    if (state.nodes.length === 0) return;
    const allAtZero = state.nodes.every(
      (n) => n.position_x === 0 && n.position_y === 0,
    );
    if (!allAtZero) {
      layoutInitRef.current = true;
      return;
    }
    layoutInitRef.current = true;
    const layouted = autoLayout(state.nodes, state.entry_node_id);
    setState((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => {
        const pos = layouted.get(n.node_key);
        return pos ? { ...n, position_x: pos.x, position_y: pos.y } : n;
      }),
    }));
    setDirty(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          nodes: state.nodes.map((n) => ({
            node_key: n.node_key,
            node_type: n.node_type,
            config: n.config,
            position_x: n.position_x,
            position_y: n.position_y,
          })),
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
      router.push("/menus");
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
        // Posición por defecto del nuevo nodo: lo dejamos a la derecha
        // del nodo más a la derecha actualmente en el lienzo + un
        // offset, así no aparece encima de otro y el usuario lo ve.
        const maxX = s.nodes.reduce(
          (m, n) => Math.max(m, n.position_x),
          TRIGGER_POS.x + CARD_WIDTH + 80,
        );
        const next: BuilderNode = {
          node_key,
          node_type: type,
          config: defaultConfigFor(type),
          position_x: maxX + CARD_GAP_X,
          position_y: TRIGGER_POS.y,
        };
        setExpanded((prev) => new Set([...prev, node_key]));
        return {
          ...s,
          nodes: [...s.nodes, next],
          // First node of an empty flow auto-becomes the entry —
          // saves the user from also having to pick it in a
          // separate "entry" picker.
          entry_node_id: s.entry_node_id ?? (s.nodes.length === 0 ? node_key : null),
        };
      });
    },
    [setStateDirty],
  );

  /**
   * Move a node to a new position. Called from the canvas drag handler.
   */
  const moveNode = useCallback(
    (key: string, x: number, y: number) => {
      setStateDirty((s) => ({
        ...s,
        nodes: s.nodes.map((n) =>
          n.node_key === key ? { ...n, position_x: x, position_y: y } : n,
        ),
      }));
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

  // ---- Render ----
  return (
    // z-50 puts the editor above the dashboard sidebar (z-40) so the
    // user gets a dedicated full-screen canvas environment, no
    // sidebar chrome poking in from the left.
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
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
          onBack={() => router.push("/menus")}
          onViewRuns={() => router.push(`/menus/${initialFlow.id}/runs`)}
        />
      </div>

      {/* Mini banner educativo — separa visualmente este modo
          (interactivo, dentro de ventana 24h) de las Automatizaciones
          (asíncronas, plantillas HSM). Es el gap más grande que la
          competencia mezcla en un solo editor y confunde al merchant. */}
      <div className="flex-shrink-0 border-b border-border bg-emerald-500/5 px-4 py-2 text-[11px] text-emerald-300">
        <span className="font-semibold">Se activa cuando el cliente te escribe.</span>{" "}
        <span className="text-muted-foreground">
          Para mensajes que inicias tú (carrito, despacho, marketing), usa
          {" "}
          <a href="/automatizaciones" className="underline hover:text-foreground">
            Automatizaciones
          </a>
          .
        </span>
      </div>

      {/* Canvas libre: cada nodo posicionado en (position_x, position_y),
          conectados por líneas SVG curvas que se re-calculan en cada
          re-render → arrastrá cualquier card y las líneas se estiran
          solas. El disparador queda fijo en la esquina (no draggeable). */}
      <div className="relative flex min-h-0 flex-1">
        <CanvasViewport>
          <FlowCanvas
            entryKey={state.entry_node_id}
            allNodes={state.nodes}
            expanded={expanded}
            entryNodeId={state.entry_node_id}
            flashedKey={flashedKey}
            issues={issues}
            setNodeRef={setNodeRef}
            onToggle={toggleExpanded}
            onUpdate={updateNode}
            onUpdateConfig={updateNodeConfig}
            onMove={moveNode}
            onRemove={removeNode}
            onSetEntry={(key) =>
              setStateDirty((s) => ({ ...s, entry_node_id: key }))
            }
            onAdd={addNode}
            triggerType={state.trigger_type}
            triggerConfig={state.trigger_config}
            triggerIssues={issues.filter((i) => i.scope === "trigger")}
            onTriggerChange={(type, config) =>
              setStateDirty((s) => ({
                ...s,
                trigger_type: type,
                trigger_config: config,
              }))
            }
          />
        </CanvasViewport>
        {/* Floating palette — siempre disponible en la esquina del lienzo
            para agregar un paso sin importar dónde estés viendo el árbol.
            El paso recién creado aparece como "huérfano" abajo y el
            usuario lo conecta donde quiera con el selector "Avanza a". */}
        {state.nodes.length > 0 && (
          <div className="pointer-events-none absolute bottom-4 right-4 z-20">
            <div className="pointer-events-auto">
              <FloatingAddPalette onAdd={addNode} />
            </div>
          </div>
        )}
      </div>

      {/* Validation panel sólo cuando el usuario ya empezó a armar el
          menú. Si la lona está vacía, los errores de "te falta esto" son
          ruido visual — el empty state ya guía qué hacer. */}
      {state.nodes.length > 0 && (
        <div className="z-10 flex-shrink-0 border-t border-border bg-card/40 shadow-xl shadow-black/40">
          <ValidationPanel issues={issues} onJump={jumpToNode} />
        </div>
      )}
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
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
      >
        <div
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
            meta.bg,
          )}
        >
          <meta.icon className={cn("h-3.5 w-3.5", meta.color)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">
              {meta.label}
            </span>
            {isEntry && (
              <span className="rounded bg-primary/15 px-1 text-[9px] font-semibold uppercase tracking-wide text-primary">
                Inicio
              </span>
            )}
            {hasError && (
              <CircleAlert className="h-3 w-3 shrink-0 text-red-400" />
            )}
          </div>
          {preview && (
            <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
              {preview}
            </p>
          )}
        </div>
      </button>
      {/* WhatsApp bubble preview — shows the merchant exactly what the
          customer will see in their phone. Honest about Meta's 3-button
          / 20-char / 10-row limits via truncation. */}
      <NodeBubblePreview node={node} />
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
// Node bubble preview — small WhatsApp chat preview inside the card
// ============================================================
// Only renders for node types the customer actually sees. Internal-only
// types (condition / set_tag / wait / shopify_lookup / handoff / start /
// end / ai_intent) skip the bubble — they don't produce a message.
function NodeBubblePreview({ node }: { node: BuilderNode }) {
  const cfg = node.config as Record<string, unknown>;
  switch (node.node_type) {
    case "send_message": {
      const text = (cfg.text as string) ?? "";
      if (!text.trim()) return null;
      return (
        <div className="border-t border-border px-3 pb-3 pt-2">
          <WhatsappBubblePreview kind="text" text={text} />
        </div>
      );
    }
    case "send_buttons": {
      const text = (cfg.text as string) ?? "";
      const buttons = Array.isArray(cfg.buttons)
        ? (cfg.buttons as Array<{ title?: string }>).map((b) => ({
            title: b.title ?? "",
          }))
        : [];
      if (!text.trim() && buttons.length === 0) return null;
      return (
        <div className="border-t border-border px-3 pb-3 pt-2">
          <WhatsappBubblePreview kind="buttons" text={text} buttons={buttons} />
        </div>
      );
    }
    case "send_list": {
      const text = (cfg.text as string) ?? "";
      const label = (cfg.button_label as string) ?? "Ver opciones";
      const sections = Array.isArray(cfg.sections)
        ? (cfg.sections as Array<{
            rows?: Array<{ title?: string; description?: string }>
          }>)
        : [];
      const rows = sections.flatMap((s) =>
        (s.rows ?? []).map((r) => ({
          title: r.title ?? "",
          description: r.description,
        })),
      );
      if (!text.trim() && rows.length === 0) return null;
      return (
        <div className="border-t border-border px-3 pb-3 pt-2">
          <WhatsappBubblePreview
            kind="list"
            text={text}
            listButtonLabel={label}
            listRows={rows}
          />
        </div>
      );
    }
    case "send_cta_url": {
      const text = (cfg.text as string) ?? "";
      const title = (cfg.button_title as string) ?? "";
      const url = (cfg.url as string) ?? "";
      if (!text.trim() && !title) return null;
      return (
        <div className="border-t border-border px-3 pb-3 pt-2">
          <WhatsappBubblePreview
            kind="cta_url"
            text={text}
            ctaTitle={title}
            ctaUrl={url}
          />
        </div>
      );
    }
    case "send_image":
    case "send_video": {
      const url = (cfg.url as string) ?? "";
      const caption = (cfg.caption as string) ?? "";
      if (!url && !caption) return null;
      return (
        <div className="border-t border-border px-3 pb-3 pt-2">
          <WhatsappBubblePreview
            kind={node.node_type === "send_image" ? "image" : "video"}
            mediaUrl={url}
            text=""
            caption={caption}
          />
        </div>
      );
    }
    case "send_document": {
      const filename = (cfg.filename as string) ?? "";
      const caption = (cfg.caption as string) ?? "";
      if (!filename && !caption) return null;
      return (
        <div className="border-t border-border px-3 pb-3 pt-2">
          <WhatsappBubblePreview
            kind="document"
            filename={filename}
            text=""
            caption={caption}
          />
        </div>
      );
    }
    case "collect_input": {
      const text = (cfg.prompt_text as string) ?? "";
      if (!text.trim()) return null;
      return (
        <div className="border-t border-border px-3 pb-3 pt-2">
          <WhatsappBubblePreview kind="text" text={text} />
        </div>
      );
    }
    case "ai_intent": {
      const text = (cfg.prompt_text as string) ?? "";
      if (!text.trim()) return null;
      return (
        <div className="border-t border-border px-3 pb-3 pt-2">
          <WhatsappBubblePreview kind="text" text={text} />
        </div>
      );
    }
    default:
      return null;
  }
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
          label="Avanza a"
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
        {buttons.length < 3 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={addButton}
            className="mt-2"
          >
            <Plus className="h-3.5 w-3.5" />
            Añadir botón
          </Button>
        ) : (
          <p className="mt-2 inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
            <CircleAlert className="h-3 w-3" />
            WhatsApp permite máximo 3 botones de respuesta. Usá una lista para más opciones.
          </p>
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
        <div className="mb-2 flex items-center justify-between">
          <label className="text-xs text-muted-foreground">
            Filas (máximo 10 en total)
          </label>
          <span
            className={cn(
              "text-[11px] tabular-nums",
              totalRows >= 10 ? "text-amber-300" : "text-muted-foreground",
            )}
          >
            {totalRows}/10
          </span>
        </div>
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
            {totalRows < 10 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => addRow(sIdx)}
                className="mt-1"
              >
                <Plus className="h-3.5 w-3.5" />
                Añadir fila
              </Button>
            ) : (
              <p className="mt-2 inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
                <CircleAlert className="h-3 w-3" />
                Límite WhatsApp: 10 filas por mensaje. Encadená otro nodo de lista.
              </p>
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
    // El usuario pidió quitar la pastilla "Listo para activar" porque
    // distrae sin aportar — el botón Activar arriba ya comunica el
    // estado. Cuando el editor no tiene problemas, no mostramos nada.
    return null;
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

// ============================================================
// Tree renderer — the whole point of button flows
// ============================================================
// A flow has a graph shape, not a list. Walking outgoing edges from
// the entry node gives us the actual chain of cards the user sees,
// with branches (send_buttons / send_list / condition / ai_intent /
// shopify_lookup) dropped as labeled columns below their source.
// ============================================================

interface OutgoingEdge {
  /** Visible chip label for the branch ("Sí", "Botón: Pedido", etc). */
  label: string | null
  /** node_key the edge points to. Empty string = unset (user to wire). */
  nextKey: string
}

// ============================================================
// Free-form canvas: posiciones absolutas + drag + líneas SVG
// ============================================================

/** Ancho del NodeCard (debe coincidir con el className del wrapper). */
const CARD_WIDTH = 260
/** Altura del header del NodeCard donde sale/entra la línea (centro del ícono). */
const CARD_AXIS_PX = 28
/** Gap horizontal y vertical entre columnas/filas del auto-layout. */
const CARD_GAP_X = 100
const CARD_GAP_Y = 180
/** Posición fija del disparador. No es draggeable (no se persiste). */
const TRIGGER_POS = { x: 40, y: 200 }
const TRIGGER_WIDTH = 260

/**
 * Auto-layout hierárquico: BFS desde el entry, agrupa por profundidad,
 * apila las ramas verticalmente en cada columna. Sólo corre la primera
 * vez (cuando todas las posiciones son 0/0). Después, el usuario
 * arrastra a su gusto.
 *
 * Salida: Map<node_key, {x, y}>. Nodos no alcanzables desde el entry
 * caen como huérfanos abajo, en columna -1, para que el usuario los
 * vea y los conecte o borre.
 */
function autoLayout(
  nodes: BuilderNode[],
  entryKey: string | null,
): Map<string, { x: number; y: number }> {
  const byKey = new Map(nodes.map((n) => [n.node_key, n]))
  const depth = new Map<string, number>()
  if (entryKey && byKey.has(entryKey)) {
    const queue: Array<[string, number]> = [[entryKey, 0]]
    while (queue.length) {
      const [k, d] = queue.shift()!
      if (depth.has(k)) continue
      depth.set(k, d)
      const node = byKey.get(k)
      if (!node) continue
      for (const e of getOutgoingEdges(node)) {
        if (e.nextKey && !depth.has(e.nextKey)) {
          queue.push([e.nextKey, d + 1])
        }
      }
    }
  }
  const byDepth = new Map<number, string[]>()
  for (const [k, d] of depth) {
    if (!byDepth.has(d)) byDepth.set(d, [])
    byDepth.get(d)!.push(k)
  }
  const positions = new Map<string, { x: number; y: number }>()
  const colW = CARD_WIDTH + CARD_GAP_X
  const baseX = TRIGGER_POS.x + TRIGGER_WIDTH + CARD_GAP_X
  const sortedDepths = Array.from(byDepth.keys()).sort((a, b) => a - b)
  for (const d of sortedDepths) {
    const keys = byDepth.get(d)!
    const x = baseX + d * colW
    const totalH = (keys.length - 1) * CARD_GAP_Y
    const startY = TRIGGER_POS.y - totalH / 2
    keys.forEach((k, i) => {
      positions.set(k, { x, y: startY + i * CARD_GAP_Y })
    })
  }
  let orphanY = TRIGGER_POS.y + 600
  for (const n of nodes) {
    if (!positions.has(n.node_key)) {
      positions.set(n.node_key, { x: TRIGGER_POS.x, y: orphanY })
      orphanY += CARD_GAP_Y
    }
  }
  return positions
}

interface CanvasEdge {
  /** Key del nodo origen, o "__trigger__" cuando sale del disparador. */
  fromKey: string
  /** Key del nodo destino. */
  toKey: string
  /** Coordenadas absolutas del punto de salida (lado derecho del origen). */
  from: { x: number; y: number }
  /** Coordenadas absolutas del punto de entrada (lado izquierdo del destino). */
  to: { x: number; y: number }
  /** Etiqueta de la rama (Mi pedido, Sí/No, Encontrado, …). null = lineal. */
  label: string | null
}

function FlowCanvas(props: FlowTreeProps) {
  const nodesByKey = useMemo(() => {
    const m = new Map<string, BuilderNode>()
    for (const n of props.allNodes) m.set(n.node_key, n)
    return m
  }, [props.allNodes])

  /**
   * Calcula todas las aristas con sus coordenadas absolutas, leyendo
   * la posición actual de cada nodo. Se re-ejecuta cuando cualquier
   * nodo se mueve (las líneas se "estiran" automáticamente).
   */
  const edges = useMemo<CanvasEdge[]>(() => {
    const out: CanvasEdge[] = []
    // Disparador → nodo de entrada
    if (props.entryKey && nodesByKey.has(props.entryKey)) {
      const target = nodesByKey.get(props.entryKey)!
      out.push({
        fromKey: "__trigger__",
        toKey: target.node_key,
        from: {
          x: TRIGGER_POS.x + TRIGGER_WIDTH,
          y: TRIGGER_POS.y + CARD_AXIS_PX,
        },
        to: {
          x: target.position_x,
          y: target.position_y + CARD_AXIS_PX,
        },
        label: null,
      })
    }
    // Aristas entre nodos
    for (const node of props.allNodes) {
      for (const e of getOutgoingEdges(node)) {
        if (!e.nextKey) continue
        const target = nodesByKey.get(e.nextKey)
        if (!target) continue
        out.push({
          fromKey: node.node_key,
          toKey: target.node_key,
          from: {
            x: node.position_x + CARD_WIDTH,
            y: node.position_y + CARD_AXIS_PX,
          },
          to: {
            x: target.position_x,
            y: target.position_y + CARD_AXIS_PX,
          },
          label: e.label,
        })
      }
    }
    return out
  }, [props.allNodes, props.entryKey, nodesByKey])

  // Caja virtual del lienzo — grande para que el usuario pueda mover
  // nodos lejos sin que la página se "termine". El viewport hace pan
  // y zoom encima.
  const CANVAS_W = 6000
  const CANVAS_H = 4000

  return (
    <div
      className="relative"
      style={{ width: CANVAS_W, height: CANVAS_H }}
    >
      {/* SVG con todas las líneas — capa de fondo. pointer-events:none
          para que el drag de los nodos funcione. */}
      <svg
        className="pointer-events-none absolute inset-0"
        width={CANVAS_W}
        height={CANVAS_H}
      >
        {edges.map((e, i) => (
          <ConnectorPath key={i} edge={e} />
        ))}
      </svg>

      {/* Etiquetas de las ramas — HTML overlay, no SVG, para que el
          texto se vea nítido y respete fuentes/tamaño. Posicionadas en
          el midpoint del path. */}
      {edges.map((e, i) =>
        e.label ? <ConnectorLabel key={`l${i}`} edge={e} /> : null,
      )}

      {/* Disparador — fijo en TRIGGER_POS, NO draggeable */}
      <div
        className="absolute"
        style={{
          left: TRIGGER_POS.x,
          top: TRIGGER_POS.y,
          width: TRIGGER_WIDTH,
        }}
      >
        <CanvasTriggerCard
          triggerType={props.triggerType}
          triggerConfig={props.triggerConfig}
          triggerIssues={props.triggerIssues}
          onChange={props.onTriggerChange}
        />
      </div>

      {/* Nodos — cada uno absoluto, con drag handle integrado */}
      {props.allNodes.map((node) => (
        <DraggableNode
          key={node.node_key}
          node={node}
          allNodes={props.allNodes}
          expanded={props.expanded.has(node.node_key)}
          isEntry={props.entryNodeId === node.node_key}
          isFlashed={props.flashedKey === node.node_key}
          cardRef={props.setNodeRef(node.node_key)}
          issues={props.issues.filter(
            (i) => i.scope === "node" && i.node_key === node.node_key,
          )}
          onMove={(x, y) => props.onMove(node.node_key, x, y)}
          onToggle={() => props.onToggle(node.node_key)}
          onUpdate={(patch) => props.onUpdate(node.node_key, patch)}
          onUpdateConfig={(patch) =>
            props.onUpdateConfig(node.node_key, patch)
          }
          onRemove={() => props.onRemove(node.node_key)}
          onSetEntry={() => props.onSetEntry(node.node_key)}
        />
      ))}
    </div>
  )
}

function ConnectorPath({ edge }: { edge: CanvasEdge }) {
  // Curva Bezier suave en horizontal: el control point está a 1/3 del
  // delta-X de cada lado. Se ve como "tubo" que respeta el sentido
  // izquierda→derecha del flujo.
  const dx = Math.max(40, (edge.to.x - edge.from.x) * 0.35)
  const d = `M ${edge.from.x} ${edge.from.y} C ${edge.from.x + dx} ${edge.from.y}, ${edge.to.x - dx} ${edge.to.y}, ${edge.to.x} ${edge.to.y}`
  return (
    <path
      d={d}
      fill="none"
      stroke="var(--border)"
      strokeWidth={1.5}
      strokeLinecap="round"
    />
  )
}

function ConnectorLabel({ edge }: { edge: CanvasEdge }) {
  // Midpoint del path. La curva Bezier no es exactamente el midpoint
  // geométrico, pero para una pastilla de etiqueta es suficiente — el
  // usuario lee "Sí / No / Mi pedido" sin necesidad de precisión sub-px.
  const midX = (edge.from.x + edge.to.x) / 2
  const midY = (edge.from.y + edge.to.y) / 2
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
      style={{ left: midX, top: midY }}
    >
      <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-foreground shadow-sm">
        {edge.label}
      </span>
    </div>
  )
}

interface DraggableNodeProps {
  node: BuilderNode
  allNodes: BuilderNode[]
  expanded: boolean
  isEntry: boolean
  isFlashed: boolean
  cardRef: (el: HTMLDivElement | null) => void
  issues: ValidationIssue[]
  onMove: (x: number, y: number) => void
  onToggle: () => void
  onUpdate: (patch: Partial<BuilderNode>) => void
  onUpdateConfig: (patch: Record<string, unknown>) => void
  onRemove: () => void
  onSetEntry: () => void
}

function DraggableNode(props: DraggableNodeProps) {
  const { scale } = useCanvasTransform()
  const [dragging, setDragging] = useState(false)
  const startRef = useRef<{
    mouseX: number
    mouseY: number
    nodeX: number
    nodeY: number
  } | null>(null)

  const onDragMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      // No iniciar drag si el click es sobre un control interactivo
      // (botón, input, select). El usuario está editando, no moviendo.
      const t = e.target as HTMLElement
      if (
        t.closest(
          'input, textarea, select, button, a, label, [role="combobox"], [role="button"], [role="textbox"], [contenteditable="true"]',
        )
      ) {
        return
      }
      e.preventDefault()
      e.stopPropagation()
      startRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        nodeX: props.node.position_x,
        nodeY: props.node.position_y,
      }
      setDragging(true)
    },
    [props.node.position_x, props.node.position_y],
  )

  useEffect(() => {
    if (!dragging) return
    function move(e: MouseEvent) {
      const s = startRef.current
      if (!s) return
      const dx = (e.clientX - s.mouseX) / scale
      const dy = (e.clientY - s.mouseY) / scale
      props.onMove(s.nodeX + dx, s.nodeY + dy)
    }
    function up() {
      startRef.current = null
      setDragging(false)
    }
    window.addEventListener("mousemove", move)
    window.addEventListener("mouseup", up)
    return () => {
      window.removeEventListener("mousemove", move)
      window.removeEventListener("mouseup", up)
    }
  }, [dragging, scale, props])

  return (
    <div
      className={cn(
        "absolute",
        dragging && "z-30 cursor-grabbing",
      )}
      style={{
        left: props.node.position_x,
        top: props.node.position_y,
        width: CARD_WIDTH,
      }}
      onMouseDown={onDragMouseDown}
    >
      <NodeCard
        node={props.node}
        allNodes={props.allNodes}
        expanded={props.expanded}
        isEntry={props.isEntry}
        isFlashed={props.isFlashed}
        cardRef={props.cardRef}
        issues={props.issues}
        onToggle={props.onToggle}
        onUpdate={props.onUpdate}
        onUpdateConfig={props.onUpdateConfig}
        onRemove={props.onRemove}
        onSetEntry={props.onSetEntry}
      />
    </div>
  )
}

function getOutgoingEdges(node: BuilderNode): OutgoingEdge[] {
  const cfg = node.config
  switch (node.node_type) {
    case "start":
    case "send_message":
    case "send_image":
    case "send_video":
    case "send_document":
    case "send_cta_url":
    case "collect_input":
    case "set_tag":
    case "wait": {
      const next = (cfg as { next_node_key?: string }).next_node_key ?? ""
      return [{ label: null, nextKey: next }]
    }
    case "send_buttons": {
      const btns = ((cfg as { buttons?: Array<{ reply_id?: string; title?: string; next_node_key?: string }> }).buttons) ?? []
      return btns.map((b) => ({
        label: b.title || b.reply_id || "Botón",
        nextKey: b.next_node_key ?? "",
      }))
    }
    case "send_list": {
      const sections = ((cfg as { sections?: Array<{ rows?: Array<{ reply_id?: string; title?: string; next_node_key?: string }> }> }).sections) ?? []
      return sections.flatMap((s) =>
        (s.rows ?? []).map((r) => ({
          label: r.title || r.reply_id || "Opción",
          nextKey: r.next_node_key ?? "",
        })),
      )
    }
    case "condition": {
      const c = cfg as { true_next?: string; false_next?: string }
      return [
        { label: "Sí", nextKey: c.true_next ?? "" },
        { label: "No", nextKey: c.false_next ?? "" },
      ]
    }
    case "ai_intent": {
      const c = cfg as {
        intents?: Array<{ intent_key?: string; next_node_key?: string }>
        fallback_next_key?: string
      }
      const out: OutgoingEdge[] = (c.intents ?? []).map((i) => ({
        label: i.intent_key || "Intención",
        nextKey: i.next_node_key ?? "",
      }))
      out.push({ label: "No entendí", nextKey: c.fallback_next_key ?? "" })
      return out
    }
    case "shopify_lookup": {
      const c = cfg as { found_next_key?: string; not_found_next_key?: string }
      return [
        { label: "Encontrado", nextKey: c.found_next_key ?? "" },
        { label: "No encontrado", nextKey: c.not_found_next_key ?? "" },
      ]
    }
    case "handoff":
    case "end":
      return []
  }
}

interface FlowTreeProps {
  entryKey: string | null
  allNodes: BuilderNode[]
  expanded: Set<string>
  entryNodeId: string | null
  flashedKey: string | null
  issues: ValidationIssue[]
  setNodeRef: (key: string) => (el: HTMLDivElement | null) => void
  onToggle: (key: string) => void
  onUpdate: (key: string, patch: Partial<BuilderNode>) => void
  onUpdateConfig: (key: string, patch: Record<string, unknown>) => void
  onMove: (key: string, x: number, y: number) => void
  onRemove: (key: string) => void
  onSetEntry: (key: string) => void
  onAdd: (type: NodeType) => void
  triggerType: BuilderState["trigger_type"]
  triggerConfig: Record<string, unknown>
  triggerIssues: ValidationIssue[]
  onTriggerChange: (
    type: BuilderState["trigger_type"],
    config: Record<string, unknown>,
  ) => void
}

/**
 * Paleta flotante anclada abajo-derecha del lienzo. Despliega los
 * tipos de paso para que el usuario agregue uno sin importar qué
 * parte del flujo está mirando. El nodo recién creado aparece a la
 * derecha de todos los demás (ver addNode) — listo para arrastrar a
 * la posición que el usuario quiera y conectarlo con "Avanza a".
 */
function FloatingAddPalette({ onAdd }: { onAdd: (type: NodeType) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex h-10 items-center gap-2 rounded-full border border-border bg-foreground px-4 text-sm font-medium text-background shadow-lg shadow-black/30 transition-all",
          "hover:opacity-90",
        )}
        aria-label="Agregar un paso al menú"
      >
        <Plus className="h-4 w-4" />
        Agregar paso
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-96 min-w-72 overflow-y-auto border-border bg-card"
      >
        <div className="border-b border-border px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          ¿Qué tipo de paso?
        </div>
        {ADDABLE_NODE_TYPES.map((t) => {
          const meta = NODE_META[t]
          return (
            <DropdownMenuItem key={t} onClick={() => onAdd(t)}>
              <meta.icon className={cn("h-3.5 w-3.5", meta.color)} />
              {meta.label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ============================================================
// Canvas trigger card — first tile in the flow tree
// ============================================================
// Renders the flow's trigger as the very first element on the canvas
// (same visual language as a NodeCard) so the user reads the trigger
// the same way they read every other step. The flow's trigger lives
// on the FLOW row, not as a node, so this card writes directly to
// flow.trigger_type / flow.trigger_config via the onChange prop.

const TRIGGER_TYPE_LABEL: Record<BuilderState["trigger_type"], string> = {
  keyword: "Cuando contiene una palabra clave",
  first_inbound_message: "Primer mensaje del cliente",
  manual: "Solo manual",
}

function CanvasTriggerCard({
  triggerType,
  triggerConfig,
  triggerIssues,
  onChange,
}: {
  triggerType: BuilderState["trigger_type"]
  triggerConfig: Record<string, unknown>
  triggerIssues: ValidationIssue[]
  onChange: (
    type: BuilderState["trigger_type"],
    config: Record<string, unknown>,
  ) => void
}) {
  const [open, setOpen] = useState(false)
  const hasError = triggerIssues.some((i) => i.severity === "error")
  const summary =
    triggerType === "keyword"
      ? Array.isArray(triggerConfig.keywords) && triggerConfig.keywords.length > 0
        ? (triggerConfig.keywords as string[]).join(", ")
        : null
      : null

  return (
    <div
      className={cn(
        "w-[260px] rounded-lg border bg-card",
        hasError ? "border-red-500/40" : "border-emerald-500/40",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-500/15">
          <Zap className="h-3.5 w-3.5 text-emerald-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">
              Cuándo dispara
            </span>
            {hasError && (
              <CircleAlert className="h-3 w-3 shrink-0 text-red-400" />
            )}
          </div>
          <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
            {TRIGGER_TYPE_LABEL[triggerType]}
            {summary ? ` · ${summary}` : ""}
          </p>
        </div>
      </button>
      {open && (
        <div className="space-y-3 border-t border-border px-3 py-3">
          <div>
            <label className="mb-1 block text-[11px] text-muted-foreground">
              Cuándo
            </label>
            <Select
              value={triggerType}
              onValueChange={(v) =>
                onChange(
                  v as BuilderState["trigger_type"],
                  v === "keyword" ? { keywords: [] } : {},
                )
              }
            >
              <SelectTrigger className="bg-muted text-sm">
                {/* Render the human label directly; Base UI's SelectValue
                    sometimes falls through to the raw `value` ("first_
                    inbound_message") in initial paint, which leaks tech
                    jargon into the UI. */}
                <span>{TRIGGER_TYPE_LABEL[triggerType]}</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="keyword">
                  Un mensaje contiene una palabra clave
                </SelectItem>
                <SelectItem value="first_inbound_message">
                  Primer mensaje del cliente
                </SelectItem>
                <SelectItem value="manual">Solo manual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {triggerType === "keyword" && (
            <div>
              <label className="mb-1 block text-[11px] text-muted-foreground">
                Palabras clave (separadas por coma)
              </label>
              <Input
                value={
                  Array.isArray(triggerConfig.keywords)
                    ? (triggerConfig.keywords as string[]).join(", ")
                    : ""
                }
                onChange={(e) =>
                  onChange(triggerType, {
                    ...triggerConfig,
                    keywords: e.target.value
                      .split(",")
                      .map((k) => k.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="soporte, ayuda, hola"
                className="bg-muted text-sm"
              />
            </div>
          )}
          {triggerIssues.length > 0 && (
            <div className="space-y-1">
              {triggerIssues.map((i, ix) => (
                <p
                  key={ix}
                  className={cn(
                    "text-[11px]",
                    i.severity === "error" ? "text-red-300" : "text-amber-300",
                  )}
                >
                  {i.message}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
