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

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  Copy,
  MessageCircle,
  Undo2,
  Redo2,
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
  MessageSquareReply,
  StickyNote,
  Search,
  Command,
  GitBranch,
  ChevronRight,
  MoreHorizontal,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import {
  reachableFromEntry,
  validateFlowForActivation,
  type ValidationIssue,
} from "@/lib/flows/validate";
import type { AiPatch } from "@/lib/flows/ai-patches";
import {
  CanvasViewport,
  useCanvasTransform,
  type CanvasViewportHandle,
} from "@/components/canvas/canvas-viewport";
import { WhatsappBubblePreview } from "@/components/flows/whatsapp-bubble-preview";
import { AiBuilderPanel } from "@/components/flows/ai-builder-panel";
import {
  CommandPalette,
  type CommandItem,
} from "@/components/flows/command-palette";
import { FlowVersionsDialog } from "@/components/flows/versions-dialog";
import { SimulatorPanel } from "@/components/flows/simulator-panel";
import type { FlowNodeRow, FlowRow } from "@/lib/flows/types";

interface FlowBuilderProps {
  initialFlow: FlowRow;
  initialNodes: FlowNodeRow[];
  /** Unsaved template preview: render the full canvas read-from-state, but
   *  the primary CTA becomes "Usar plantilla" (creates the flow from
   *  templateSlug and redirects to the real editor). All saved-id-dependent
   *  features (save/activate/delete/analytics/AI/command-palette/versions)
   *  are gated off so nothing hits /api/flows/<no-id>. */
  templatePreview?: boolean;
  templateSlug?: string;
}

/**
 * Acciones disponibles para los bubbles editables (los previews de
 * WhatsApp dentro de cada card). El bubble necesita pedirle al
 * FlowBuilder root cosas como "el usuario quiere borrar este botón —
 * preguntale qué hacer con los pasos que le siguen". Threading una
 * prop a través de 4 niveles era tedioso, así que va por contexto.
 *
 * Si el contexto no está presente (improbable, pero por seguridad),
 * el bubble se cae a la implementación in-line vieja (borrado directo
 * sin confirmación).
 */
interface FlowBubbleActions {
  /** Pide confirmación antes de borrar un botón de send_buttons. */
  requestRemoveButton: (parentKey: string, btnIdx: number) => void;
  /** Pide confirmación antes de borrar una fila de send_list. */
  requestRemoveRow: (
    parentKey: string,
    sectionIdx: number,
    rowIdx: number,
  ) => void;
  /**
   * Quick-add: agrega un nodo de `type` y lo wirea automáticamente al
   * port (parentKey, kind, idx) — la línea + ya viene conectada cuando
   * el botón se sueltía. Usado por el "+" al final de cada salida.
   */
  quickAdd: (
    parentKey: string,
    kind: "text" | "button" | "list_row" | "cta",
    idx: number,
    type: NodeType,
  ) => void;
}
const FlowBubbleActionsContext = createContext<FlowBubbleActions | null>(null);
function useFlowBubbleActions(): FlowBubbleActions | null {
  return useContext(FlowBubbleActionsContext);
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
  | "customer_reply"
  | "subflow"
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
  /**
   * Posición del disparador en el lienzo. Persistida en
   * flows.trigger_position_x/y (migration 028). El disparador NO es
   * un nodo (vive en la fila `flows`) pero se mueve igual que los
   * demás elementos del canvas.
   */
  trigger_position_x: number;
  trigger_position_y: number;
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
    color: "text-emerald-700 dark:text-emerald-400",
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
    color: "text-amber-600 dark:text-amber-400",
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
    color: "text-teal-700 dark:text-teal-400",
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
    color: "text-pink-600 dark:text-pink-400",
    bg: "bg-pink-500/15",
  },
  handoff: {
    label: "Pasar a un humano",
    icon: UserPlus,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/15",
  },
  send_image: {
    label: "Enviar imagen",
    icon: ImageIcon,
    color: "text-sky-600 dark:text-sky-400",
    bg: "bg-sky-500/15",
  },
  send_video: {
    label: "Enviar video",
    icon: Video,
    color: "text-sky-600 dark:text-sky-400",
    bg: "bg-sky-500/15",
  },
  send_document: {
    label: "Enviar documento",
    icon: FileText,
    color: "text-sky-600 dark:text-sky-400",
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
    color: "text-emerald-700 dark:text-emerald-400",
    bg: "bg-emerald-500/15",
  },
  customer_reply: {
    label: "Cliente responde",
    icon: MessageSquareReply,
    color: "text-sky-600 dark:text-sky-400",
    bg: "bg-sky-500/15",
  },
  subflow: {
    label: "Subflujo",
    icon: Workflow,
    color: "text-indigo-600 dark:text-indigo-400",
    bg: "bg-indigo-500/15",
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
            : cfg.operator === "not_contains"
              ? "no contiene"
              : cfg.operator === "regex_match"
                ? "regex"
                : cfg.operator === "present"
                  ? "existe"
                  : cfg.operator === "absent"
                    ? "no existe"
                    : "";
      const value = typeof cfg.value === "string" ? cfg.value : "";
      const valStr =
        (cfg.operator === "equals" ||
          cfg.operator === "contains" ||
          cfg.operator === "not_contains" ||
          cfg.operator === "regex_match") &&
        value
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
    case "customer_reply":
      return "Esperando respuesta del cliente";
    case "subflow": {
      const id = String(cfg.sub_flow_id ?? "");
      return id ? `Subflujo ${id.slice(0, 8)}…` : "Sin flujo elegido";
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
    case "customer_reply":
      return { next_node_key: "" };
    case "subflow":
      return { sub_flow_id: "", next_node_key: "" };
    case "end":
      return {};
  }
}

// ============================================================
// Root component
// ============================================================

export function FlowBuilder({
  initialFlow,
  initialNodes,
  templatePreview = false,
  templateSlug,
}: FlowBuilderProps) {
  const router = useRouter();
  const fetchWithCsrf = useFetchWithCsrf();

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
    // Default 80/240 — mismo lugar donde estaba el disparador hard-codeado
    // antes. Flujos viejos sin estas columnas reciben el default del DB.
    trigger_position_x:
      typeof initialFlow.trigger_position_x === 'number'
        ? initialFlow.trigger_position_x
        : TRIGGER_POS.x,
    trigger_position_y:
      typeof initialFlow.trigger_position_y === 'number'
        ? initialFlow.trigger_position_y
        : TRIGGER_POS.y,
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

  // ── Undo / redo ──
  // Stacks viven en refs (no re-render). canUndo/canRedo en state para
  // habilitar/deshabilitar los botones del header. 50 entries de cap.
  //
  // El flujo de undo/redo NO usa flags + setTimeout (eso tiene una race
  // con useEffects que reescriban en respuesta al state restore). En su
  // lugar usamos un único `commit(updater, {record})` que decide si
  // pushear o no. Undo/redo llaman commit con record:false; las demás
  // mutaciones (setStateDirty) lo llaman con record:true.
  const undoStackRef = useRef<BuilderState[]>([]);
  const redoStackRef = useRef<BuilderState[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  // Última "categoría" de edición pusheada al stack: usamos un nombre
  // tipo "config:<nodeKey>:<field>" para coalescer keystrokes
  // consecutivos al mismo field/nodo en un único entry. Cambiar a
  // null/otra categoría rompe la coalescing.
  const lastCoalesceKeyRef = useRef<string | null>(null);

  /**
   * commit: única vía para mutar state. record:true (default) pushea
   * el estado PREVIO al undo stack; record:false NO pushea — usado
   * por undo/redo. coalesceKey permite que mutaciones consecutivas con
   * la misma key (típicamente keystrokes en la misma textarea) se
   * fundan en un solo entry de historia.
   */
  const commit = useCallback(
    (
      updater: (s: BuilderState) => BuilderState,
      options?: { record?: boolean; coalesceKey?: string | null },
    ) => {
      const record = options?.record !== false;
      const coalesceKey = options?.coalesceKey ?? null;
      setDirty(true);
      setState((current) => {
        const next = updater(current);
        if (record) {
          const shouldCoalesce =
            coalesceKey !== null &&
            coalesceKey === lastCoalesceKeyRef.current &&
            undoStackRef.current.length > 0;
          if (!shouldCoalesce) {
            undoStackRef.current = [
              ...undoStackRef.current.slice(-49),
              current,
            ];
          }
          lastCoalesceKeyRef.current = coalesceKey;
          redoStackRef.current = [];
          setCanUndo(true);
          setCanRedo(false);
        }
        return next;
      });
    },
    [],
  );

  /**
   * setStateDirty: wrapper que reescribe la firma React.SetStateAction
   * sobre commit(). Cualquier mutación de UI (addNode, updateConfig,
   * eliminar, etc.) la usa. Cada llamada rompe la coalescing (porque
   * coalesceKey queda null, distinto del último).
   */
  const setStateDirty = useCallback<typeof setState>(
    (updaterOrValue) => {
      const updater =
        typeof updaterOrValue === "function"
          ? (updaterOrValue as (s: BuilderState) => BuilderState)
          : (() => updaterOrValue);
      commit(updater);
      // Cualquier edición esconde el panel de errores. Reaparece solo
      // cuando el usuario vuelve a pulsar Guardar. Mientras está
      // construyendo, las líneas rojas son ruido.
      setShowValidation(false);
    },
    [commit],
  );

  /** Snapshot manual del estado actual — usado al inicio de un drag
   *  para que undo restaure la posición previa. Rompe la coalescing. */
  const snapshotHistory = useCallback(() => {
    undoStackRef.current = [
      ...undoStackRef.current.slice(-49),
      state,
    ];
    redoStackRef.current = [];
    lastCoalesceKeyRef.current = null;
    setCanUndo(true);
    setCanRedo(false);
  }, [state]);

  // ConnectingRef es declarado más abajo (en FlowCanvas), pero el
  // handleUndo lo necesita para bloquear undo durante drag-to-connect.
  // Usamos un ref a nivel FlowBuilder que FlowCanvas escribe.
  const connectingActiveRef = useRef(false);

  const handleUndo = useCallback(() => {
    if (connectingActiveRef.current) return; // no undo a mitad de un drag
    if (undoStackRef.current.length === 0) return;
    const prev = undoStackRef.current[undoStackRef.current.length - 1];
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    // commit con record:false NO pushea prev a undoStack; en su lugar
    // pusheamos el `current` al redoStack adentro del updater para
    // poder hacerlo después de calcular `next`.
    commit(
      (current) => {
        redoStackRef.current = [...redoStackRef.current, current];
        return prev;
      },
      { record: false },
    );
    lastCoalesceKeyRef.current = null;
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(true);
  }, [commit]);

  const handleRedo = useCallback(() => {
    if (connectingActiveRef.current) return;
    if (redoStackRef.current.length === 0) return;
    const next = redoStackRef.current[redoStackRef.current.length - 1];
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    commit(
      (current) => {
        undoStackRef.current = [...undoStackRef.current, current];
        return next;
      },
      { record: false },
    );
    lastCoalesceKeyRef.current = null;
    setCanUndo(true);
    setCanRedo(redoStackRef.current.length > 0);
  }, [commit]);

  // Atajo Ctrl/Cmd+Z (undo) y Ctrl/Cmd+Shift+Z (redo). Ignoramos si el
  // foco está en un input/textarea/contenteditable — el usuario quiere
  // deshacer el typing, no el flow state. También bloqueamos si hay
  // una conexión drag activa para evitar corrupción del redo stack.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() !== "z") return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        if (target.isContentEditable) return;
      }
      e.preventDefault();
      if (e.shiftKey) handleRedo();
      else handleUndo();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleUndo, handleRedo]);

  // Used by jumpToNode() to scroll the target into view + flash its border.
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [flashedKey, setFlashedKey] = useState<string | null>(null);

  // Selección múltiple de nodos: Shift+click sobre un card lo agrega
  // o quita del set; click en lienzo vacío lo limpia. Cuando hay 1+
  // nodos seleccionados, Delete borra todos a la vez. Cmd/Ctrl+C
  // copia los configs al portapapeles interno; Cmd/Ctrl+V los pega
  // como nodos nuevos a la derecha del flujo.
  const [selectedNodeKeys, setSelectedNodeKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const clipboardRef = useRef<BuilderNode[] | null>(null);

  const toggleNodeSelection = useCallback((key: string, additive: boolean) => {
    setSelectedNodeKeys((prev) => {
      const next = new Set(additive ? prev : []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clearNodeSelection = useCallback(() => {
    setSelectedNodeKeys((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  // Browser-level reload / tab-close / external-link guard. SPA
  // navigation (sidebar links, back button) isn't covered here — Next 16
  // routes through the App Router and beforeunload doesn't fire on
  // client-side route changes. That's a follow-up; this catches the
  // accidental refresh / closed-window class of data loss.
  useEffect(() => {
    // No data-loss prompt in template preview — nothing is persisted until
    // "Usar plantilla", so closing the tab loses nothing.
    if (!dirty || templatePreview) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore the return value but require something
      // truthy to actually show the native prompt.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, templatePreview]);

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

  /**
   * Linter visual EN VIVO (independiente del gate showValidation):
   *   - `unreachable`: nodos que existen pero no se alcanzan desde el
   *     entry. Halo amarillo punteado en el card.
   *   - `nodesWithError`: cualquier nodo con al menos un error de
   *     severity="error". Punto rojo chico en la esquina del card.
   *
   * No reemplaza al panel inferior — la idea es dar una señal sutil
   * mientras se construye sin meter el ruido completo del panel.
   */
  const liveLinter = useMemo(() => {
    const unreachable = new Set<string>();
    if (state.entry_node_id) {
      const reached = reachableFromEntry(state.entry_node_id, state.nodes);
      for (const n of state.nodes) {
        if (!reached.has(n.node_key)) unreachable.add(n.node_key);
      }
    } else {
      // Sin entry, todos quedan "sueltos" visualmente excepto el primero
      // (que el auto-entry-on-create-first hace que casi nunca ocurra).
      for (const n of state.nodes) unreachable.add(n.node_key);
    }
    const nodesWithError = new Set<string>();
    for (const i of issues) {
      if (i.severity === "error" && i.scope === "node" && i.node_key) {
        nodesWithError.add(i.node_key);
      }
    }
    return { unreachable, nodesWithError };
  }, [state.nodes, state.entry_node_id, issues]);

  // Los errores en el lienzo (borde rojo + panel inferior) no se
  // muestran mientras el usuario arma el flujo. Aparecen solo cuando
  // intenta guardar — y se ocultan cuando el flujo queda limpio.
  const [showValidation, setShowValidation] = useState(false);
  // Command palette Cmd/Ctrl+K. Mantenemos open en state local del
  // FlowBuilder (no FlowCanvas) para que las acciones puedan llamar
  // setState directamente sin threading.
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Simulador del flujo dentro del canvas. Sidepanel.
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  // Historial de versiones (dialog) y overlay de analítica por nodo.
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [analyticsOn, setAnalyticsOn] = useState(false);
  const [analytics, setAnalytics] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!analyticsOn || templatePreview) return;
    let cancelled = false;
    fetch(`/api/flows/${initialFlow.id}/node-analytics?days=7`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { by_node?: Record<string, number> } | null) => {
        if (!cancelled) setAnalytics(d?.by_node ?? {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [analyticsOn, initialFlow.id, templatePreview]);
  const visibleIssues: ValidationIssue[] = showValidation ? issues : [];

  // ---- Save (PUT) ----
  const handleSave = useCallback(async () => {
    setSaving(true);
    // Al pulsar Guardar, los errores quedan visibles si los hay; si el
    // estado terminó sin errores, ocultamos el panel de nuevo al final.
    setShowValidation(true);
    try {
      // Template preview: the CTA is "Usar plantilla" — create the real flow
      // from the template slug, then land in the live editor. Never PUTs to a
      // non-existent id.
      if (templatePreview) {
        if (!templateSlug) {
          toast.error("Falta la plantilla.");
          return;
        }
        const res = await fetchWithCsrf("/api/flows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ template_slug: templateSlug }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.flow?.id) {
          throw new Error(json.error ?? `No se pudo usar la plantilla (${res.status})`);
        }
        toast.success("Plantilla agregada.");
        router.push(`/menus/${json.flow.id}`);
        return;
      }
      const res = await fetchWithCsrf(`/api/flows/${initialFlow.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: state.name,
          description: state.description || null,
          trigger_type: state.trigger_type,
          trigger_config: state.trigger_config,
          entry_node_id: state.entry_node_id,
          trigger_position_x: state.trigger_position_x,
          trigger_position_y: state.trigger_position_y,
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
      // Si después del save no quedan errores, ocultamos el panel
      // de nuevo — el flujo está limpio, no hace falta el ruido.
      if (canActivate) setShowValidation(false);
      toast.success("Guardado.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo guardar";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }, [initialFlow.id, state, canActivate, fetchWithCsrf, templatePreview, templateSlug, router]);

  // ---- Activate / Pause / Archive ----
  const handleStatus = useCallback(
    async (next: BuilderState["status"]) => {
      if (templatePreview) return; // no status changes in preview
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
        const res = await fetchWithCsrf(`/api/flows/${initialFlow.id}/activate`, {
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
    [templatePreview, canActivate, handleSave, initialFlow.id, fetchWithCsrf],
  );

  // ---- Delete ----
  const handleDelete = useCallback(async () => {
    if (templatePreview) return;
    const yes = window.confirm(`¿Eliminar "${state.name}"?`);
    if (!yes) return;
    try {
      const res = await fetchWithCsrf(`/api/flows/${initialFlow.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      router.push("/menus");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo eliminar";
      toast.error(msg);
    }
  }, [templatePreview, initialFlow.id, router, state.name, fetchWithCsrf]);

  // ---- Node helpers ----
  // `silenced` set + `unsilence` están declarados más abajo; las
  // referenciamos en updateNode/updateNodeConfig via closure. Para
  // mantener las dependencias correctas pasamos `unsilenceFn` por
  // ref-like — useCallback no nos deja referenciar identificadores
  // todavía no declarados, así que usamos un wrapper indirecto.
  const updateNode = useCallback(
    (key: string, patch: Partial<BuilderNode>) => {
      setStateDirty((s) => ({
        ...s,
        nodes: s.nodes.map((n) => (n.node_key === key ? { ...n, ...patch } : n)),
      }));
      setSilenced((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    },
    [setStateDirty],
  );

  /**
   * Set of node_keys cuyos errores de validación están "silenciados"
   * por ser recién creados. Apenas el usuario edita cualquier campo del
   * nodo (updateNode / updateNodeConfig), lo sacamos del set y los
   * errores vuelven a aparecer. Evita que al arrastrar "Enviar video" a
   * la lona te aparezcan 3 chips rojos antes de tocar nada.
   */
  const [silenced, setSilenced] = useState<Set<string>>(() => new Set());
  const unsilence = useCallback((key: string) => {
    setSilenced((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  /**
   * updateNodeConfig: aplica un patch al config de un nodo.
   *
   * Coalescing: cuando el patch toca un único campo de texto (text,
   * caption, prompt_text, button_label, value, note, output_prefix,
   * filename, url), todos los keystrokes consecutivos al MISMO nodo +
   * MISMO campo se funden en una sola entrada del undo stack. Sin
   * esto, tipear "Mi pedido" llena 9/50 slots del stack y rompe
   * cualquier undo estructural previo.
   */
  const updateNodeConfig = useCallback(
    (key: string, configPatch: Record<string, unknown>) => {
      const patchKeys = Object.keys(configPatch);
      const COALESCE_FIELDS = new Set([
        "text",
        "caption",
        "prompt_text",
        "button_label",
        "value",
        "note",
        "output_prefix",
        "filename",
        "url",
        "button_title",
      ]);
      const coalesceKey =
        patchKeys.length === 1 && COALESCE_FIELDS.has(patchKeys[0])
          ? `field:${key}:${patchKeys[0]}`
          : null;
      commit(
        (s) => ({
          ...s,
          nodes: s.nodes.map((n) =>
            n.node_key === key
              ? { ...n, config: { ...n.config, ...configPatch } }
              : n,
          ),
        }),
        { coalesceKey },
      );
      unsilence(key);
    },
    [commit, unsilence],
  );

  /**
   * Agrega un nodo al lienzo. Si se pasa `wireFrom`, además wirea el
   * port indicado del padre al nodo recién creado — usado por los
   * botones de quick-add que están al final de cada nodo: con un solo
   * click el merchant agrega el siguiente paso y queda ya conectado.
   */
  const addNode = useCallback(
    (
      type: NodeType,
      wireFrom?: {
        parentKey: string;
        kind: "text" | "button" | "list_row" | "cta";
        idx: number;
      },
    ) => {
      const meta = NODE_META[type];
      const base = slugify(meta.label, type);
      setStateDirty((s) => {
        const node_key = uniqueNodeKey(base, s.nodes);
        // Si viene de un quick-add, posicionar a la derecha del padre
        // (no del nodo más a la derecha del lienzo) — así el wire es
        // visualmente corto y entendible.
        const parent = wireFrom
          ? s.nodes.find((n) => n.node_key === wireFrom.parentKey)
          : undefined;
        const fallbackX = s.nodes.reduce(
          (m, n) => Math.max(m, n.position_x),
          TRIGGER_POS.x + CARD_WIDTH + 80,
        );
        const baseX = parent ? parent.position_x : fallbackX;
        const baseY = parent ? parent.position_y : TRIGGER_POS.y;
        const next: BuilderNode = {
          node_key,
          node_type: type,
          config: defaultConfigFor(type),
          position_x: baseX + CARD_GAP_X,
          position_y: baseY,
        };
        // Auto-insert "Cliente responde" después de un send_message.
        // Si el usuario no quiere la pausa, borra el customer_reply.
        const needsReplyWait = type === "send_message";
        let nextNodes: BuilderNode[] = [...s.nodes, next];
        const newExpanded = new Set([node_key]);
        const newSilenced = new Set([node_key]);
        if (needsReplyWait) {
          const replyKey = uniqueNodeKey("cliente_responde", nextNodes);
          const replyNode: BuilderNode = {
            node_key: replyKey,
            node_type: "customer_reply",
            config: { next_node_key: "" },
            position_x: next.position_x + CARD_GAP_X,
            position_y: next.position_y,
          };
          nextNodes = [...nextNodes, replyNode];
          newExpanded.add(replyKey);
          newSilenced.add(replyKey);
          (next.config as { next_node_key?: string }).next_node_key = replyKey;
        }
        // Wire desde el padre (quick-add) al nodo nuevo. Reusa la
        // mecánica de wireConnection inline para no pasar por otra
        // mutación de estado.
        if (wireFrom) {
          nextNodes = nextNodes.map((n) => {
            if (n.node_key !== wireFrom.parentKey) return n;
            const cfg = n.config as Record<string, unknown>;
            switch (wireFrom.kind) {
              case "text":
                return { ...n, config: { ...cfg, next_node_key: node_key } };
              case "button": {
                const btns = Array.isArray(cfg.buttons)
                  ? (cfg.buttons as Array<{
                      reply_id?: string;
                      title?: string;
                      next_node_key?: string;
                    }>)
                  : [];
                if (wireFrom.idx < 0 || wireFrom.idx >= btns.length) return n;
                return {
                  ...n,
                  config: {
                    ...cfg,
                    buttons: btns.map((b, i) =>
                      i === wireFrom.idx ? { ...b, next_node_key: node_key } : b,
                    ),
                  },
                };
              }
              case "list_row": {
                const sections = Array.isArray(cfg.sections)
                  ? (cfg.sections as Array<{
                      title?: string;
                      rows?: Array<{ next_node_key?: string }>;
                    }>)
                  : [];
                let rem = wireFrom.idx;
                const nextSections = sections.map((sec) => {
                  const rows = sec.rows ?? [];
                  if (rem < 0) return sec;
                  if (rem < rows.length) {
                    const ri = rem;
                    rem = -1;
                    return {
                      ...sec,
                      rows: rows.map((r, i) =>
                        i === ri ? { ...r, next_node_key: node_key } : r,
                      ),
                    };
                  }
                  rem -= rows.length;
                  return sec;
                });
                return { ...n, config: { ...cfg, sections: nextSections } };
              }
              case "cta":
                return { ...n, config: { ...cfg, next_node_key: node_key } };
            }
            return n;
          });
        }
        setExpanded((prev) => new Set([...prev, ...newExpanded]));
        setSilenced((prev) => new Set([...prev, ...newSilenced]));
        return {
          ...s,
          nodes: nextNodes,
          entry_node_id: s.entry_node_id ?? (s.nodes.length === 0 ? node_key : null),
        };
      });
    },
    [setStateDirty],
  );

  /**
   * Duplicate an existing node — copia su config, le pone un node_key
   * nuevo y lo deja a la derecha + abajo del original. Las aristas que
   * salen del original NO se copian (next_node_key del original queda;
   * el nuevo arranca sin conexión saliente).
   */
  const duplicateNode = useCallback(
    (key: string) => {
      setStateDirty((s) => {
        const src = s.nodes.find((n) => n.node_key === key);
        if (!src) return s;
        const base = `${src.node_key}_copia`;
        const new_key = uniqueNodeKey(base, s.nodes);
        const clone: BuilderNode = {
          node_key: new_key,
          node_type: src.node_type,
          // Deep-copy de config para que editar el clon no toque al
          // original — JSON parse/stringify alcanza para nuestros configs
          // (sin functions, sin Dates, sin circulars).
          config: JSON.parse(JSON.stringify(src.config)) as Record<string, unknown>,
          position_x: src.position_x + 40,
          position_y: src.position_y + 60,
        };
        setExpanded((prev) => new Set([...prev, new_key]));
        setSilenced((prev) => new Set([...prev, new_key]));
        return { ...s, nodes: [...s.nodes, clone] };
      });
    },
    [setStateDirty],
  );

  /**
   * Move a node to a new position. Called from the canvas drag handler.
   *
   * NO va por setStateDirty: el drag dispara ~60 onMove por segundo y
   * pushearíamos 60 entries al undo stack por cada segundo arrastrado,
   * inutilizando el undo. El snapshot del estado pre-drag lo toma
   * `snapshotHistory()` (llamado desde onDragStart en DraggableNode).
   */
  const moveNode = useCallback(
    (key: string, x: number, y: number) => {
      setDirty(true);
      setState((s) => ({
        ...s,
        nodes: s.nodes.map((n) =>
          n.node_key === key ? { ...n, position_x: x, position_y: y } : n,
        ),
      }));
    },
    [],
  );

  /**
   * Move el disparador. Mismo razonamiento que `moveNode` — no pasa por
   * el undo stack porque el drag genera 60 mutaciones/seg; el snapshot
   * pre-drag lo toma `onDragStart` antes del primer move.
   */
  const moveTrigger = useCallback((x: number, y: number) => {
    setDirty(true);
    setState((s) => ({ ...s, trigger_position_x: x, trigger_position_y: y }));
  }, []);

  /**
   * Aplica una lista de patches que devolvió el endpoint /assist.
   * Un solo commit() = un solo push del undo stack: Ctrl+Z reverte
   * todo el turn de chat, no patch por patch.
   *
   * Se hace en orden, así un wire puede referirse a un node_key
   * recién agregado en el mismo batch. add_node sin posición lo
   * coloca a la derecha del más a la derecha (como addNode manual).
   */
  const applyAiPatches = useCallback((patches: AiPatch[]) => {
    if (patches.length === 0) return;
    commit(
      (state) => {
        let next: BuilderState = state;
        const allNodesNow = () => next.nodes;
        for (const p of patches) {
          switch (p.kind) {
            case "add_node": {
              // Si ya existe ese node_key, saltamos — la IA pidió algo
              // duplicado y mejor no romper un nodo existente.
              if (allNodesNow().some((n) => n.node_key === p.node_key)) break;
              const pos =
                p.position ?? {
                  x: allNodesNow().reduce(
                    (m, n) => Math.max(m, n.position_x),
                    next.trigger_position_x + TRIGGER_WIDTH + 80,
                  ) + 280,
                  y: next.trigger_position_y,
                };
              const newNode: BuilderNode = {
                node_key: p.node_key,
                node_type: p.node_type as NodeType,
                config: p.config,
                position_x: pos.x,
                position_y: pos.y,
              };
              next = {
                ...next,
                nodes: [...next.nodes, newNode],
                // Si el flujo no tenía entry todavía (flujo vacío o
                // estado degradado), el primer add_node del turn se
                // convierte en el entry. Después de eso, entry_node_id
                // ya no es null y los siguientes add_node no lo cambian.
                entry_node_id: next.entry_node_id ?? p.node_key,
              };
              break;
            }
            case "remove_node": {
              next = {
                ...next,
                nodes: next.nodes.filter((n) => n.node_key !== p.node_key),
                entry_node_id:
                  next.entry_node_id === p.node_key
                    ? null
                    : next.entry_node_id,
              };
              break;
            }
            case "update_node_config": {
              next = {
                ...next,
                nodes: next.nodes.map((n) =>
                  n.node_key === p.node_key
                    ? {
                        ...n,
                        config: {
                          ...(n.config as Record<string, unknown>),
                          ...p.config_patch,
                        },
                      }
                    : n,
                ),
              };
              break;
            }
            case "move_node": {
              next = {
                ...next,
                nodes: next.nodes.map((n) =>
                  n.node_key === p.node_key
                    ? { ...n, position_x: p.position.x, position_y: p.position.y }
                    : n,
                ),
              };
              break;
            }
            case "wire": {
              next = {
                ...next,
                nodes: next.nodes.map((n) => {
                  if (n.node_key !== p.from_node_key) return n;
                  const cfg = n.config as Record<string, unknown>;
                  const idx = p.port_index ?? 0;
                  switch (p.kind_of_port) {
                    case "text":
                      return {
                        ...n,
                        config: { ...cfg, next_node_key: p.to_node_key },
                      };
                    case "button": {
                      const btns = Array.isArray(cfg.buttons)
                        ? (cfg.buttons as Array<{
                            reply_id?: string;
                            title?: string;
                            next_node_key?: string;
                          }>)
                        : [];
                      if (idx < 0 || idx >= btns.length) return n;
                      const nextBtns = btns.map((b, i) =>
                        i === idx ? { ...b, next_node_key: p.to_node_key } : b,
                      );
                      return { ...n, config: { ...cfg, buttons: nextBtns } };
                    }
                    case "list_row": {
                      const sections = Array.isArray(cfg.sections)
                        ? (cfg.sections as Array<{
                            title?: string;
                            rows?: Array<{
                              reply_id?: string;
                              title?: string;
                              description?: string;
                              next_node_key?: string;
                            }>;
                          }>)
                        : [];
                      // idx plano → (si, ri)
                      let remaining = idx;
                      const nextSections = sections.map((sec) => {
                        const rows = sec.rows ?? [];
                        if (remaining < 0) return sec;
                        if (remaining < rows.length) {
                          const ri = remaining;
                          remaining = -1;
                          return {
                            ...sec,
                            rows: rows.map((r, i) =>
                              i === ri ? { ...r, next_node_key: p.to_node_key } : r,
                            ),
                          };
                        }
                        remaining -= rows.length;
                        return sec;
                      });
                      return { ...n, config: { ...cfg, sections: nextSections } };
                    }
                    case "true_branch":
                      return { ...n, config: { ...cfg, true_next: p.to_node_key } };
                    case "false_branch":
                      return { ...n, config: { ...cfg, false_next: p.to_node_key } };
                    case "found_branch":
                      return {
                        ...n,
                        config: { ...cfg, found_next_key: p.to_node_key },
                      };
                    case "not_found_branch":
                      return {
                        ...n,
                        config: { ...cfg, not_found_next_key: p.to_node_key },
                      };
                    case "intent": {
                      const intents = Array.isArray(cfg.intents)
                        ? (cfg.intents as Array<{
                            intent_key?: string;
                            description?: string;
                            next_node_key?: string;
                          }>)
                        : [];
                      if (idx < 0 || idx >= intents.length) return n;
                      const nextI = intents.map((it, i) =>
                        i === idx ? { ...it, next_node_key: p.to_node_key } : it,
                      );
                      return { ...n, config: { ...cfg, intents: nextI } };
                    }
                    case "intent_fallback":
                      return {
                        ...n,
                        config: { ...cfg, fallback_next_key: p.to_node_key },
                      };
                  }
                  return n;
                }),
              };
              break;
            }
            case "set_entry": {
              if (allNodesNow().some((n) => n.node_key === p.node_key)) {
                next = { ...next, entry_node_id: p.node_key };
              }
              break;
            }
            case "set_trigger": {
              next = {
                ...next,
                trigger_type: p.trigger_type,
                trigger_config: p.trigger_config,
              };
              break;
            }
          }
        }
        return next;
      },
      { record: true, coalesceKey: null },
    );
    // El panel pasa la lista de nuevos node_keys para expandirlos por
    // defecto (así el usuario ve el contenido recién creado). Lo
    // hacemos acá: derivamos add_node patches y los expandimos.
    const newKeys = patches
      .filter(
        (p): p is Extract<AiPatch, { kind: "add_node" }> => p.kind === "add_node",
      )
      .map((p) => p.node_key);
    if (newKeys.length > 0) {
      setExpanded((prev) => new Set([...prev, ...newKeys]));
    }
  }, [commit]);

  /**
   * Bounding box real del flujo en el lienzo — alimenta al
   * fit-to-view del CanvasViewport. El lienzo es un div virtual de
   * 6000x4000 (ver CANVAS_W/H), así que scrollWidth devuelve 6000
   * aunque el flujo viva en una esquina; calcular la bbox de los
   * objetos visibles (trigger + nodos) hace que "centrar" se ajuste
   * al contenido real.
   *
   * Altura de card estimada: el bubble preview + el header ronda los
   * 360px en colapsado; aproximación suficiente para que el fit no
   * recorte la última fila.
   */
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const computeContentBounds = useCallback(() => {
    const s = stateRef.current;
    const CARD_HEIGHT_ESTIMATE = 360;
    let minX = s.trigger_position_x;
    let minY = s.trigger_position_y;
    let maxX = s.trigger_position_x + TRIGGER_WIDTH;
    let maxY = s.trigger_position_y + CARD_HEIGHT_ESTIMATE;
    for (const n of s.nodes) {
      if (n.position_x < minX) minX = n.position_x;
      if (n.position_y < minY) minY = n.position_y;
      const rx = n.position_x + CARD_WIDTH;
      const ry = n.position_y + CARD_HEIGHT_ESTIMATE;
      if (rx > maxX) maxX = rx;
      if (ry > maxY) maxY = ry;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }, []);

  /**
   * Reordena los nodos en columnas BFS desde el entry. Usado por el
   * botón "Auto-organizar" de la barra de zoom. Un solo commit al
   * undo stack para que Ctrl+Z reverte el layout entero si al merchant
   * no le gusta.
   */
  const handleAutoLayout = useCallback(() => {
    setStateDirty((s) => {
      if (s.nodes.length === 0) return s;
      const layouted = autoLayout(s.nodes, s.entry_node_id);
      return {
        ...s,
        nodes: s.nodes.map((n) => {
          const pos = layouted.get(n.node_key);
          return pos ? { ...n, position_x: pos.x, position_y: pos.y } : n;
        }),
      };
    });
    toast.success("Nodos reordenados");
  }, [setStateDirty]);

  /**
   * Wire una conexión: el usuario soltó el drag del port (kind, idx) en
   * un nodo destino. Mapeamos kind+idx → la propiedad correcta del
   * config y actualizamos.
   */
  const wireConnection = useCallback(
    (
      fromKey: string,
      kind: "button" | "list_row" | "cta" | "text",
      idx: number,
      toKey: string,
    ) => {
      setStateDirty((s) => ({
        ...s,
        nodes: s.nodes.map((n) => {
          if (n.node_key !== fromKey) return n;
          const cfg = n.config as Record<string, unknown>;
          switch (n.node_type) {
            case "send_buttons": {
              const buttons = Array.isArray(cfg.buttons)
                ? (cfg.buttons as Array<{
                    reply_id?: string;
                    title?: string;
                    next_node_key?: string;
                  }>)
                : [];
              if (idx < 0 || idx >= buttons.length) return n;
              const nextBtns = buttons.map((b, i) =>
                i === idx ? { ...b, next_node_key: toKey } : b,
              );
              return { ...n, config: { ...cfg, buttons: nextBtns } };
            }
            case "send_list": {
              const sections = Array.isArray(cfg.sections)
                ? (cfg.sections as Array<{
                    title?: string;
                    rows?: Array<{
                      reply_id?: string;
                      title?: string;
                      description?: string;
                      next_node_key?: string;
                    }>;
                  }>)
                : [];
              // Localizar la sección+row para `idx` sin aplanar. Esto
              // preserva títulos de secciones múltiples (Meta soporta
              // hasta 10 secciones); aplanar y reescribir como una sola
              // sección descartaría sections[1..].title silenciosamente.
              let remaining = idx;
              let targetSection = -1;
              let targetRow = -1;
              for (let i = 0; i < sections.length; i++) {
                const len = sections[i].rows?.length ?? 0;
                if (remaining < len) {
                  targetSection = i;
                  targetRow = remaining;
                  break;
                }
                remaining -= len;
              }
              if (targetSection < 0) return n; // idx fuera de rango
              const nextSections = sections.map((sec, sIdx) =>
                sIdx !== targetSection
                  ? sec
                  : {
                      ...sec,
                      rows: (sec.rows ?? []).map((r, rIdx) =>
                        rIdx !== targetRow
                          ? r
                          : { ...r, next_node_key: toKey },
                      ),
                    },
              );
              return { ...n, config: { ...cfg, sections: nextSections } };
            }
            // Tipos con UNA sola salida: next_node_key directo.
            case "send_message":
            case "send_image":
            case "send_video":
            case "send_document":
            case "send_cta_url":
            case "collect_input":
            case "set_tag":
            case "wait":
            case "start":
              return { ...n, config: { ...cfg, next_node_key: toKey } };
            // Condition: 2 salidas (true / false) — kind="text" idx 0/1.
            case "condition":
              if (kind === "text" && idx === 0)
                return { ...n, config: { ...cfg, true_next: toKey } };
              if (kind === "text" && idx === 1)
                return { ...n, config: { ...cfg, false_next: toKey } };
              return n;
            // Shopify lookup: found / not_found.
            case "shopify_lookup":
              if (kind === "text" && idx === 0)
                return { ...n, config: { ...cfg, found_next_key: toKey } };
              if (kind === "text" && idx === 1)
                return {
                  ...n,
                  config: { ...cfg, not_found_next_key: toKey },
                };
              return n;
            // ai_intent: N intents + fallback (idx N).
            case "ai_intent": {
              const intents = Array.isArray(cfg.intents)
                ? (cfg.intents as Array<{
                    intent_key?: string;
                    next_node_key?: string;
                  }>)
                : [];
              if (idx < intents.length) {
                const nextIntents = intents.map((it, i) =>
                  i === idx ? { ...it, next_node_key: toKey } : it,
                );
                return { ...n, config: { ...cfg, intents: nextIntents } };
              }
              if (idx === intents.length) {
                return { ...n, config: { ...cfg, fallback_next_key: toKey } };
              }
              return n;
            }
            default:
              return n;
          }
        }),
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

  /**
   * Borra todos los nodos en `selectedNodeKeys` en un solo commit del
   * undo stack. Usado por la tecla Delete cuando hay 2+ nodos
   * seleccionados con Shift+click.
   */
  const removeSelectedNodes = useCallback(() => {
    if (selectedNodeKeys.size === 0) return;
    const keysToRemove = new Set(selectedNodeKeys);
    setStateDirty((s) => ({
      ...s,
      nodes: s.nodes.filter((n) => !keysToRemove.has(n.node_key)),
      entry_node_id:
        s.entry_node_id && keysToRemove.has(s.entry_node_id)
          ? null
          : s.entry_node_id,
    }));
    setExpanded((prev) => {
      const next = new Set(prev);
      keysToRemove.forEach((k) => next.delete(k));
      return next;
    });
    clearNodeSelection();
    toast.success(
      keysToRemove.size === 1
        ? "Paso eliminado"
        : `${keysToRemove.size} pasos eliminados`,
    );
  }, [selectedNodeKeys, setStateDirty, clearNodeSelection]);

  /**
   * Copia los nodos seleccionados al clipboard interno (un ref, no el
   * portapapeles del SO — los configs pueden tener objetos anidados
   * que no serializan a texto plano). El pegado los inserta a la
   * derecha del flujo con node_keys nuevos.
   */
  const copySelectedNodes = useCallback(() => {
    if (selectedNodeKeys.size === 0) return;
    const copied = stateRef.current.nodes.filter((n) =>
      selectedNodeKeys.has(n.node_key),
    );
    clipboardRef.current = copied.map((n) => ({
      ...n,
      config: JSON.parse(JSON.stringify(n.config)),
    }));
    toast.success(
      copied.length === 1 ? "Paso copiado" : `${copied.length} pasos copiados`,
    );
  }, [selectedNodeKeys]);

  const pasteCopiedNodes = useCallback(() => {
    const copied = clipboardRef.current;
    if (!copied || copied.length === 0) return;
    setStateDirty((s) => {
      // Renombramos cada node_key añadiendo sufijo _copia, _copia_2, etc.
      // Mantenemos un mapa old → new para reescribir las referencias
      // internas (next_node_key, buttons[].next_node_key, etc.) y que
      // los wires copiados queden enganchados a las copias, no a los
      // originales.
      const keyMap = new Map<string, string>();
      const existingKeys = new Set(s.nodes.map((n) => n.node_key));
      for (const original of copied) {
        let candidate = `${original.node_key}_copia`;
        let i = 2;
        while (existingKeys.has(candidate) || keyMap.has(candidate)) {
          candidate = `${original.node_key}_copia_${i++}`;
        }
        keyMap.set(original.node_key, candidate);
        existingKeys.add(candidate);
      }
      // Rewriter recursivo: cualquier string que sea exactamente
      // un node_key del set copiado se reemplaza por su nuevo nombre.
      const rewrite = (val: unknown): unknown => {
        if (typeof val === "string") return keyMap.get(val) ?? val;
        if (Array.isArray(val)) return val.map(rewrite);
        if (val && typeof val === "object") {
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
            out[k] = rewrite(v);
          }
          return out;
        }
        return val;
      };
      // Offset visual para que las copias no caigan exactamente encima
      // de los originales y el merchant las vea.
      const newNodes = copied.map((orig) => ({
        node_key: keyMap.get(orig.node_key)!,
        node_type: orig.node_type,
        config: rewrite(orig.config) as Record<string, unknown>,
        position_x: orig.position_x + 40,
        position_y: orig.position_y + 40,
      }));
      return { ...s, nodes: [...s.nodes, ...newNodes] };
    });
    toast.success(
      copied.length === 1 ? "Paso pegado" : `${copied.length} pasos pegados`,
    );
  }, [setStateDirty]);

  // Atajos de teclado a nivel del editor: Delete borra la selección
  // múltiple cuando hay 2+ nodos; Cmd/Ctrl+C copia; Cmd/Ctrl+V pega.
  // Se desactiva si el foco está en un input para no comer tipeo.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, [contenteditable="true"]')) return;
      const meta = e.metaKey || e.ctrlKey;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedNodeKeys.size > 1) {
        e.preventDefault();
        removeSelectedNodes();
        return;
      }
      if (meta && e.key.toLowerCase() === "c" && selectedNodeKeys.size > 0) {
        e.preventDefault();
        copySelectedNodes();
        return;
      }
      if (meta && e.key.toLowerCase() === "v") {
        e.preventDefault();
        pasteCopiedNodes();
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedNodeKeys, removeSelectedNodes, copySelectedNodes, pasteCopiedNodes]);

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  /** Handle del CanvasViewport para hacer auto-zoom programático al
   *  paso roto cuando el usuario clickea "Ver error". */
  const canvasViewportRef = useRef<CanvasViewportHandle>(null);

  // Cuando el usuario clickea un error en el panel:
  //   1) Expandimos el card del paso (para que se vea el campo roto).
  //   2) Hacemos auto-zoom y centramos el viewport sobre el nodo
  //      a escala 1.2 — suficientemente cerca para leer los detalles
  //      sin perder contexto.
  //   3) Flasheamos el borde por 1.6s para guiar el ojo.
  const jumpToNode = useCallback((key: string) => {
    setExpanded((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    setFlashedKey(key);
    // Auto-zoom: leemos la posición + tamaño del nodo y pedimos al
    // viewport que centre+escale a 1.2x. El timeout deja que el
    // expand re-renderee y el useLayoutEffect mida el alto real
    // antes de calcular el centro.
    window.setTimeout(() => {
      const node = stateRef.current.nodes.find((n) => n.node_key === key);
      if (node && canvasViewportRef.current) {
        const el = nodeRefs.current.get(key);
        // Si el ref está, usamos su altura real (ya re-medida tras el
        // expand). Si no, fallback a 280 (card mediano).
        const h = el?.getBoundingClientRect().height ?? 280;
        canvasViewportRef.current.zoomToRect(
          { x: node.position_x, y: node.position_y, w: CARD_WIDTH, h },
          1.2,
        );
      }
    }, 80);
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

  // ─── Confirmación al borrar un botón / fila con downstream ───
  //
  // Cuando el usuario hace click en la papelera de un botón del bubble
  // editable (o de una fila de send_list), si ese botón apuntaba a
  // otro paso, le preguntamos qué hacer con la cadena que le sigue:
  //   - "Sólo el botón" → quita el botón, los pasos posteriores quedan
  //     huérfanos (recuperables: el usuario los puede reconectar).
  //   - "El botón y los pasos siguientes" → borra la subcadena que
  //     SÓLO era alcanzable por este botón (no toca pasos compartidos
  //     con otra rama).
  // Para botones SIN next_node_key, borramos directo (no hay nada que
  // perder).
  type PendingButtonRemoval = {
    parentKey: string;
    btnIdx: number;
    // Pasos a borrar si elige "todo" — incluye el destino directo del
    // botón + cadena exclusiva. Calculados al abrir el diálogo.
    downstreamKeys: string[];
  };
  type PendingRowRemoval = {
    parentKey: string;
    sectionIdx: number;
    rowIdx: number;
    downstreamKeys: string[];
  };
  const [pendingBtnRemoval, setPendingBtnRemoval] =
    useState<PendingButtonRemoval | null>(null);
  const [pendingRowRemoval, setPendingRowRemoval] =
    useState<PendingRowRemoval | null>(null);

  /**
   * Subárbol de nodos alcanzables SÓLO a través del edge que estamos
   * por borrar. Hacemos BFS desde startKey y filtramos los nodos que
   * tienen otra arista entrante desde fuera del subárbol.
   *
   * Conservador: si un nodo del subárbol tiene un padre fuera, NO se
   * borra (y todo lo que dependía sólo de él via ese nodo tampoco se
   * borrará — el flood-fill lo trata como "frontera").
   */
  const computeExclusiveSubtree = useCallback(
    (
      startKey: string,
      sourceParentKey: string,
      /**
       * Índice de la arista (en el orden de getOutgoingEdges) que
       * estamos por borrar dentro del nodo `sourceParentKey`. Es un
       * ÍNDICE, no un label/key: dos botones con el mismo texto o el
       * mismo next_node_key son aristas distintas, así que matchear
       * por contenido fallaría — sólo el índice los distingue.
       */
      sourceEdgeIdx: number,
    ): string[] => {
      const s = stateRef.current;
      const byKey = new Map(s.nodes.map((n) => [n.node_key, n]));
      // 1) Subárbol naive: BFS desde startKey por aristas salientes.
      const subtree = new Set<string>();
      const queue = [startKey];
      while (queue.length) {
        const k = queue.shift()!;
        if (subtree.has(k)) continue;
        subtree.add(k);
        const node = byKey.get(k);
        if (!node) continue;
        for (const e of getOutgoingEdges(node)) {
          if (e.nextKey) queue.push(e.nextKey);
        }
      }
      // 2) Para cada nodo del subárbol, checamos si alguien fuera lo
      //    apunta (sin contar UNA arista — la que vamos a borrar).
      const hasExternalParent = (target: string): boolean => {
        if (target === s.entry_node_id) return true; // el entry siempre vive
        for (const n of s.nodes) {
          if (subtree.has(n.node_key)) continue; // padres dentro no cuentan
          const edges = getOutgoingEdges(n);
          for (let ei = 0; ei < edges.length; ei++) {
            const e = edges[ei];
            if (e.nextKey !== target) continue;
            // La arista exacta que estamos por borrar no cuenta como
            // padre externo. Match por (parentKey, índice de arista).
            if (n.node_key === sourceParentKey && ei === sourceEdgeIdx) {
              continue;
            }
            return true;
          }
        }
        return false;
      };
      // 3) Quitamos del subárbol todo nodo con padre externo (y, por
      //    transitividad, lo que sólo era alcanzable desde esos —
      //    haciendo un nuevo BFS desde startKey por aristas que no
      //    cruzan a un nodo con padre externo).
      const safeToDelete = new Set<string>();
      const queue2 = [startKey];
      while (queue2.length) {
        const k = queue2.shift()!;
        if (safeToDelete.has(k)) continue;
        if (!subtree.has(k)) continue;
        if (hasExternalParent(k)) continue;
        safeToDelete.add(k);
        const node = byKey.get(k);
        if (!node) continue;
        for (const e of getOutgoingEdges(node)) {
          if (e.nextKey) queue2.push(e.nextKey);
        }
      }
      return Array.from(safeToDelete);
    },
    [],
  );

  const requestRemoveButton = useCallback(
    (parentKey: string, btnIdx: number) => {
      const s = stateRef.current;
      const parent = s.nodes.find((n) => n.node_key === parentKey);
      if (!parent) return;
      const buttons =
        (parent.config as { buttons?: Array<{ next_node_key?: string }> })
          .buttons ?? [];
      const btn = buttons[btnIdx];
      const nextKey = btn?.next_node_key;
      if (!nextKey) {
        // No hay downstream — borrado directo, sin confirmación.
        commit(
          (state) => ({
            ...state,
            nodes: state.nodes.map((n) =>
              n.node_key === parentKey
                ? {
                    ...n,
                    config: {
                      ...(n.config as Record<string, unknown>),
                      buttons: buttons.filter((_, i) => i !== btnIdx),
                    },
                  }
                : n,
            ),
          }),
          { record: true, coalesceKey: null },
        );
        return;
      }
      // En send_buttons, getOutgoingEdges emite las aristas en el
      // mismo orden que el array `buttons`, así que el índice del
      // botón es el índice de la arista.
      const downstreamKeys = computeExclusiveSubtree(
        nextKey,
        parentKey,
        btnIdx,
      );
      setPendingBtnRemoval({ parentKey, btnIdx, downstreamKeys });
    },
    [commit, computeExclusiveSubtree],
  );

  const requestRemoveRow = useCallback(
    (parentKey: string, sectionIdx: number, rowIdx: number) => {
      const s = stateRef.current;
      const parent = s.nodes.find((n) => n.node_key === parentKey);
      if (!parent) return;
      const sections =
        (
          parent.config as {
            sections?: Array<{
              rows?: Array<{ next_node_key?: string }>;
            }>;
          }
        ).sections ?? [];
      const row = sections[sectionIdx]?.rows?.[rowIdx];
      const nextKey = row?.next_node_key;
      if (!nextKey) {
        // Sin downstream — borrado directo.
        commit(
          (state) => ({
            ...state,
            nodes: state.nodes.map((n) => {
              if (n.node_key !== parentKey) return n;
              const cfg = n.config as Record<string, unknown>;
              const ss = Array.isArray(cfg.sections)
                ? (cfg.sections as Array<{
                    title?: string;
                    rows?: Array<unknown>;
                  }>)
                : [];
              const nextSections = ss.map((sec, si) =>
                si === sectionIdx
                  ? {
                      ...sec,
                      rows: (sec.rows ?? []).filter(
                        (_, ri) => ri !== rowIdx,
                      ),
                    }
                  : sec,
              );
              return { ...n, config: { ...cfg, sections: nextSections } };
            }),
          }),
          { record: true, coalesceKey: null },
        );
        return;
      }
      // En send_list, getOutgoingEdges aplana las secciones (rows[0]
      // de la sección 0, rows[1], …, después rows[0] de la sección 1,
      // …). Calculamos el índice plano de la fila objetivo.
      let flatEdgeIdx = 0;
      for (let si = 0; si < sectionIdx; si++) {
        flatEdgeIdx += sections[si]?.rows?.length ?? 0;
      }
      flatEdgeIdx += rowIdx;
      const downstreamKeys = computeExclusiveSubtree(
        nextKey,
        parentKey,
        flatEdgeIdx,
      );
      setPendingRowRemoval({ parentKey, sectionIdx, rowIdx, downstreamKeys });
    },
    [commit, computeExclusiveSubtree],
  );

  const performBtnRemoval = useCallback(
    (alsoDeleteDownstream: boolean) => {
      if (!pendingBtnRemoval) return;
      const { parentKey, btnIdx, downstreamKeys } = pendingBtnRemoval;
      commit(
        (state) => {
          const removed = alsoDeleteDownstream
            ? new Set(downstreamKeys)
            : new Set<string>();
          return {
            ...state,
            nodes: state.nodes
              .map((n) => {
                if (n.node_key !== parentKey) return n;
                const cfg = n.config as Record<string, unknown>;
                const buttons = Array.isArray(cfg.buttons)
                  ? (cfg.buttons as Array<{
                      reply_id?: string;
                      title?: string;
                      next_node_key?: string;
                    }>)
                  : [];
                return {
                  ...n,
                  config: {
                    ...cfg,
                    buttons: buttons.filter((_, i) => i !== btnIdx),
                  },
                };
              })
              .filter((n) => !removed.has(n.node_key)),
          };
        },
        { record: true, coalesceKey: null },
      );
      setPendingBtnRemoval(null);
    },
    [commit, pendingBtnRemoval],
  );

  const performRowRemoval = useCallback(
    (alsoDeleteDownstream: boolean) => {
      if (!pendingRowRemoval) return;
      const { parentKey, sectionIdx, rowIdx, downstreamKeys } =
        pendingRowRemoval;
      commit(
        (state) => {
          const removed = alsoDeleteDownstream
            ? new Set(downstreamKeys)
            : new Set<string>();
          return {
            ...state,
            nodes: state.nodes
              .map((n) => {
                if (n.node_key !== parentKey) return n;
                const cfg = n.config as Record<string, unknown>;
                const sections = Array.isArray(cfg.sections)
                  ? (cfg.sections as Array<{
                      title?: string;
                      rows?: Array<unknown>;
                    }>)
                  : [];
                const nextSections = sections.map((sec, si) =>
                  si === sectionIdx
                    ? {
                        ...sec,
                        rows: (sec.rows ?? []).filter(
                          (_, ri) => ri !== rowIdx,
                        ),
                      }
                    : sec,
                );
                return { ...n, config: { ...cfg, sections: nextSections } };
              })
              .filter((n) => !removed.has(n.node_key)),
          };
        },
        { record: true, coalesceKey: null },
      );
      setPendingRowRemoval(null);
    },
    [commit, pendingRowRemoval],
  );

  const quickAdd = useCallback(
    (
      parentKey: string,
      kind: "text" | "button" | "list_row" | "cta",
      idx: number,
      type: NodeType,
    ) => {
      addNode(type, { parentKey, kind, idx });
    },
    [addNode],
  );
  const bubbleActions = useMemo<FlowBubbleActions>(
    () => ({ requestRemoveButton, requestRemoveRow, quickAdd }),
    [requestRemoveButton, requestRemoveRow, quickAdd],
  );

  // ---- Render ----
  return (
    // z-50 puts the editor above the dashboard sidebar (z-40) so the
    // user gets a dedicated full-screen canvas environment, no
    // sidebar chrome poking in from the left.
    <FlowBubbleActionsContext.Provider value={bubbleActions}>
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
          onViewRuns={() => !templatePreview && router.push(`/menus/${initialFlow.id}/usos`)}
          onOpenVersions={() => setVersionsOpen(true)}
          showAnalytics={analyticsOn}
          onToggleAnalytics={() => !templatePreview && setAnalyticsOn((v) => !v)}
          onOpenSimulator={() => setSimulatorOpen(true)}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          templatePreview={templatePreview}
        />
      </div>

      {templatePreview && (
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-primary/20 bg-primary/5 px-4 py-2 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent-ink" />
          <span>
            Vista previa de la plantilla. Toca{" "}
            <span className="font-medium text-foreground">Usar plantilla</span>{" "}
            para crearla y editarla.
          </span>
        </div>
      )}

      {/* Canvas libre: cada nodo posicionado en (position_x, position_y),
          conectados por líneas SVG curvas que se re-calculan en cada
          re-render → arrastra cualquier card y las líneas se estiran
          solas. Disparador y nodos son draggeables. */}
      <div className="relative flex min-h-0 flex-1">
        <CanvasViewport
          ref={canvasViewportRef}
          onComputeContentBounds={computeContentBounds}
          onAutoLayout={handleAutoLayout}
        >
          <FlowCanvas
            entryKey={state.entry_node_id}
            allNodes={state.nodes}
            silenced={silenced}
            expanded={expanded}
            entryNodeId={state.entry_node_id}
            flashedKey={flashedKey}
            issues={visibleIssues}
            setNodeRef={setNodeRef}
            onToggle={toggleExpanded}
            onUpdate={updateNode}
            onUpdateConfig={updateNodeConfig}
            onMove={moveNode}
            onSnapshotHistory={snapshotHistory}
            onWireConnection={wireConnection}
            connectingActiveRef={connectingActiveRef}
            onDuplicate={duplicateNode}
            onRemove={removeNode}
            onSetEntry={(key) =>
              setStateDirty((s) => ({ ...s, entry_node_id: key }))
            }
            selectedNodeKeys={selectedNodeKeys}
            onSelectNode={toggleNodeSelection}
            onClearMultiSelect={clearNodeSelection}
            liveLinter={liveLinter}
            analyticsOverlay={{ active: analyticsOn, byNode: analytics }}
            onAdd={addNode}
            triggerType={state.trigger_type}
            triggerConfig={state.trigger_config}
            triggerIssues={visibleIssues.filter((i) => i.scope === "trigger")}
            onTriggerChange={(type, config) =>
              setStateDirty((s) => ({
                ...s,
                trigger_type: type,
                trigger_config: config,
              }))
            }
            triggerPosition={{
              x: state.trigger_position_x,
              y: state.trigger_position_y,
            }}
            onTriggerMove={moveTrigger}
          />
        </CanvasViewport>
        {/* Floating palette — siempre disponible en la esquina del lienzo
            para agregar un paso sin importar dónde estés viendo el árbol.
            El paso recién creado aparece como "huérfano" abajo y el
            usuario lo conecta donde quiera con el selector "Avanza a". */}
        {state.nodes.length > 0 && (
          // Bottom-LEFT — los controles de zoom del CanvasViewport viven
          // en bottom-right, así que llevamos la paleta al otro lado
          // para que no se solape con los controles de zoom.
          <div className="pointer-events-none absolute bottom-4 left-4 z-20 flex flex-col items-start gap-2">
            <div className="pointer-events-auto">
              <FloatingAddPalette onAdd={addNode} />
            </div>
          </div>
        )}
        {/* Constructor IA — chat embebido en la esquina superior derecha
            del lienzo. Recibe getSnapshot (no el state directo) para
            mandar siempre la versión más reciente al endpoint. */}
        {!templatePreview && (
          <AiBuilderPanel
            flowId={initialFlow.id}
            getSnapshot={() => ({
              name: stateRef.current.name,
              trigger_type: stateRef.current.trigger_type,
              trigger_config: stateRef.current.trigger_config,
              trigger_position: {
                x: stateRef.current.trigger_position_x,
                y: stateRef.current.trigger_position_y,
              },
              entry_node_id: stateRef.current.entry_node_id,
              nodes: stateRef.current.nodes.map((n) => ({
                node_key: n.node_key,
                node_type: n.node_type,
                config: n.config,
                position_x: n.position_x,
                position_y: n.position_y,
              })),
            })}
            onApplyPatches={applyAiPatches}
          />
        )}
      </div>

      {/* Validation panel — solo aparece después de que el usuario
          intentó guardar (showValidation === true) y hay errores.
          Mientras arma, no queremos meter ruido. */}
      {showValidation && state.nodes.length > 0 && issues.length > 0 && (
        <div className="z-10 flex-shrink-0 border-t border-border bg-card/40 shadow-xl shadow-black/40">
          <ValidationPanel
            issues={issues}
            onJump={jumpToNode}
            nodes={state.nodes}
          />
        </div>
      )}

      {/* Diálogos de confirmación al borrar un botón/fila con downstream.
          La elección impacta cuántos pasos se borran en cascada — el
          subtree exclusivo se calcula cuando se abre el diálogo. */}
      <CascadeDeleteDialog
        open={!!pendingBtnRemoval}
        downstreamCount={pendingBtnRemoval?.downstreamKeys.length ?? 0}
        kind="button"
        onClose={() => setPendingBtnRemoval(null)}
        onConfirmButtonOnly={() => performBtnRemoval(false)}
        onConfirmWithDownstream={() => performBtnRemoval(true)}
      />
      <CascadeDeleteDialog
        open={!!pendingRowRemoval}
        downstreamCount={pendingRowRemoval?.downstreamKeys.length ?? 0}
        kind="row"
        onClose={() => setPendingRowRemoval(null)}
        onConfirmButtonOnly={() => performRowRemoval(false)}
        onConfirmWithDownstream={() => performRowRemoval(true)}
      />

      {/* Command palette: Cmd/Ctrl+K para todo. Saltar a nodo,
          insertar tipo, guardar, auto-organizar, centrar, abrir IA. */}
      {!templatePreview && (
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          items={buildCommandItems({
            nodes: state.nodes,
            jumpToNode,
            addNode,
            handleSave,
            handleAutoLayout,
            fitToView: () =>
              canvasViewportRef.current?.zoomToRect(computeContentBounds(), 0.7),
          })}
        />
      )}

      {!templatePreview && (
        <FlowVersionsDialog
          flowId={initialFlow.id}
          open={versionsOpen}
          onClose={() => setVersionsOpen(false)}
          onRestored={() => router.refresh()}
        />
      )}

      {simulatorOpen && (
        <SimulatorPanel
          nodes={state.nodes}
          entryKey={state.entry_node_id}
          triggerType={state.trigger_type}
          triggerConfig={state.trigger_config}
          onClose={() => setSimulatorOpen(false)}
        />
      )}
    </div>
    </FlowBubbleActionsContext.Provider>
  );
}

/**
 * Construye la lista de comandos disponibles en el palette. Combina:
 *   - "Saltar a paso": un item por cada nodo del flujo (resaltado por
 *     etiqueta de tipo + título inline).
 *   - "Agregar paso": un item por cada NodeType disponible.
 *   - "Acciones": guardar, auto-organizar, centrar.
 */
function buildCommandItems(args: {
  nodes: BuilderNode[];
  jumpToNode: (key: string) => void;
  addNode: (type: NodeType) => void;
  handleSave: () => void;
  handleAutoLayout: () => void;
  fitToView: () => void;
}): CommandItem[] {
  const items: CommandItem[] = [];

  // Acciones globales primero — son lo que el merchant más busca.
  items.push(
    {
      group: "Acción",
      label: "Guardar",
      hint: "Aplica los cambios y revisa la validación.",
      run: args.handleSave,
      shortcut: "Cmd+S",
    },
    {
      group: "Acción",
      label: "Auto-organizar nodos",
      hint: "Reordena el grafo en columnas según el flujo.",
      run: args.handleAutoLayout,
    },
    {
      group: "Acción",
      label: "Centrar todo el flujo",
      hint: "Encuadra todos los pasos en pantalla.",
      run: args.fitToView,
    },
  );

  // Saltar a nodo: usamos la etiqueta del tipo + el texto inline para
  // que el usuario reconozca el paso ("Enviar mensaje · Hola, gracias").
  for (const n of args.nodes) {
    const meta = NODE_META[n.node_type];
    const inline = inlineNodeTitle(n);
    items.push({
      group: "Saltar a paso",
      label: meta.label,
      hint: inline || `Paso ${n.node_key}`,
      run: () => args.jumpToNode(n.node_key),
    });
  }

  // Agregar paso: un comando por tipo agregable.
  for (const t of ADDABLE_NODE_TYPES) {
    const meta = NODE_META[t];
    items.push({
      group: "Agregar paso",
      label: meta.label,
      hint: `Crea un nuevo ${meta.label.toLowerCase()}.`,
      run: () => args.addNode(t),
    });
  }

  return items;
}

/**
 * True para nodos de UNA sola salida donde el `next_node_key` está
 * sin asignar. Esos son los candidatos a mostrar el tail "⊕" a nivel
 * card. Los nodos lógicos con múltiples branches (condition,
 * shopify_lookup, ai_intent) y los multi-port (send_buttons,
 * send_list) renderizan el tail por slot, no a nivel card.
 */
function hasSingleUnconnectedOutput(n: BuilderNode): boolean {
  const cfg = n.config as Record<string, unknown>;
  switch (n.node_type) {
    case "send_message":
    case "send_image":
    case "send_video":
    case "send_document":
    case "send_cta_url":
    case "collect_input":
    case "customer_reply":
    case "subflow":
    case "set_tag":
    case "wait":
    case "start":
      return !((cfg as { next_node_key?: string }).next_node_key);
    default:
      // Multi-output o terminal — no aplica el tail a nivel card.
      return false;
  }
}

function inlineNodeTitle(n: BuilderNode): string | null {
  const cfg = n.config as Record<string, unknown>;
  let raw: unknown;
  if (typeof cfg.text === "string") raw = cfg.text;
  else if (typeof cfg.prompt_text === "string") raw = cfg.prompt_text;
  else if (typeof cfg.button_title === "string") raw = cfg.button_title;
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  return t.length > 60 ? `${t.slice(0, 60)}…` : t;
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
  onOpenVersions,
  showAnalytics,
  onToggleAnalytics,
  onOpenSimulator,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  templatePreview = false,
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
  onOpenVersions: () => void;
  showAnalytics: boolean;
  onToggleAnalytics: () => void;
  onOpenSimulator: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  templatePreview?: boolean;
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
      {!templatePreview && <StatusBadge status={state.status} />}
      {dirty && !templatePreview && (
        <span className="hidden h-1.5 w-1.5 rounded-full bg-amber-400 sm:inline-block" title="Cambios sin guardar" />
      )}
      <div className="ml-auto flex items-center gap-1.5">
        {/* Undo / Redo — atajo Ctrl/Cmd+Z + Shift. Botones se
            deshabilitan cuando no hay nada que deshacer/rehacer. */}
        <div className="mr-1 flex items-center gap-0.5 rounded-md border border-border bg-card/40 p-0.5">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title="Deshacer (Ctrl+Z)"
            aria-label="Deshacer"
            className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            title="Rehacer (Ctrl+Shift+Z)"
            aria-label="Rehacer"
            className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>
        </div>
        {/* Toggle on/off para activar/pausar. Reemplaza el viejo botón
            "Activar / Pausar" que era textual y siempre estaba ahí —
            ahora es un switch igual al de Automatizaciones, así el
            patrón es consistente en todo Riverz. El label arriba del
            switch refleja el estado actual ("Activo" / "Pausado") para
            que el merchant entienda en qué modo está sin tener que
            adivinar por el color. */}
        {!templatePreview && (
          <label
            className="flex items-center gap-2 px-1"
            title={
              state.status === "active"
                ? "El flujo está activo. Toca para pausar."
                : canActivate
                  ? "El flujo está pausado. Toca para activar."
                  : "Corrige los errores antes de activar"
            }
          >
            <Switch
              checked={state.status === "active"}
              disabled={
                activating || (state.status !== "active" && !canActivate)
              }
              onCheckedChange={(v) => onStatus(v ? "active" : "draft")}
              aria-label={state.status === "active" ? "Pausar" : "Activar"}
            />
            <span
              className={cn(
                "text-xs font-medium",
                state.status === "active"
                  ? "text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {activating
                ? "Cambiando…"
                : state.status === "active"
                  ? "Activo"
                  : "Pausado"}
            </span>
          </label>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenSimulator}
          title="Probar el flujo como cliente"
        >
          <PlayCircle className="h-3.5 w-3.5" />
          Probar
        </Button>
        <Button onClick={onSave} disabled={saving} size="sm">
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : templatePreview ? (
            <Sparkles className="h-3.5 w-3.5" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {templatePreview ? "Usar plantilla" : "Guardar"}
        </Button>
        {!templatePreview && (
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
            <DropdownMenuItem onClick={() => onOpenVersions()}>
              <History className="h-3.5 w-3.5" />
              Versiones
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onToggleAnalytics()}>
              <GitBranch className="h-3.5 w-3.5" />
              {showAnalytics ? "Ocultar analítica" : "Mostrar analítica por nodo"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onDelete}
              className="text-red-600 dark:text-red-400 focus:bg-red-500/10 focus:text-red-300"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Eliminar flujo
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: BuilderState["status"] }) {
  const cls = {
    draft: "border-border bg-muted text-foreground",
    active: "border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
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
  isEntry,
  isFlashed,
  isDropTarget,
  cardRef,
  issues,
  onUpdate,
  onUpdateConfig,
  onConnectStart,
  onDuplicate,
  onRemove,
  onSetEntry,
}: {
  node: BuilderNode;
  allNodes: BuilderNode[];
  isEntry: boolean;
  isFlashed: boolean;
  /** True mientras un drag-to-connect está sobre este nodo (mouse encima). */
  isDropTarget: boolean;
  cardRef: (el: HTMLDivElement | null) => void;
  issues: ValidationIssue[];
  onUpdate: (patch: Partial<BuilderNode>) => void;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  onConnectStart: (
    kind: "button" | "list_row" | "cta" | "text",
    idx: number,
    e: React.MouseEvent,
  ) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onSetEntry: () => void;
}) {
  const hasError = issues.some((i) => i.severity === "error");
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  // Nota anclada al nodo. Vive en config._notes para no chocar con
  // ningún campo de runtime (todos los configs usan keys planos sin
  // underscore). El engine la ignora al ejecutar.
  const noteText = (
    (node.config as Record<string, unknown>)._notes as string | undefined
  ) ?? "";
  return (
    <div
      ref={cardRef}
      data-node-key={node.node_key}
      className={cn(
        "group/card relative rounded-lg border bg-card transition-shadow duration-200",
        hasError
          ? "border-red-500/40"
          : isEntry
            ? "border-primary/50"
            : "border-border",
        isFlashed &&
          "ring-2 ring-primary ring-offset-2 ring-offset-background",
        isDropTarget &&
          "ring-2 ring-[#00a5f4] ring-offset-2 ring-offset-background shadow-[0_0_24px_rgba(0,165,244,0.45)]",
      )}
    >
      {noteText && (
        <div
          className="flex items-start gap-1.5 rounded-t-lg border-b border-amber-500/20 bg-amber-500/10 px-3 py-1.5"
          onClick={() => setNoteEditorOpen(true)}
          role="button"
          tabIndex={0}
        >
          <StickyNote className="mt-0.5 size-3 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="line-clamp-2 text-[10px] leading-snug text-amber-700 dark:text-amber-300">
            {noteText}
          </p>
        </div>
      )}
      <EditableNodeBubble
        node={node}
        allNodes={allNodes}
        onUpdate={onUpdate}
        onUpdateConfig={onUpdateConfig}
        onConnectStart={onConnectStart}
      />
      <NodeHoverToolbar
        hasNote={!!noteText}
        onEditNote={() => setNoteEditorOpen(true)}
        onDuplicate={onDuplicate}
        onRemove={onRemove}
      />
      {noteEditorOpen && (
        <NoteEditorPopover
          initial={noteText}
          onSave={(v) => {
            onUpdateConfig({ _notes: v.trim() ? v.trim() : undefined });
            setNoteEditorOpen(false);
          }}
          onClose={() => setNoteEditorOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Popover inline para editar la nota anclada al nodo. Sale a la
 * derecha del card para no tapar el bubble preview. Save al apretar
 * Cmd/Ctrl+Enter o el botón Guardar; Esc descarta.
 */
function NoteEditorPopover({
  initial,
  onSave,
  onClose,
}: {
  initial: string;
  onSave: (v: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div
      className="absolute -right-2 top-0 z-30 w-64 translate-x-full rounded-lg border border-amber-500/30 bg-card p-2 shadow-2xl shadow-black/40"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="mb-1.5 flex items-center gap-1.5 px-1">
        <StickyNote className="size-3 text-amber-600" />
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Nota del nodo
        </span>
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            onSave(value);
          }
        }}
        placeholder="Nota interna. No se envía al cliente. Sirve para coordinar con tu equipo."
        rows={4}
        autoFocus
        className="w-full resize-none rounded-md border border-border bg-muted/30 px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-foreground/30"
      />
      <div className="mt-1.5 flex items-center justify-between gap-1">
        <span className="text-[10px] text-muted-foreground">
          Cmd+Enter guarda
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onSave(value)}
            className="rounded bg-foreground px-2 py-0.5 text-[11px] text-background hover:opacity-90"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

function NodeHoverToolbar({
  hasNote,
  onEditNote,
  onDuplicate,
  onRemove,
}: {
  hasNote: boolean;
  onEditNote: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className="absolute -right-1 -top-2 z-10 flex items-center gap-0.5 rounded-full border border-border bg-card px-1 py-0.5 shadow-sm opacity-0 transition-opacity group-hover/card:opacity-100"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={onEditNote}
        className={cn(
          "rounded-full p-1 transition-colors",
          hasNote
            ? "text-amber-600 hover:bg-amber-500/10"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
        aria-label={hasNote ? "Editar nota" : "Agregar nota"}
        title={hasNote ? "Editar nota" : "Agregar nota"}
      >
        <StickyNote className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={onDuplicate}
        className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Duplicar nodo"
        title="Duplicar"
      >
        <Copy className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
        aria-label="Eliminar nodo"
        title="Eliminar"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

// ============================================================
// Node bubble preview — small WhatsApp chat preview inside the card
// ============================================================
// EditableNodeBubble — la superficie única de edición del nodo.
// ============================================================
// Para los tipos que producen un mensaje (send_message, send_buttons,
// send_list, send_image/video/document, send_cta_url, collect_input,
// ai_intent) renderiza el WhatsApp bubble en modo editable: cualquier
// cambio adentro escribe directo al config via onUpdateConfig. Para
// los tipos puramente lógicos (condition, set_tag, wait, shopify_lookup,
// handoff, end, start) renderiza un mini card compacto con los campos
// clave editables inline.
function EditableNodeBubble({
  node,
  allNodes,
  onUpdate,
  onUpdateConfig,
  onConnectStart,
}: {
  node: BuilderNode;
  allNodes: BuilderNode[];
  onUpdate: (patch: Partial<BuilderNode>) => void;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  /**
   * Disparado cuando el usuario apreta el mousedown sobre un port
   * (hueco a la derecha de un botón / fila / chip). El FlowCanvas
   * arranca el flujo de drag-to-connect y al soltar el mouse sobre
   * otro card, wirea la conexión.
   */
  onConnectStart: (
    kind: "button" | "list_row" | "cta" | "text",
    idx: number,
    e: React.MouseEvent,
  ) => void;
}) {
  const cfg = node.config as Record<string, unknown>;
  // Acciones de confirmación expuestas por el FlowBuilder root. Para
  // borrar un botón/fila con downstream, usamos requestRemove* en vez
  // del fallback directo (filter de buttons). Si el context no está
  // (no debería pasar), caemos al borrado directo.
  const bubbleActions = useFlowBubbleActions();
  void onUpdate;
  switch (node.node_type) {
    case "send_message": {
      return (
        <div className="px-3 py-2">
          <WhatsappBubblePreview
            kind="text"
            text={(cfg.text as string) ?? ""}
            editable
            connectablePorts
            textConnected={!!(cfg.next_node_key as string)}
            onPortMouseDown={onConnectStart}
            onTextChange={(v) => onUpdateConfig({ text: v })}
          />
        </div>
      );
    }
    case "send_buttons": {
      const buttons = Array.isArray(cfg.buttons)
        ? (cfg.buttons as Array<{ reply_id?: string; title?: string; next_node_key?: string }>)
        : [];
      return (
        <div className="px-3 py-2">
          <WhatsappBubblePreview
            kind="buttons"
            text={(cfg.text as string) ?? ""}
            buttons={buttons.map((b) => ({ title: b.title ?? "" }))}
            editable
            connectablePorts
            buttonConnected={buttons.map((b) => !!b.next_node_key)}
            onPortMouseDown={onConnectStart}
            onTextChange={(v) => onUpdateConfig({ text: v })}
            onButtonChange={(idx, title) => {
              const next = buttons.map((b, i) =>
                i === idx ? { ...b, title } : b,
              );
              onUpdateConfig({ buttons: next });
            }}
            onAddButton={() => {
              const next = [
                ...buttons,
                {
                  reply_id: `btn_${buttons.length + 1}`,
                  title: "",
                  next_node_key: "",
                },
              ];
              onUpdateConfig({ buttons: next });
            }}
            onRemoveButton={(idx) => {
              if (bubbleActions) {
                bubbleActions.requestRemoveButton(node.node_key, idx);
              } else {
                onUpdateConfig({
                  buttons: buttons.filter((_, i) => i !== idx),
                });
              }
            }}
          />
        </div>
      );
    }
    case "send_list": {
      const sections = Array.isArray(cfg.sections)
        ? (cfg.sections as Array<{
            title?: string;
            rows?: Array<{
              reply_id?: string;
              title?: string;
              description?: string;
              next_node_key?: string;
            }>;
          }>)
        : [];
      const rows = sections.flatMap((s) => s.rows ?? []);
      /**
       * Reescribe TODAS las filas (flatten). El bubble edita en plano
       * (sin UI de secciones), pero al persistir conservamos la
       * estructura original: si había varias secciones, intentamos
       * mapear el flat de vuelta. Si el usuario agregó/quitó filas
       * (nextFlat.length !== rows.length), las nuevas/borradas se
       * imputan a la PRIMERA sección — esa es la única ambigüedad que
       * podemos resolver sin UI de secciones. Las demás secciones
       * conservan sus títulos y rows individuales mapeados por idx.
       */
      const writeRows = (
        nextFlat: Array<{
          reply_id?: string;
          title?: string;
          description?: string;
          next_node_key?: string;
        }>,
      ) => {
        if (sections.length === 0) {
          onUpdateConfig({
            sections: [{ title: "Opciones", rows: nextFlat }],
          });
          return;
        }
        if (sections.length === 1) {
          onUpdateConfig({
            sections: [
              { title: sections[0].title ?? "Opciones", rows: nextFlat },
            ],
          });
          return;
        }
        // 2+ secciones: redistribuimos manteniendo conteos por sección
        // donde es posible. Si nextFlat es del mismo largo que rows,
        // edición pura → cada sección keep su rangos. Si difiere, la
        // diferencia va a la primera sección.
        const lensByIdx = sections.map((s) => s.rows?.length ?? 0);
        const delta = nextFlat.length - rows.length;
        if (delta !== 0) {
          lensByIdx[0] = Math.max(0, lensByIdx[0] + delta);
        }
        let offset = 0;
        const newSections = sections.map((sec, sIdx) => {
          const len = lensByIdx[sIdx];
          const slice = nextFlat.slice(offset, offset + len);
          offset += len;
          return { ...sec, rows: slice };
        });
        onUpdateConfig({ sections: newSections });
      };
      return (
        <div className="px-3 py-2">
          <WhatsappBubblePreview
            kind="list"
            text={(cfg.text as string) ?? ""}
            listButtonLabel={(cfg.button_label as string) ?? ""}
            listRows={rows.map((r) => ({
              title: r.title ?? "",
              description: r.description,
            }))}
            editable
            connectablePorts
            listRowConnected={rows.map((r) => !!r.next_node_key)}
            onPortMouseDown={onConnectStart}
            onTextChange={(v) => onUpdateConfig({ text: v })}
            onListLabelChange={(v) => onUpdateConfig({ button_label: v })}
            onListRowChange={(idx, patch) => {
              const next = rows.map((r, i) =>
                i === idx ? { ...r, ...patch } : r,
              );
              writeRows(next);
            }}
            onAddListRow={() => {
              writeRows([
                ...rows,
                {
                  reply_id: `row_${rows.length + 1}`,
                  title: "",
                  description: "",
                  next_node_key: "",
                },
              ]);
            }}
            onRemoveListRow={(idx) => {
              if (bubbleActions) {
                // Traducir el idx plano que usa el bubble (0..N-1
                // entre todas las secciones) a (sectionIdx, rowIdx)
                // que es lo que persiste el config. Recorremos las
                // secciones y vamos descontando.
                let remaining = idx;
                for (let si = 0; si < sections.length; si++) {
                  const sec = sections[si];
                  const rowsHere = sec.rows?.length ?? 0;
                  if (remaining < rowsHere) {
                    bubbleActions.requestRemoveRow(node.node_key, si, remaining);
                    return;
                  }
                  remaining -= rowsHere;
                }
                // No mapeó (no debería pasar) — fallback al borrado plano.
                writeRows(rows.filter((_, i) => i !== idx));
              } else {
                writeRows(rows.filter((_, i) => i !== idx));
              }
            }}
          />
        </div>
      );
    }
    case "send_cta_url": {
      return (
        <div className="px-3 py-2">
          <WhatsappBubblePreview
            kind="cta_url"
            text={(cfg.text as string) ?? ""}
            ctaTitle={(cfg.button_title as string) ?? ""}
            ctaUrl={(cfg.url as string) ?? ""}
            editable
            connectablePorts
            ctaConnected={!!(cfg.next_node_key as string)}
            onPortMouseDown={onConnectStart}
            onTextChange={(v) => onUpdateConfig({ text: v })}
            onCtaTitleChange={(v) => onUpdateConfig({ button_title: v })}
            onCtaUrlChange={(v) => onUpdateConfig({ url: v })}
          />
        </div>
      );
    }
    case "send_image":
    case "send_video": {
      return (
        <div className="px-3 py-2">
          <WhatsappBubblePreview
            kind={node.node_type === "send_image" ? "image" : "video"}
            mediaUrl={(cfg.url as string) ?? ""}
            caption={(cfg.caption as string) ?? ""}
            text=""
            editable
            connectablePorts
            textConnected={!!(cfg.next_node_key as string)}
            onPortMouseDown={onConnectStart}
            onMediaUrlChange={(v) => onUpdateConfig({ url: v })}
            onCaptionChange={(v) => onUpdateConfig({ caption: v })}
          />
        </div>
      );
    }
    case "send_document": {
      return (
        <div className="px-3 py-2">
          <WhatsappBubblePreview
            kind="document"
            filename={(cfg.filename as string) ?? ""}
            caption={(cfg.caption as string) ?? ""}
            text=""
            editable
            connectablePorts
            textConnected={!!(cfg.next_node_key as string)}
            onPortMouseDown={onConnectStart}
            onFilenameChange={(v) => onUpdateConfig({ filename: v })}
            onCaptionChange={(v) => onUpdateConfig({ caption: v })}
          />
        </div>
      );
    }
    case "collect_input":
    case "ai_intent": {
      return (
        <div className="px-3 py-2">
          <WhatsappBubblePreview
            kind="text"
            text={(cfg.prompt_text as string) ?? ""}
            editable
            connectablePorts
            textConnected={!!(cfg.next_node_key as string)}
            onPortMouseDown={onConnectStart}
            onTextChange={(v) => onUpdateConfig({ prompt_text: v })}
          />
        </div>
      );
    }
    default:
      return (
        <LogicNodeBody
          node={node}
          onUpdateConfig={onUpdateConfig}
          onConnectStart={onConnectStart}
        />
      );
  }
}

/**
 * Mini-card para nodos lógicos: header con ícono + tipo, abajo los
 * campos clave editables inline. Sin formularios grandes.
 */
function LogicNodeBody({
  node,
  onUpdateConfig,
  onConnectStart,
}: {
  node: BuilderNode;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  onConnectStart: (
    kind: "button" | "list_row" | "cta" | "text",
    idx: number,
    e: React.MouseEvent,
  ) => void;
}) {
  const meta = NODE_META[node.node_type];
  const cfg = node.config as Record<string, unknown>;
  // Cuántas salidas tiene el nodo + si están conectadas o no. Determina
  // cuántos ports renderizamos en el body lógico y con qué etiquetas.
  const outputs = logicOutputs(node);
  return (
    <div className="space-y-2 p-3">
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
            meta.bg,
          )}
        >
          <meta.icon className={cn("h-3.5 w-3.5", meta.color)} />
        </div>
        <span className="text-sm font-medium text-foreground">
          {meta.label}
        </span>
      </div>

      {node.node_type === "condition" && (
        <CompactInput
          label="Valor"
          value={(cfg.value as string) ?? ""}
          placeholder="Texto a comparar…"
          onChange={(v) => onUpdateConfig({ value: v })}
        />
      )}
      {node.node_type === "wait" && (
        <CompactInput
          label="Tiempo"
          value={String((cfg.amount as number) ?? "")}
          placeholder="5"
          onChange={(v) => onUpdateConfig({ amount: Number(v) || 0 })}
        />
      )}
      {node.node_type === "handoff" && (
        <CompactInput
          label="Nota interna"
          value={(cfg.note as string) ?? ""}
          placeholder="Por qué se pasa a un humano…"
          onChange={(v) => onUpdateConfig({ note: v })}
        />
      )}
      {node.node_type === "shopify_lookup" && (
        <ShopifyLookupForm
          kind={(cfg.kind as string) ?? "order_by_number"}
          inputVar={(cfg.input_var as string) ?? ""}
          outputPrefix={(cfg.output_prefix as string) ?? ""}
          onUpdateConfig={onUpdateConfig}
        />
      )}
      {node.node_type === "set_tag" && (
        <p className="text-[11px] italic text-muted-foreground">
          {(cfg.mode as string) === "remove"
            ? "Quita la etiqueta."
            : "Agrega la etiqueta."}
        </p>
      )}
      {node.node_type === "end" && (
        <p className="text-[11px] italic text-muted-foreground">
          Fin del flujo. El cliente sale acá.
        </p>
      )}
      {node.node_type === "start" && (
        <p className="text-[11px] italic text-muted-foreground">
          Punto de inicio.
        </p>
      )}
      {node.node_type === "customer_reply" && (
        <p className="text-[11px] italic text-muted-foreground">
          El flujo se pausa hasta que el cliente envíe un mensaje.
          No se guarda nada — solo se espera.
        </p>
      )}
      {node.node_type === "subflow" && (
        <SubflowPicker
          currentNodeKey={node.node_key}
          value={(cfg.sub_flow_id as string) ?? ""}
          onChange={(v) => onUpdateConfig({ sub_flow_id: v })}
        />
      )}

      {/* Ports de salida — uno por output. Sólo si el nodo tiene
          ≥1 salida (los terminales como handoff/end no muestran). */}
      {outputs.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-border pt-2">
          {outputs.map((o, i) => (
            <div
              key={i}
              className="relative flex items-center justify-between rounded-md border border-border bg-muted/30 px-2 py-1"
              data-port-kind="text"
            >
              <span className="text-[11px] text-muted-foreground">
                {o.label}
              </span>
              <span
                data-connection-port="true"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onConnectStart("text", i, e);
                }}
                className={cn(
                  "absolute right-[-7px] top-1/2 z-10 h-3 w-3 -translate-y-1/2 cursor-crosshair rounded-full border-2 transition-all",
                  o.connected
                    ? "border-[#00a5f4] bg-[#00a5f4] shadow-[0_0_0_2px_rgba(0,165,244,0.18)]"
                    : "border-[#9aa6ad] bg-white hover:scale-125 hover:border-[#00a5f4] hover:shadow-[0_0_0_3px_rgba(0,165,244,0.22)]",
                )}
                role="button"
                aria-label={o.connected ? "Conexión existente" : "Conectar a otro paso"}
              />
              {/* Tail visual: línea + "⊕" cuando el port no está
                  conectado. Sale por fuera del card a la derecha y
                  abre el menú de "Siguiente paso". Es la afordancia
                  principal — el chip viejo "+ Agregar" inline lo
                  sustituyó. Se oculta solo si node.node_type === "end"
                  (terminal). */}
              {!o.connected && node.node_type !== "end" && (
                <QuickAddTail
                  parentKey={node.node_key}
                  kind="text"
                  idx={i}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Botón "+" inline al lado de un port no conectado. Despliega un menú
 * con los tipos de nodo más comunes para agregar+conectar de un solo
 * paso. Usa el FlowBubbleActionsContext para hablar con el FlowBuilder
 * sin threading.
 */
function QuickAddPortButton({
  parentKey,
  kind,
  idx,
}: {
  parentKey: string;
  kind: "text" | "button" | "list_row" | "cta";
  idx: number;
}) {
  const actions = useFlowBubbleActions();
  if (!actions) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="ml-1 inline-flex h-5 items-center gap-1 rounded-full border border-border bg-card px-1.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Agregar el siguiente paso"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <Plus className="size-3" />
        Agregar
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-80 min-w-56 overflow-y-auto border-border bg-card"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Siguiente paso
        </div>
        {ADDABLE_NODE_TYPES.map((t) => {
          const meta = NODE_META[t];
          return (
            <DropdownMenuItem
              key={t}
              onClick={() => actions.quickAdd(parentKey, kind, idx, t)}
            >
              <meta.icon className={cn("h-3.5 w-3.5", meta.color)} />
              {meta.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Afordancia visible "líneita + ⊕" anclada a la derecha del card.
 * Aparece SIEMPRE que el nodo tenga una salida sin conectar (excepto
 * el nodo Fin que es terminal). Estética: línea horizontal de ~36px
 * que sale del borde del card hasta un círculo con "+" — el patrón
 * que el usuario reconoce de Figma/Linear/Manychat.
 *
 * Comportamiento: click abre el mismo menú que QuickAddPortButton
 * (un item por NodeType) y el nodo recién agregado queda wired al
 * port (parentKey, kind, idx).
 *
 * Se posiciona con absolute: top según la altura del slot al que
 * pertenece. Cada port pasivo (sin conexión) lo renderiza al lado del
 * círculo de conexión existente.
 */
function QuickAddTail({
  parentKey,
  kind,
  idx,
}: {
  parentKey: string;
  kind: "text" | "button" | "list_row" | "cta";
  idx: number;
}) {
  const actions = useFlowBubbleActions();
  if (!actions) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Agregar el siguiente paso"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "group/tail absolute left-full top-1/2 z-20 -translate-y-1/2 pl-[6px]",
          "flex items-center pointer-events-auto",
        )}
      >
        {/* Línea horizontal */}
        <span
          aria-hidden
          className="block h-px w-9 bg-muted-foreground/40 group-hover/tail:bg-muted-foreground/80"
        />
        {/* Círculo con + */}
        <span
          aria-hidden
          className={cn(
            "flex size-5 items-center justify-center rounded-full",
            "border border-border bg-card text-muted-foreground shadow-sm",
            "transition-colors group-hover/tail:border-foreground/40",
            "group-hover/tail:text-foreground group-hover/tail:shadow",
          )}
        >
          <Plus className="size-3" />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-80 min-w-56 overflow-y-auto border-border bg-card"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Siguiente paso
        </div>
        {ADDABLE_NODE_TYPES.map((t) => {
          const meta = NODE_META[t];
          return (
            <DropdownMenuItem
              key={t}
              onClick={() => actions.quickAdd(parentKey, kind, idx, t)}
            >
              <meta.icon className={cn("h-3.5 w-3.5", meta.color)} />
              {meta.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Devuelve las salidas con etiqueta + estado de conexión para nodos
 * lógicos. Mapea 1:1 con el orden de getOutgoingEdges para que el
 * idx use el mismo wireConnection.
 */
function logicOutputs(
  node: BuilderNode,
): Array<{ label: string; connected: boolean }> {
  const cfg = node.config as Record<string, unknown>;
  switch (node.node_type) {
    case "condition":
      return [
        { label: "Sí", connected: !!(cfg.true_next as string) },
        { label: "No", connected: !!(cfg.false_next as string) },
      ];
    case "shopify_lookup":
      return [
        { label: "Encontrado", connected: !!(cfg.found_next_key as string) },
        {
          label: "No encontrado",
          connected: !!(cfg.not_found_next_key as string),
        },
      ];
    case "wait":
    case "set_tag":
    case "start":
    case "customer_reply":
    case "subflow":
      return [
        { label: "Avanza a", connected: !!(cfg.next_node_key as string) },
      ];
    case "handoff":
    case "end":
      return []; // terminales
    default:
      return [];
  }
}

function CompactInput({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        className="mt-0.5 w-full rounded-md border border-border bg-muted/30 px-2 py-1 text-sm text-foreground outline-none focus:border-foreground/40"
      />
    </label>
  );
}

/**
 * Form completo para shopify_lookup. Antes solo se editaba el prefijo;
 * ahora exponemos picker de `kind`, input_var (oculto para last_order
 * que usa el email/teléfono del contacto), y una vista previa de qué
 * variables va a llenar el nodo cuando corra.
 *
 * El picker de `kind` evita que el merchant tenga que editar JSON para
 * cambiar entre buscar por número de pedido, por email, último pedido,
 * o producto por handle. La vista previa de vars es informativa: ayuda
 * a saber qué placeholders tiene disponibles para el siguiente nodo
 * send_message ({{vars.pedido_total}}, {{vars.pedido_status_url}}, etc).
 */
function ShopifyLookupForm({
  kind,
  onUpdateConfig,
}: {
  kind: string;
  inputVar: string;
  outputPrefix: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  // UI radicalmente simplificada: lo único que el merchant edita es
  // QUÉ BUSCAR. El resto (variable de entrada, prefijo del resultado,
  // lista de variables disponibles) lo resuelve el backend con
  // defaults sensatos:
  //
  //   - `input_var`: el engine lo auto-detecta — toma la última
  //     variable que el cliente capturó con collect_input (o el email/
  //     teléfono del contacto para order_by_email / last_order).
  //   - `output_prefix`: "order" para pedidos, "product" para
  //     productos. Sin opción de cambiarlo.
  //   - Variables resultantes: el merchant las ve listadas en el
  //     panel Variables de la esquina inferior izquierda del lienzo,
  //     no metidas dentro del card.
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Qué buscar
        </span>
        <Select
          value={kind}
          onValueChange={(v) => onUpdateConfig({ kind: v })}
        >
          <SelectTrigger className="mt-0.5 bg-muted/30 text-sm">
            <span>{KIND_LABEL[kind] ?? kind}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="order_by_number">Pedido por número</SelectItem>
            <SelectItem value="order_by_email">Pedido por correo</SelectItem>
            <SelectItem value="last_order">
              Último pedido del contacto
            </SelectItem>
            <SelectItem value="product_by_handle">
              Producto por handle
            </SelectItem>
          </SelectContent>
        </Select>
      </label>
      <p className="text-[10px] italic text-muted-foreground">
        El número, correo o handle se toma automáticamente del último
        dato que el cliente compartió en el chat. Las variables del
        resultado (total, tracking, etc.) están en el panel Variables.
      </p>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  order_by_number: "Pedido por número",
  order_by_email: "Pedido por correo",
  last_order: "Último pedido del contacto",
  product_by_handle: "Producto por handle",
};

/**
 * Picker para elegir qué flujo se ejecuta dentro de un nodo subflow.
 * Carga la lista de flujos del workspace al montar y ofrece un Select
 * con name + slug. Filtra el flujo actual para evitar recursión
 * directa (modelo no soporta auto-llamadas — todavía).
 *
 * El runtime v1 pasa por aquí como passthrough; ver SubflowNodeConfig
 * en types.ts para el plan de ejecución recursiva.
 */
function SubflowPicker({
  currentNodeKey: _currentNodeKey,
  value,
  onChange,
}: {
  currentNodeKey: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [flows, setFlows] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/flows")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { flows?: Array<{ id: string; name: string }> } | null) => {
        if (!cancelled) {
          setFlows(d?.flows ?? []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Flujo a ejecutar
      </p>
      <Select value={value} onValueChange={(v) => onChange(v ?? "")} disabled={loading}>
        <SelectTrigger className="bg-muted/30 text-sm">
          <span>
            {loading
              ? "Cargando…"
              : flows.find((f) => f.id === value)?.name ?? "Elegir un flujo"}
          </span>
        </SelectTrigger>
        <SelectContent>
          {flows.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              {f.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[10px] italic text-muted-foreground">
        Hoy el subflujo se registra como evento y pasa al siguiente paso
        directamente. La ejecución completa del subflujo llega en una
        actualización aparte.
      </p>
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
                className="text-red-600 dark:text-red-400 hover:bg-red-500/10 hover:text-red-300"
                aria-label="Eliminar botón"
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
          <p className="mt-2 inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300">
            <CircleAlert className="h-3 w-3" />
            WhatsApp permite máximo 3 botones de respuesta. Usa una lista para más opciones.
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
              totalRows >= 10 ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground",
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
                  className="shrink-0 text-red-600 dark:text-red-400 hover:bg-red-500/10 hover:text-red-300"
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
                  className="text-red-600 dark:text-red-400 hover:bg-red-500/10 hover:text-red-300"
                  aria-label="Eliminar fila"
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
              <p className="mt-2 inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300">
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
  operator?:
    | "equals"
    | "contains"
    | "not_contains"
    | "regex_match"
    | "present"
    | "absent";
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
  const showValue =
    operator === "equals" ||
    operator === "contains" ||
    operator === "not_contains" ||
    operator === "regex_match";

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
              <SelectItem value="not_contains">no contiene</SelectItem>
              <SelectItem value="regex_match">coincide con (regex)</SelectItem>
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
        <SelectValue placeholder={placeholder ?? "Elegir"} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">Sin conexión</SelectItem>
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
  "customer_reply",
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
  "subflow",
  "handoff",
  "end",
];

// ============================================================
// Validation panel — bottom of the editor
// ============================================================

function ValidationPanel({
  issues,
  onJump,
  nodes,
}: {
  issues: ValidationIssue[];
  onJump: (key: string) => void;
  nodes: BuilderNode[];
}) {
  if (issues.length === 0) {
    return null;
  }
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  // Diccionario node_key → etiqueta amigable que se muestra antes de
  // cada error. Combina el label del tipo (Enviar botones, Si/Si no...)
  // con el texto que el usuario escribió, así un mismo tipo se distingue
  // entre varios pasos.
  const labelByKey = new Map<string, string>();
  for (const n of nodes) {
    const typeLabel = NODE_META[n.node_type].label;
    const inlineTitle = nodeInlineTitle(n);
    labelByKey.set(
      n.node_key,
      inlineTitle ? `${typeLabel} · ${inlineTitle}` : typeLabel,
    );
  }
  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3",
        errors.length > 0 ? "border-red-500/40" : "border-amber-500/40",
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        {errors.length > 0 ? (
          <CircleAlert className="h-4 w-4 text-red-600 dark:text-red-400" />
        ) : (
          <CircleAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        )}
        <span>
          {errors.length} error{errors.length === 1 ? "" : "es"},{" "}
          {warnings.length} advertencia{warnings.length === 1 ? "" : "s"}
        </span>
        <span className="ml-1 text-[10px] text-muted-foreground/80">
          Toca &quot;Ver error&quot; para ir al paso
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {issues.map((i, ix) => (
          <IssueLine
            key={ix}
            issue={i}
            onJump={onJump}
            nodeLabel={i.node_key ? labelByKey.get(i.node_key) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Texto inline corto que el usuario escribió en el cuerpo del nodo —
 * lo usamos para diferenciar varios nodos del mismo tipo en la lista
 * de errores. Se trunca a 28 chars con elipsis para no romper la línea.
 */
function nodeInlineTitle(node: BuilderNode): string | null {
  const cfg = node.config as Record<string, unknown>;
  let raw: unknown;
  if (typeof cfg.text === "string") raw = cfg.text;
  else if (typeof cfg.prompt_text === "string") raw = cfg.prompt_text;
  else if (typeof cfg.button_title === "string") raw = cfg.button_title;
  else if (typeof cfg.button_label === "string") raw = cfg.button_label;
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  return t.length > 28 ? `${t.slice(0, 28)}…` : t;
}

function IssueLine({
  issue,
  onJump,
  nodeLabel,
}: {
  issue: ValidationIssue;
  onJump?: (key: string) => void;
  nodeLabel?: string;
}) {
  const tone =
    issue.severity === "error" ? "text-red-600 dark:text-red-300" : "text-amber-700 dark:text-amber-300";
  const iconTone =
    issue.severity === "error" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400";
  const canJump = !!(issue.node_key && onJump);
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md px-2 py-1.5 text-xs",
        tone,
      )}
    >
      <CircleAlert className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", iconTone)} />
      <div className="min-w-0 flex-1">
        {nodeLabel && (
          <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {nodeLabel}
          </div>
        )}
        <p className="leading-snug">{issue.message}</p>
        {canJump && (
          <button
            type="button"
            onClick={() => onJump!(issue.node_key!)}
            className={cn(
              "mt-1 inline-flex items-center gap-1 rounded-sm text-[11px] font-medium underline-offset-2 hover:underline",
              tone,
            )}
            aria-label={nodeLabel ? `Ver error en ${nodeLabel}` : "Ver error"}
          >
            Ver error
            <span aria-hidden>→</span>
          </button>
        )}
      </div>
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

/**
 * Selector que BLOQUEA el inicio de drag. Si el mousedown ocurre sobre
 * uno de estos elementos, el card NO se arrastra (porque el usuario
 * está intentando interactuar, no mover el nodo).
 *
 * Mantenemos solo lo estrictamente necesario:
 *   - input, textarea, contenteditable: para que el usuario pueda tipear.
 *   - button: para que los botones del card (Eliminar, Duplicar, Agregar,
 *     toolbar al hover) hagan click sin moverlo.
 *   - role="combobox": shadcn Select.
 *   - data-connection-port="true": el círculo de drag-to-connect.
 *
 * Antes había select, a, label, role="button" y role="textbox" — todos
 * sobre-bloqueaban (label envolvía captions sin ser controles reales).
 * El usuario pidió poder agarrar el card desde cualquier parte, así que
 * solo bloqueamos los controles reales.
 */
const DRAG_BLOCK_SELECTOR =
  'input, textarea, button, [role="combobox"], [contenteditable="true"], [data-connection-port="true"]'
/** Altura del header del NodeCard donde sale/entra la línea (centro del ícono). */
const CARD_AXIS_PX = 28
/**
 * Gaps entre columnas/filas del auto-layout. Generosos a propósito —
 * cards expandidos con bubble preview pueden medir 250-350px de alto,
 * así que el gap vertical tiene que cubrir ese caso o se ven encimados
 * apenas el usuario abre uno. El horizontal deja espacio cómodo para
 * que las pastillas de etiqueta (si vuelven) y los conectores
 * respiren.
 */
const CARD_GAP_X = 220
const CARD_GAP_Y = 360
/** Posición fija del disparador. No es draggeable (no se persiste). */
const TRIGGER_POS = { x: 80, y: 240 }
const TRIGGER_WIDTH = 260
/**
 * Altura estimada de un card colapsado (header + bubble preview chico).
 * Usada para distribuir verticalmente los puntos de salida de un nodo
 * con varias ramas — cada rama nace de su slot dentro del card, no de
 * un único punto. Aproximación: el bubble preview agrega ~60-180px
 * según el tipo.
 */
const CARD_BODY_PX = 90

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

/**
 * Estado del drag-to-connect: el usuario apretó el mousedown sobre un
 * port, todavía no soltó. El "from" se ancla al port; "cursor" se
 * actualiza con el mouse mientras se mueve.
 */
interface ConnectingState {
  fromNodeKey: string
  fromKind: "button" | "list_row" | "cta" | "text"
  fromIdx: number
  fromX: number
  fromY: number
  cursorX: number
  cursorY: number
}

function FlowCanvas(props: FlowTreeProps) {
  const { scale, tx, ty } = useCanvasTransform()
  const canvasRef = useRef<HTMLDivElement>(null)
  const nodesByKey = useMemo(() => {
    const m = new Map<string, BuilderNode>()
    for (const n of props.allNodes) m.set(n.node_key, n)
    return m
  }, [props.allNodes])

  // ── Medición de ports: para que las líneas SVG salgan del centro
  //    exacto de cada hueco (no de un punto aproximado), medimos sus
  //    posiciones reales en el DOM y las guardamos en un Map indexed
  //    por "{nodeKey}:{kind}:{idx}". El useLayoutEffect corre después
  //    de cada commit y reconcilia el Map; sólo gatilla setState si
  //    realmente cambió algo para no entrar en loop.
  const [portPositions, setPortPositions] = useState<
    Map<string, { x: number; y: number }>
  >(new Map())
  // Alturas medidas de cada card (key = node_key, o "__trigger__").
  // Necesario para que las líneas aterricen en el CENTRO vertical real
  // del card destino — los cards expandidos pueden medir 300+px, los
  // colapsados ~90px, y usar un offset fijo dejaba el endpoint en el
  // header (visible "arriba" del card) cuando el usuario lo esperaba
  // en el medio.
  const [cardHeights, setCardHeights] = useState<Map<string, number>>(
    new Map(),
  )

  /**
   * Mide la posición de cada port DOM y la guarda en `portPositions`.
   * También mide la altura visible de cada card para que las líneas
   * aterricen en su centro vertical (no en el header). Gatillado sólo
   * cuando: cambia la lista de nodos (alguien movió/agregó/borró/
   * editó), zoom o pan cambian. La guard de diff adentro evita loops
   * si la medición no cambió.
   */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const root = canvasRef.current
    if (!root) return
    const rootRect = root.getBoundingClientRect()
    const next = new Map<string, { x: number; y: number }>()
    const nextHeights = new Map<string, number>()
    // Cada NodeCard tiene data-node-key. Adentro, cada port chip
    // (botón / fila / chip CTA / wrapper text) tiene data-port-kind.
    // El port en sí (el círculo) tiene data-connection-port="true".
    const nodes = root.querySelectorAll<HTMLElement>("[data-node-key]")
    nodes.forEach((nodeEl) => {
      const key = nodeEl.dataset.nodeKey
      if (!key) return
      // Altura del card entero — usada para centrar el endpoint.
      const cardRect = nodeEl.getBoundingClientRect()
      nextHeights.set(key, cardRect.height / scale)
      const ports = nodeEl.querySelectorAll<HTMLElement>(
        '[data-port-kind]',
      )
      // Cada port-kind chip puede tener un solo <ConnectionPort/>
      // hijo. Contamos por kind para asignar el idx — el orden de
      // aparición en el DOM coincide con el orden de getOutgoingEdges.
      const idxByKind: Record<string, number> = {}
      ports.forEach((chipEl) => {
        const kind = chipEl.dataset.portKind!
        const portEl = chipEl.querySelector<HTMLElement>(
          '[data-connection-port="true"]',
        )
        if (!portEl) return
        const idx = idxByKind[kind] ?? 0
        idxByKind[kind] = idx + 1
        const r = portEl.getBoundingClientRect()
        // Convertimos de coord cliente a coord lienzo dividiendo
        // por scale (el wrapper aplica transform: scale()).
        const x = (r.left + r.width / 2 - rootRect.left) / scale
        const y = (r.top + r.height / 2 - rootRect.top) / scale
        next.set(`${key}:${kind}:${idx}`, { x, y })
      })
    })
    // Trigger card — sin data-node-key pero medible por su prop ref.
    // Lo identificamos por la clase de su wrapper (DraggableTriggerWrapper
    // setea width=TRIGGER_WIDTH inline).
    const triggerEl = root.querySelector<HTMLElement>(
      '[data-trigger-card="true"]',
    )
    if (triggerEl) {
      nextHeights.set(
        "__trigger__",
        triggerEl.getBoundingClientRect().height / scale,
      )
    }

    // Diff vs previo: sólo actualizamos state si cambió algo. Sin esto,
    // useLayoutEffect → setState → re-render → useLayoutEffect = loop.
    // El check de cambio convergente garantiza terminar en 1-2 frames.
    let changed = portPositions.size !== next.size
    if (!changed) {
      for (const [k, v] of next) {
        const prev = portPositions.get(k)
        if (!prev || Math.abs(prev.x - v.x) > 0.5 || Math.abs(prev.y - v.y) > 0.5) {
          changed = true
          break
        }
      }
    }
    if (changed) setPortPositions(next)
    let heightsChanged = cardHeights.size !== nextHeights.size
    if (!heightsChanged) {
      for (const [k, h] of nextHeights) {
        const prev = cardHeights.get(k)
        if (prev === undefined || Math.abs(prev - h) > 0.5) {
          heightsChanged = true
          break
        }
      }
    }
    if (heightsChanged) setCardHeights(nextHeights)
  }, [props.allNodes, scale, tx, ty])

  /**
   * Mapea un edge index global (devuelto por getOutgoingEdges) al
   * (kind, idx) que el port usa. Para cada node_type el formato es
   * distinto.
   */
  function portKeyFor(
    node: BuilderNode,
    edgeIdx: number,
  ): string {
    switch (node.node_type) {
      case "send_buttons":
        return `${node.node_key}:button:${edgeIdx}`
      case "send_list":
        return `${node.node_key}:list_row:${edgeIdx}`
      case "send_cta_url":
        return `${node.node_key}:cta:0`
      default:
        // single-output kinds + logic nodes — usan el port "text" del wrapper
        return `${node.node_key}:text:0`
    }
  }

  /**
   * Calcula todas las aristas con sus coordenadas absolutas. Usa la
   * posición medida del port (si existe) o cae a un offset
   * deterministico. Re-corre cuando los nodos se mueven o los ports
   * son re-medidos.
   */
  // Centro vertical real de cada card (usa altura medida; cae a 120
  // si todavía no se midió). El endpoint de las líneas usa este Y para
  // aterrizar en la mitad del card destino, no en el header.
  const centerYOf = (key: string, position_y: number): number => {
    const h = cardHeights.get(key)
    return position_y + (h ?? 120) / 2
  }
  const edges = useMemo<CanvasEdge[]>(() => {
    const out: CanvasEdge[] = []
    if (props.entryKey && nodesByKey.has(props.entryKey)) {
      const target = nodesByKey.get(props.entryKey)!
      out.push({
        fromKey: "__trigger__",
        toKey: target.node_key,
        from: {
          x: props.triggerPosition.x + TRIGGER_WIDTH,
          y: centerYOf("__trigger__", props.triggerPosition.y),
        },
        to: {
          x: target.position_x,
          y: centerYOf(target.node_key, target.position_y),
        },
        label: null,
      })
    }
    for (const node of props.allNodes) {
      const edgeList = getOutgoingEdges(node)
      edgeList.forEach((e, idx) => {
        if (!e.nextKey) return
        const target = nodesByKey.get(e.nextKey)
        if (!target) return
        // Source: posición real del port si está medido; si no, offset
        // estimado (igual que antes — funciona como fallback durante el
        // primer paint antes de que el useLayoutEffect mida). Para
        // nodos con UNA SOLA salida (lineales y lógicos no-buttons),
        // el fallback usa el centro vertical del card medido.
        const portKey = portKeyFor(node, idx)
        const portPos = portPositions.get(portKey)
        let from: { x: number; y: number }
        if (portPos) {
          from = portPos
        } else {
          const n = edgeList.length
          const yOffset =
            n === 1
              ? (cardHeights.get(node.node_key) ?? 120) / 2
              : CARD_AXIS_PX + 28 + (idx + 0.5) * (CARD_BODY_PX / n)
          from = {
            x: node.position_x + CARD_WIDTH,
            y: node.position_y + yOffset,
          }
        }
        out.push({
          fromKey: node.node_key,
          toKey: target.node_key,
          from,
          to: {
            x: target.position_x,
            y: centerYOf(target.node_key, target.position_y),
          },
          label: e.label,
        })
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.allNodes, props.entryKey, nodesByKey, portPositions, props.triggerPosition.x, props.triggerPosition.y, cardHeights])

  // ── Estado y handlers de drag-to-connect ──
  //
  // Arquitectura del drag-to-connect (refactorizada tras review):
  //   - `connecting` (state) — tiene el "from" inmutable durante el drag.
  //     Sólo cambia cuando empieza (mousedown) y cuando termina
  //     (mouseup). Esto evita que el useEffect que ata window listeners
  //     se re-monte 60 veces por segundo.
  //   - `cursorRef` (ref) — coords actuales del cursor en coord lienzo.
  //     Se actualiza en cada mousemove sin re-render.
  //   - `tickConnecting` (state) — contador. Lo incrementamos en cada
  //     mousemove (vía rAF throttle) para gatillar el redraw de la
  //     ghost-line SVG. Como es un número simple, React no re-monta
  //     listeners.
  //   - Los handlers (`move`, `up`) leen las cosas vivas vía refs
  //     (`connectingRef`, `props` actual vía `wireRef`), nunca por
  //     closure.
  const [connecting, setConnecting] = useState<ConnectingState | null>(null)
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null)
  // Línea seleccionada (para borrarla con Delete/Backspace). El usuario
  // hace click sobre el path y queda resaltada; click en lienzo vacío
  // o sobre otro elemento la deselecciona. Una sola seleccionada por vez.
  const [selectedEdge, setSelectedEdge] = useState<{
    fromKey: string
    kind: "button" | "list_row" | "cta" | "text"
    idx: number
  } | null>(null)
  const cursorRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  /** Última coord cliente vista (no canvas) — para recomputar cursorRef
   *  cuando el usuario hace wheel-pan / zoom sin mover el mouse. */
  const lastClientRef = useRef<{ x: number; y: number } | null>(null)
  const connectingRef = useRef<ConnectingState | null>(null)
  const wireRef = useRef(props.onWireConnection)
  useEffect(() => {
    wireRef.current = props.onWireConnection
  }, [props.onWireConnection])
  const [, forceTick] = useState(0)

  const onConnectStart = useCallback(
    (
      nodeKey: string,
      kind: "button" | "list_row" | "cta" | "text",
      idx: number,
      e: React.MouseEvent,
    ) => {
      // Leemos la posición del port directamente del DOM (e.currentTarget),
      // no del cache portPositions — el cache puede no haber medido al
      // primer click (sobre todo en nodos recién agregados).
      const portEl = e.currentTarget as HTMLElement
      const root = canvasRef.current
      if (!root) return
      const rootRect = root.getBoundingClientRect()
      const portRect = portEl.getBoundingClientRect()
      const fromX = (portRect.left + portRect.width / 2 - rootRect.left) / scale
      const fromY = (portRect.top + portRect.height / 2 - rootRect.top) / scale
      const cursorX = (e.clientX - rootRect.left) / scale
      const cursorY = (e.clientY - rootRect.top) / scale
      cursorRef.current = { x: cursorX, y: cursorY }
      const next: ConnectingState = {
        fromNodeKey: nodeKey,
        fromKind: kind,
        fromIdx: idx,
        fromX,
        fromY,
        cursorX,
        cursorY,
      }
      connectingRef.current = next
      props.connectingActiveRef.current = true
      setConnecting(next)
    },
    [scale, props.connectingActiveRef],
  )

  // Delete / Backspace borra la conexión seleccionada. Se desactiva si
  // el foco está en un input, textarea o el panel del constructor IA
  // (no queremos comer pulsaciones que el usuario está tipiando).
  useEffect(() => {
    if (!selectedEdge) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Delete" && e.key !== "Backspace") return
      const t = e.target as HTMLElement | null
      if (t && t.closest('input, textarea, [contenteditable="true"]')) return
      e.preventDefault()
      const s = selectedEdge!
      props.onWireConnection(s.fromKey, s.kind, s.idx, "")
      setSelectedEdge(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selectedEdge, props])

  // El useEffect SE MONTA UNA VEZ cuando `connecting` pasa a no-null,
  // y se desmonta cuando vuelve a null. Adentro, los handlers leen
  // todo lo vivo vía refs (cursorRef, connectingRef, wireRef) así no
  // necesitamos reattachar listeners.
  useEffect(() => {
    if (!connecting) return
    let rafQueued = false
    function flush() {
      rafQueued = false
      forceTick((c) => (c + 1) | 0)
    }
    function move(e: MouseEvent) {
      const root = canvasRef.current
      if (!root) return
      const rootRect = root.getBoundingClientRect()
      const cx = (e.clientX - rootRect.left) / scale
      const cy = (e.clientY - rootRect.top) / scale
      lastClientRef.current = { x: e.clientX, y: e.clientY }
      cursorRef.current = { x: cx, y: cy }
      // Throttle re-render a rAF — el ghost line se redibuja a
      // ~60fps sin saturar React.
      if (!rafQueued) {
        rafQueued = true
        requestAnimationFrame(flush)
      }
      // Detección de drop target (DOM-only, no necesita re-render).
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      const nodeEl = el?.closest<HTMLElement>("[data-node-key]")
      const key = nodeEl?.dataset.nodeKey ?? null
      const fromKey = connectingRef.current?.fromNodeKey
      const nextTarget = key && key !== fromKey ? key : null
      // setState SOLO si cambió — evitamos re-renders gratis.
      setDropTargetKey((prev) => (prev === nextTarget ? prev : nextTarget))
    }
    function up(e: MouseEvent) {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      const nodeEl = el?.closest<HTMLElement>("[data-node-key]")
      const toKey = nodeEl?.dataset.nodeKey ?? null
      const c = connectingRef.current
      if (toKey && c && toKey !== c.fromNodeKey) {
        wireRef.current(c.fromNodeKey, c.fromKind, c.fromIdx, toKey)
      }
      connectingRef.current = null
      props.connectingActiveRef.current = false
      setConnecting(null)
      setDropTargetKey(null)
    }
    window.addEventListener("mousemove", move)
    window.addEventListener("mouseup", up)
    return () => {
      window.removeEventListener("mousemove", move)
      window.removeEventListener("mouseup", up)
    }
    // Sólo nos importa "empezó/terminó" (boolean) + scale (lectura del
    // coord). NO depemos del objeto `connecting` entero ni de `props`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!connecting, scale])

  /**
   * Wheel-pan / zoom mientras un drag-to-connect está activo:
   * el cursor del mouse no se mueve pero tx/ty/scale cambian, así
   * que la línea fantasma se "despegaba" del cursor. Re-derivamos
   * cursorRef desde lastClientRef cada vez que cambian las
   * transformaciones, y forzamos un re-render.
   */
  useEffect(() => {
    if (!connecting) return
    const lc = lastClientRef.current
    const root = canvasRef.current
    if (!lc || !root) return
    const rootRect = root.getBoundingClientRect()
    cursorRef.current = {
      x: (lc.x - rootRect.left) / scale,
      y: (lc.y - rootRect.top) / scale,
    }
    forceTick((c) => (c + 1) | 0)
  }, [tx, ty, scale, connecting])

  // Caja virtual del lienzo
  const CANVAS_W = 6000
  const CANVAS_H = 4000

  return (
    <div
      ref={canvasRef}
      className="relative"
      style={{ width: CANVAS_W, height: CANVAS_H }}
      onMouseDown={(e) => {
        // Click en lienzo vacío (no sobre card, port o línea):
        // deselecciona tanto la conexión activa como la selección
        // múltiple de nodos.
        if (e.target === e.currentTarget) {
          if (selectedEdge) setSelectedEdge(null)
          if (props.selectedNodeKeys.size > 0) props.onClearMultiSelect()
        }
      }}
    >
      <svg
        className="absolute inset-0 text-muted-foreground"
        width={CANVAS_W}
        height={CANVAS_H}
        style={{ pointerEvents: "none" }}
        // overflow="visible" — el SVG por default tiene overflow:hidden
        // y recorta cualquier path que se salga de su rect (0..CANVAS_W
        // x 0..CANVAS_H). Si el usuario arrastró un nodo a una posición
        // negativa o más allá del límite (o si dos nodos en extremos
        // opuestos producen un bezier con control points fuera del
        // rect), parte de la línea desaparecía mid-canvas. Con
        // overflow:visible las paths se pintan completas y el clipping
        // queda a cargo del CanvasViewport contenedor.
        overflow="visible"
      >
        {/* Marker definitions — la flecha al final de cada conexión.
            refX=9 dentro del viewBox 0-10 deja la punta exactamente
            en el endpoint. El `fill="currentColor"` hereda el
            text-muted-foreground del <svg>, que matchea el stroke
            (también muted-foreground) — así flecha y línea son
            visualmente el mismo color y se ven más blancas que el
            border viejo. */}
        <defs>
          <marker
            id="flow-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerUnits="strokeWidth"
            markerWidth="4.5"
            markerHeight="4.5"
            orient="auto-start-reverse"
          >
            {/* Fill heredado del stroke del path (var(--muted-foreground)
                con opacidad 0.7). Usamos `fill="currentColor"` y dejamos
                que el SVG <g> de arriba lo defina via `color`. */}
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          // Edge desde el disparador no tiene fromNode en el grafo y no
          // se puede seleccionar/borrar desde acá (la "conexión" del
          // disparador la maneja entry_node_id en la fila del flujo).
          if (e.fromKey === "__trigger__") {
            return <ConnectorPath key={i} edge={e} />
          }
          const fromNode = nodesByKey.get(e.fromKey)
          if (!fromNode) {
            return <ConnectorPath key={i} edge={e} />
          }
          // Mapeamos el toKey de la edge al índice dentro de
          // getOutgoingEdges para identificar el slot (botón #2, fila
          // #3, etc.). Si hay duplicados (dos botones al mismo destino)
          // tomamos el primero — el comportamiento es consistente con
          // computeExclusiveSubtree y permite Delete sobre el "primero
          // que coincide", que es lo que el usuario espera ver
          // resaltado primero.
          const outgoing = getOutgoingEdges(fromNode)
          const edgeIdx = outgoing.findIndex((og) => og.nextKey === e.toKey)
          if (edgeIdx === -1) {
            return <ConnectorPath key={i} edge={e} />
          }
          const portKey = (() => {
            switch (fromNode.node_type) {
              case "send_buttons":
                return { kind: "button" as const, idx: edgeIdx }
              case "send_list":
                return { kind: "list_row" as const, idx: edgeIdx }
              case "send_cta_url":
                return { kind: "cta" as const, idx: 0 }
              default:
                return { kind: "text" as const, idx: 0 }
            }
          })()
          const isSelected =
            selectedEdge !== null &&
            selectedEdge.fromKey === e.fromKey &&
            selectedEdge.kind === portKey.kind &&
            selectedEdge.idx === portKey.idx
          return (
            <g key={i}>
              <ConnectorPath edge={e} highlighted={isSelected} />
              {/* Hit target invisible 22px de ancho — el click sobre
                  la línea visible (2.5px) es muy frágil; este target
                  oculto agarra clicks cerca de la línea sin alterar
                  el visual. */}
              <ConnectorPath
                edge={e}
                hitTarget
                onClick={(evt) => {
                  evt.stopPropagation()
                  setSelectedEdge({
                    fromKey: e.fromKey,
                    kind: portKey.kind,
                    idx: portKey.idx,
                  })
                }}
              />
            </g>
          )
        })}
        {connecting && (
          <ConnectorPath
            edge={{
              fromKey: "__connecting__",
              toKey: "__cursor__",
              from: { x: connecting.fromX, y: connecting.fromY },
              // cursor vivo via ref — el rAF tick fuerza el re-render
              // de esta línea sin tocar `connecting`.
              to: { x: cursorRef.current.x, y: cursorRef.current.y },
              label: null,
            }}
            dashed
            color="#00a5f4"
          />
        )}
      </svg>

      <DraggableTriggerWrapper
        position={props.triggerPosition}
        onMove={props.onTriggerMove}
        onDragStart={props.onSnapshotHistory}
      >
        <CanvasTriggerCard
          triggerType={props.triggerType}
          triggerConfig={props.triggerConfig}
          triggerIssues={props.triggerIssues}
          onChange={props.onTriggerChange}
        />
      </DraggableTriggerWrapper>

      {props.allNodes.map((node) => (
        <DraggableNode
          key={node.node_key}
          node={node}
          allNodes={props.allNodes}
          isEntry={props.entryNodeId === node.node_key}
          isFlashed={props.flashedKey === node.node_key}
          isDropTarget={dropTargetKey === node.node_key}
          isSelected={props.selectedNodeKeys.has(node.node_key)}
          isUnreachable={props.liveLinter.unreachable.has(node.node_key)}
          hasLiveError={props.liveLinter.nodesWithError.has(node.node_key)}
          analyticsCount={
            props.analyticsOverlay.active
              ? (props.analyticsOverlay.byNode[node.node_key] ?? 0)
              : null
          }
          cardRef={props.setNodeRef(node.node_key)}
          issues={
            props.silenced.has(node.node_key)
              ? []
              : props.issues.filter(
                  (i) => i.scope === "node" && i.node_key === node.node_key,
                )
          }
          onMove={(x, y) => props.onMove(node.node_key, x, y)}
          onDragStart={() => props.onSnapshotHistory()}
          onSelect={(additive) => props.onSelectNode(node.node_key, additive)}
          onUpdate={(patch) => props.onUpdate(node.node_key, patch)}
          onUpdateConfig={(patch) =>
            props.onUpdateConfig(node.node_key, patch)
          }
          onConnectStart={(kind, idx, e) =>
            onConnectStart(node.node_key, kind, idx, e)
          }
          onDuplicate={() => props.onDuplicate(node.node_key)}
          onRemove={() => props.onRemove(node.node_key)}
          onSetEntry={() => props.onSetEntry(node.node_key)}
        />
      ))}
    </div>
  )
}

function ConnectorPath({
  edge,
  dashed = false,
  color,
  highlighted = false,
  hitTarget = false,
  onClick,
}: {
  edge: CanvasEdge
  dashed?: boolean
  color?: string
  /** Estado seleccionado — se pinta más gruesa y en color de acento. */
  highlighted?: boolean
  /** Path invisible de 22px para captar el click cerca de la línea
   *  sin necesidad de apuntar exacto sobre los 2.5px del trazo. */
  hitTarget?: boolean
  onClick?: (e: React.MouseEvent) => void
}) {
  const dx = Math.max(40, (edge.to.x - edge.from.x) * 0.35)
  const d = `M ${edge.from.x} ${edge.from.y} C ${edge.from.x + dx} ${edge.from.y}, ${edge.to.x - dx} ${edge.to.y}, ${edge.to.x} ${edge.to.y}`
  if (hitTarget) {
    return (
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={22}
        strokeLinecap="round"
        style={{ cursor: "pointer", pointerEvents: "stroke" }}
        onClick={onClick}
      />
    )
  }
  const strokeColor = highlighted
    ? "#00a5f4"
    : color ?? "var(--muted-foreground)"
  return (
    <path
      d={d}
      fill="none"
      stroke={strokeColor}
      strokeOpacity={highlighted || color ? 1 : 0.7}
      strokeWidth={highlighted ? 3.5 : dashed ? 2 : 2.5}
      strokeLinecap="round"
      strokeDasharray={dashed ? "5 4" : undefined}
      markerEnd={dashed ? undefined : "url(#flow-arrow)"}
    />
  )
}

interface DraggableNodeProps {
  node: BuilderNode
  allNodes: BuilderNode[]
  isEntry: boolean
  isFlashed: boolean
  isDropTarget: boolean
  /** True cuando el nodo está en el set de seleccionados multi. */
  isSelected: boolean
  /** Live linter: halo amarillo si el flujo no lo alcanza. */
  isUnreachable: boolean
  /** Live linter: punto rojo si el nodo tiene al menos un error. */
  hasLiveError: boolean
  /** Overlay de analítica: si !== null, se renderiza el badge con
   *  el conteo de entries de los últimos 7 días en el nodo. */
  analyticsCount: number | null
  cardRef: (el: HTMLDivElement | null) => void
  issues: ValidationIssue[]
  onMove: (x: number, y: number) => void
  onDragStart: () => void
  /** Llamado en mousedown sobre el card. `additive=true` si Shift estaba
   *  presionado (toggle), false si fue click normal (selecciona solo). */
  onSelect: (additive: boolean) => void
  onUpdate: (patch: Partial<BuilderNode>) => void
  onUpdateConfig: (patch: Record<string, unknown>) => void
  onConnectStart: (
    kind: "button" | "list_row" | "cta" | "text",
    idx: number,
    e: React.MouseEvent,
  ) => void
  onDuplicate: () => void
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
      const t = e.target as HTMLElement
      if (
        t.closest(DRAG_BLOCK_SELECTOR)
      ) {
        return
      }
      // Selección por click: si Shift, toggle dentro del set; si no,
      // reemplaza (solo este nodo). Lo notificamos ANTES de empezar
      // el drag para que la selección visual se aplique en el primer
      // frame del arrastre.
      props.onSelect(e.shiftKey)
      e.preventDefault()
      e.stopPropagation()
      startRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        nodeX: props.node.position_x,
        nodeY: props.node.position_y,
      }
      // Notificamos para snapshot a undo stack ANTES del primer move.
      props.onDragStart()
      setDragging(true)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        "absolute select-none transition-transform",
        dragging
          ? "z-30 cursor-grabbing shadow-2xl shadow-black/40"
          : "cursor-grab",
        dragging && "scale-[1.02]",
        props.isSelected &&
          "rounded-lg ring-2 ring-[#00a5f4] ring-offset-2 ring-offset-background",
        // Halo amarillo punteado para nodos inalcanzables. Pasivo
        // (siempre visible mientras lo sean) sin gate de validación.
        props.isUnreachable &&
          !props.isSelected &&
          "rounded-lg outline-dashed outline-2 outline-amber-500/60 outline-offset-2",
      )}
      style={{
        left: props.node.position_x,
        top: props.node.position_y,
        width: CARD_WIDTH,
      }}
      onMouseDown={onDragMouseDown}
    >
      {/* Punto rojo en la esquina superior izquierda si hay errores en
          vivo. No reemplaza el panel inferior — es solo un avisador. */}
      {props.hasLiveError && (
        <span
          aria-label="Tiene errores"
          className="absolute -left-1 -top-1 z-20 size-2.5 rounded-full bg-red-500 ring-2 ring-background"
        />
      )}
      {/* Badge de analítica (toggle desde el header). Esquina sup
          derecha. Muestra entries de los últimos 7 días. */}
      {props.analyticsCount !== null && (
        <span
          className={cn(
            "absolute -right-1 -top-2 z-20 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-2 ring-background",
            props.analyticsCount > 0
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
              : "bg-muted text-muted-foreground",
          )}
          title={`${props.analyticsCount} entradas en 7 días`}
        >
          {props.analyticsCount}
        </span>
      )}
      <NodeCard
        node={props.node}
        allNodes={props.allNodes}
        isEntry={props.isEntry}
        isFlashed={props.isFlashed}
        isDropTarget={props.isDropTarget}
        cardRef={props.cardRef}
        issues={props.issues}
        onUpdate={props.onUpdate}
        onUpdateConfig={props.onUpdateConfig}
        onConnectStart={props.onConnectStart}
        onDuplicate={props.onDuplicate}
        onRemove={props.onRemove}
        onSetEntry={props.onSetEntry}
      />
      {/* Tail visual a nivel CARD: línea + "⊕" del borde derecho. Solo
          para nodos de UNA sola salida (send_message, customer_reply,
          collect_input, etc.). Los nodos con MÚLTIPLES outputs ya tienen
          su tail por cada slot dentro del LogicNodeBody. El nodo Fin
          no lleva tail (es terminal). El tail solo aparece cuando la
          salida única todavía no está conectada. */}
      {hasSingleUnconnectedOutput(props.node) &&
        props.node.node_type !== "end" && (
          <QuickAddTail
            parentKey={props.node.node_key}
            kind="text"
            idx={0}
          />
        )}
    </div>
  )
}

/**
 * Wrapper draggeable para el CanvasTriggerCard. Misma mecánica que
 * DraggableNode pero sin labels/issues — solo posiciona y mueve. El
 * disparador no es un nodo así que no recibe `onConnectStart` /
 * `onRemove` / etc.; sólo posición + onMove.
 *
 * Los inputs internos del card (selector de tipo, textbox de keyword)
 * NO disparan el drag — el guard por selector replica el que usa
 * DraggableNode (input, textarea, button, role=combobox, etc.).
 */
function DraggableTriggerWrapper({
  position,
  onMove,
  onDragStart,
  children,
}: {
  position: { x: number; y: number }
  onMove: (x: number, y: number) => void
  onDragStart: () => void
  children: React.ReactNode
}) {
  const { scale } = useCanvasTransform()
  const [dragging, setDragging] = useState(false)
  const startRef = useRef<{
    mouseX: number
    mouseY: number
    nodeX: number
    nodeY: number
  } | null>(null)

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      const t = e.target as HTMLElement
      if (t.closest(DRAG_BLOCK_SELECTOR)) {
        return
      }
      e.preventDefault()
      e.stopPropagation()
      startRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        nodeX: position.x,
        nodeY: position.y,
      }
      onDragStart()
      setDragging(true)
    },
    [position.x, position.y, onDragStart],
  )

  useEffect(() => {
    if (!dragging) return
    function move(e: MouseEvent) {
      const s = startRef.current
      if (!s) return
      const dx = (e.clientX - s.mouseX) / scale
      const dy = (e.clientY - s.mouseY) / scale
      onMove(s.nodeX + dx, s.nodeY + dy)
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
  }, [dragging, scale, onMove])

  return (
    <div
      className={cn(
        "absolute select-none transition-transform",
        dragging
          ? "z-30 cursor-grabbing shadow-2xl shadow-black/40"
          : "cursor-grab",
        dragging && "scale-[1.02]",
      )}
      style={{
        left: position.x,
        top: position.y,
        width: TRIGGER_WIDTH,
      }}
      onMouseDown={onMouseDown}
    >
      {children}
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
    case "customer_reply":
    case "subflow":
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
  silenced: Set<string>
  expanded: Set<string>
  entryNodeId: string | null
  flashedKey: string | null
  issues: ValidationIssue[]
  setNodeRef: (key: string) => (el: HTMLDivElement | null) => void
  onToggle: (key: string) => void
  onUpdate: (key: string, patch: Partial<BuilderNode>) => void
  onUpdateConfig: (key: string, patch: Record<string, unknown>) => void
  onMove: (key: string, x: number, y: number) => void
  /** Snapshot pre-drag para el undo stack. */
  onSnapshotHistory: () => void
  /** Wire una conexión disparada por drag-to-connect. */
  onWireConnection: (
    fromKey: string,
    kind: "button" | "list_row" | "cta" | "text",
    idx: number,
    toKey: string,
  ) => void
  /**
   * Ref que FlowBuilder lee desde el keydown handler (Ctrl+Z) para
   * bloquear undo/redo durante un drag-to-connect activo. FlowCanvas
   * lo marca true en onConnectStart y false en mouseup.
   */
  connectingActiveRef: React.MutableRefObject<boolean>
  onDuplicate: (key: string) => void
  onRemove: (key: string) => void
  onSetEntry: (key: string) => void
  /** Linter en vivo: nodos inalcanzables (halo amarillo) + nodos con
   *  errores (punto rojo). Independiente del gate showValidation. */
  liveLinter: { unreachable: Set<string>; nodesWithError: Set<string> }
  /** Si está activo, se renderiza un badge con la cantidad de
   *  entries del nodo en los últimos 7 días encima del card. */
  analyticsOverlay: { active: boolean; byNode: Record<string, number> }
  /** Set de node_keys seleccionados por Shift+click. Si el set tiene
   *  un nodo, su card aterriza con borde de acento. */
  selectedNodeKeys: Set<string>
  /** Llamado en mousedown del card. additive=true cuando el usuario
   *  está manteniendo Shift (toggle dentro del set), false cuando
   *  es un click normal (resetea a solo ese nodo). */
  onSelectNode: (key: string, additive: boolean) => void
  /** Limpia el set entero — llamado cuando el usuario hace click
   *  sobre lienzo vacío. */
  onClearMultiSelect: () => void
  onAdd: (
    type: NodeType,
    wireFrom?: {
      parentKey: string;
      kind: "text" | "button" | "list_row" | "cta";
      idx: number;
    },
  ) => void
  triggerType: BuilderState["trigger_type"]
  triggerConfig: Record<string, unknown>
  triggerIssues: ValidationIssue[]
  onTriggerChange: (
    type: BuilderState["trigger_type"],
    config: Record<string, unknown>,
  ) => void
  /** Posición actual del disparador (migration 028). */
  triggerPosition: { x: number; y: number }
  /** Mover el disparador desde el drag handler del canvas. */
  onTriggerMove: (x: number, y: number) => void
}

/**
 * Paleta flotante anclada abajo-derecha del lienzo. Despliega los
 * tipos de paso para que el usuario agregue uno sin importar qué
 * parte del flujo está mirando. El nodo recién creado aparece a la
 * derecha de todos los demás (ver addNode) — listo para arrastrar a
 * la posición que el usuario quiera y conectarlo con "Avanza a".
 */
/**
 * Diálogo que se abre cuando el usuario borra un botón/fila que
 * apunta a una cadena de pasos. Le pregunta si querer borrar también
 * esos pasos (sólo los que quedarían huérfanos — el cálculo del
 * subárbol exclusivo vive en el FlowBuilder).
 */
function CascadeDeleteDialog({
  open,
  downstreamCount,
  kind,
  onClose,
  onConfirmButtonOnly,
  onConfirmWithDownstream,
}: {
  open: boolean;
  downstreamCount: number;
  kind: "button" | "row";
  onClose: () => void;
  onConfirmButtonOnly: () => void;
  onConfirmWithDownstream: () => void;
}) {
  const noun = kind === "button" ? "botón" : "opción";
  const stepsLabel =
    downstreamCount === 1 ? "1 paso" : `${downstreamCount} pasos`;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Borrar también los pasos siguientes?</DialogTitle>
          <DialogDescription>
            {downstreamCount > 0 ? (
              <>
                Este {noun} conecta con {stepsLabel} que sólo se usan
                desde acá. Si lo borras solo, esos pasos van a quedar
                desconectados (y te van a aparecer como pasos sueltos).
              </>
            ) : (
              <>
                Este {noun} apunta a un paso que también usan otras ramas,
                así que solo borraremos el {noun} — los pasos siguientes
                quedan intactos.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="outline" onClick={onConfirmButtonOnly}>
            Sólo el {noun}
          </Button>
          {downstreamCount > 0 && (
            <Button variant="destructive" onClick={onConfirmWithDownstream}>
              Borrar el {noun} y los {stepsLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
  keyword: "Contiene una palabra clave",
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
      data-trigger-card="true"
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
          <Zap className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">
              Cuándo dispara
            </span>
            {hasError && (
              <CircleAlert className="h-3 w-3 shrink-0 text-red-600 dark:text-red-400" />
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
                  Contiene una palabra clave
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
                    i.severity === "error" ? "text-red-600 dark:text-red-300" : "text-amber-700 dark:text-amber-300",
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
