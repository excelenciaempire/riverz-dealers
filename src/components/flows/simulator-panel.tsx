"use client";

/**
 * Simulador WhatsApp embebido en el canvas. Convierte el flujo en
 * una conversación viva donde el merchant tipea como cliente y ve
 * exactamente lo que el bot mandaría, con los valores reales de las
 * variables.
 *
 * No es el engine completo (no toca DB, no llama a Meta) — es una
 * versión client-side que cubre los casos de uso del 90%:
 *   - send_message: muestra el bubble + auto-avanza.
 *   - send_buttons: muestra el bubble con botones tocables.
 *   - send_list: muestra el bubble con opciones tocables.
 *   - send_cta_url: muestra el bubble con CTA.
 *   - send_image / send_video / send_document: card de media.
 *   - collect_input: pide texto al usuario; lo guarda en vars[var_key].
 *   - customer_reply: espera el próximo mensaje y avanza.
 *   - condition: evalúa con las vars actuales.
 *   - set_tag, wait, handoff, end: muestra una nota informativa.
 *   - shopify_lookup, ai_intent: skip con nota (requieren backend).
 *
 * Las variables vivas se muestran en la parte de arriba para que el
 * merchant verifique que su {{vars.X}} matchea lo que escribió.
 *
 * Replay: el botón "Reiniciar" vuelve al entry. "Restart from node"
 * por click sobre un mensaje del historial (futuro).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  RefreshCw,
  X,
  Send,
  Bot,
  User as UserIcon,
  CheckCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface FlowNode {
  node_key: string;
  node_type: string;
  config: Record<string, unknown>;
}

interface Msg {
  from: "bot" | "user" | "system";
  kind: "text" | "buttons" | "list" | "cta" | "media" | "note";
  text?: string;
  buttons?: Array<{ label: string; replyId: string; nextKey?: string }>;
  listRows?: Array<{ label: string; replyId: string; nextKey?: string }>;
  url?: string;
  ctaLabel?: string;
}

interface SimulatorState {
  vars: Record<string, string>;
  history: Msg[];
  currentKey: string | null;
  /** Cuando el bot está esperando respuesta del usuario. */
  awaiting: "text" | "button_or_list" | null;
  /** Si awaiting === 'text', es customer_reply o collect_input — en
   *  el segundo caso guardamos el value en vars[varKey]. */
  pendingVarKey: string | null;
  /** Acumulador para detectar bucles infinitos en autotransiciones. */
  hops: number;
}

const MAX_HOPS = 50;

export function SimulatorPanel({
  nodes,
  entryKey,
  triggerType,
  triggerConfig,
  onClose,
}: {
  nodes: FlowNode[];
  entryKey: string | null;
  triggerType: "keyword" | "first_inbound_message" | "manual";
  triggerConfig: Record<string, unknown>;
  onClose: () => void;
}) {
  const nodesByKey = useMemo(() => {
    const m = new Map<string, FlowNode>();
    for (const n of nodes) m.set(n.node_key, n);
    return m;
  }, [nodes]);

  const [state, setState] = useState<SimulatorState>(() => initial());
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  function initial(): SimulatorState {
    return {
      vars: {},
      history: [],
      currentKey: null,
      awaiting: null,
      pendingVarKey: null,
      hops: 0,
    };
  }

  function start() {
    if (!entryKey) {
      setState({
        ...initial(),
        history: [
          {
            from: "system",
            kind: "note",
            text: "El flujo no tiene un paso de entrada definido. Marca uno y vuelve a intentar.",
          },
        ],
      });
      return;
    }
    const next = advance({ ...initial(), currentKey: entryKey });
    setState(next);
  }

  // Reset al cambiar el flujo.
  useEffect(() => {
    setState(initial());
  }, [entryKey, nodes]);

  useEffect(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }, [state.history]);

  /**
   * Avanza el state ejecutando nodos auto-transicionales (send_message,
   * send_image, set_tag, wait, etc.) hasta que cae en un nodo que pide
   * input del usuario (send_buttons, send_list, collect_input,
   * customer_reply) o en un nodo terminal (handoff, end).
   */
  function advance(s: SimulatorState): SimulatorState {
    let next = { ...s };
    while (next.currentKey && next.hops < MAX_HOPS) {
      next.hops++;
      const node = nodesByKey.get(next.currentKey);
      if (!node) {
        next.history = [
          ...next.history,
          {
            from: "system",
            kind: "note",
            text: `Paso "${next.currentKey}" no encontrado. El flujo termina aquí.`,
          },
        ];
        next.currentKey = null;
        break;
      }
      const cfg = node.config as Record<string, unknown>;
      switch (node.node_type) {
        case "send_message": {
          const text = interpolate(String(cfg.text ?? ""), next.vars);
          next.history = [
            ...next.history,
            { from: "bot", kind: "text", text },
          ];
          next.currentKey = (cfg.next_node_key as string) || null;
          break;
        }
        case "send_buttons": {
          const text = interpolate(String(cfg.text ?? ""), next.vars);
          const btns = Array.isArray(cfg.buttons) ? (cfg.buttons as Array<{ reply_id?: string; title?: string; next_node_key?: string }>) : [];
          next.history = [
            ...next.history,
            {
              from: "bot",
              kind: "buttons",
              text,
              buttons: btns.map((b) => ({
                label: b.title || b.reply_id || "Botón",
                replyId: b.reply_id || "",
                nextKey: b.next_node_key,
              })),
            },
          ];
          next.awaiting = "button_or_list";
          return next;
        }
        case "send_list": {
          const text = interpolate(String(cfg.text ?? ""), next.vars);
          const sections = Array.isArray(cfg.sections) ? (cfg.sections as Array<{ rows?: Array<{ reply_id?: string; title?: string; next_node_key?: string }> }>) : [];
          const rows = sections.flatMap((sec) => sec.rows ?? []);
          next.history = [
            ...next.history,
            {
              from: "bot",
              kind: "list",
              text,
              listRows: rows.map((r) => ({
                label: r.title || r.reply_id || "Opción",
                replyId: r.reply_id || "",
                nextKey: r.next_node_key,
              })),
            },
          ];
          next.awaiting = "button_or_list";
          return next;
        }
        case "send_cta_url": {
          const text = interpolate(String(cfg.text ?? ""), next.vars);
          next.history = [
            ...next.history,
            {
              from: "bot",
              kind: "cta",
              text,
              url: String(cfg.url ?? ""),
              ctaLabel: String(cfg.button_title ?? "Ver más"),
            },
          ];
          next.currentKey = (cfg.next_node_key as string) || null;
          break;
        }
        case "send_image":
        case "send_video":
        case "send_document": {
          const caption = interpolate(String(cfg.caption ?? cfg.url ?? ""), next.vars);
          next.history = [
            ...next.history,
            {
              from: "bot",
              kind: "media",
              text: caption || "Adjunto",
              url: String(cfg.url ?? ""),
            },
          ];
          next.currentKey = (cfg.next_node_key as string) || null;
          break;
        }
        case "collect_input": {
          const prompt = interpolate(String(cfg.prompt_text ?? ""), next.vars);
          if (prompt) {
            next.history = [
              ...next.history,
              { from: "bot", kind: "text", text: prompt },
            ];
          }
          next.awaiting = "text";
          next.pendingVarKey = (cfg.var_key as string) || null;
          return next;
        }
        case "customer_reply": {
          next.history = [
            ...next.history,
            {
              from: "system",
              kind: "note",
              text: "Esperando respuesta del cliente.",
            },
          ];
          next.awaiting = "text";
          next.pendingVarKey = null;
          return next;
        }
        case "condition": {
          const c = cfg as {
            subject?: string;
            subject_key?: string;
            operator?: string;
            value?: string;
            true_next?: string;
            false_next?: string;
          };
          const subjectVal =
            c.subject === "var"
              ? next.vars[c.subject_key ?? ""] ?? ""
              : "(no evaluable en sim)";
          let result = false;
          if (c.operator === "equals") result = subjectVal === (c.value ?? "");
          else if (c.operator === "contains")
            result = subjectVal
              .toLowerCase()
              .includes((c.value ?? "").toLowerCase());
          else if (c.operator === "present") result = !!subjectVal;
          else if (c.operator === "absent") result = !subjectVal;
          next.history = [
            ...next.history,
            {
              from: "system",
              kind: "note",
              text: `Condición evaluada: ${subjectVal} ${c.operator} ${c.value ?? ""} → ${result ? "Sí" : "No"}`,
            },
          ];
          next.currentKey = result ? c.true_next ?? null : c.false_next ?? null;
          break;
        }
        case "set_tag": {
          const c = cfg as { mode?: string; tag_id?: string; next_node_key?: string };
          next.history = [
            ...next.history,
            {
              from: "system",
              kind: "note",
              text: `${c.mode === "remove" ? "Quita" : "Asigna"} etiqueta ${c.tag_id ?? ""}`,
            },
          ];
          next.currentKey = c.next_node_key ?? null;
          break;
        }
        case "wait": {
          const c = cfg as { amount?: number; unit?: string; next_node_key?: string };
          next.history = [
            ...next.history,
            {
              from: "system",
              kind: "note",
              text: `Espera ${c.amount ?? 0} ${c.unit ?? "minutos"} (simulado, sin pausa real).`,
            },
          ];
          next.currentKey = c.next_node_key ?? null;
          break;
        }
        case "shopify_lookup": {
          const c = cfg as {
            kind?: string;
            output_prefix?: string;
            found_next_key?: string;
            not_found_next_key?: string;
          };
          const prefix = c.output_prefix || "order";
          next.vars = {
            ...next.vars,
            [`${prefix}_name`]: "#1042",
            [`${prefix}_total`]: "120000",
            [`${prefix}_status_url`]: "https://example.com/orders/1042",
          };
          next.history = [
            ...next.history,
            {
              from: "system",
              kind: "note",
              text: `Buscar en Shopify (${c.kind ?? "?"}) — simulado como encontrado. Vars: ${prefix}_*`,
            },
          ];
          next.currentKey = c.found_next_key ?? null;
          break;
        }
        case "ai_intent": {
          const c = cfg as {
            intents?: Array<{ intent_key?: string; next_node_key?: string }>;
            fallback_next_key?: string;
          };
          next.history = [
            ...next.history,
            {
              from: "system",
              kind: "note",
              text: `IA: se necesita una respuesta para clasificar. Sim usa fallback.`,
            },
          ];
          next.currentKey = c.fallback_next_key ?? c.intents?.[0]?.next_node_key ?? null;
          break;
        }
        case "subflow": {
          const c = cfg as { sub_flow_id?: string; next_node_key?: string };
          // En el simulador no tenemos los nodos del flujo referenciado
          // (necesitaría un fetch a /api/flows/[sub_flow_id] con sus
          // nodos). Marcamos el invoke y avanzamos al next como
          // approximation. La ejecución completa del subflujo en
          // runtime real ya funciona en el engine (call_stack +
          // switch de nodos mid-run, migration 033).
          next.history = [
            ...next.history,
            {
              from: "system",
              kind: "note",
              text: `Subflujo invocado (${c.sub_flow_id ?? "sin id"}). El simulador no carga los nodos del subflujo todavía; se continúa al siguiente paso del padre.`,
            },
          ];
          next.currentKey = c.next_node_key ?? null;
          break;
        }
        case "handoff":
        case "end":
        case "start":
        default: {
          if (node.node_type === "handoff") {
            next.history = [
              ...next.history,
              {
                from: "system",
                kind: "note",
                text: "Se pasa al equipo humano. Fin de la simulación.",
              },
            ];
          } else if (node.node_type === "end") {
            next.history = [
              ...next.history,
              { from: "system", kind: "note", text: "Fin del flujo." },
            ];
          } else if (node.node_type === "start") {
            const c = cfg as { next_node_key?: string };
            next.currentKey = c.next_node_key ?? null;
            continue;
          }
          next.currentKey = null;
          return next;
        }
      }
    }
    if (next.hops >= MAX_HOPS) {
      next.history = [
        ...next.history,
        {
          from: "system",
          kind: "note",
          text: `Posible bucle: el flujo recorrió ${MAX_HOPS} pasos sin pausa. Revísalo.`,
        },
      ];
      next.currentKey = null;
    }
    return next;
  }

  function handleButtonReply(b: { label: string; replyId: string; nextKey?: string }) {
    setState((s) => {
      const after = {
        ...s,
        history: [...s.history, { from: "user" as const, kind: "text" as const, text: b.label }],
        awaiting: null,
        currentKey: b.nextKey ?? null,
        hops: 0,
      };
      return advance(after);
    });
  }

  function handleTextSend(text: string) {
    if (!text.trim()) return;
    setState((s) => {
      let nextVars = s.vars;
      if (s.pendingVarKey) {
        nextVars = { ...s.vars, [s.pendingVarKey]: text };
      }
      const after: SimulatorState = {
        ...s,
        vars: nextVars,
        history: [...s.history, { from: "user", kind: "text", text }],
        awaiting: null,
        pendingVarKey: null,
        // En collect_input avanzamos al next_node_key del nodo actual.
        // El currentKey aún apunta al nodo collect_input; el config
        // tiene next_node_key.
        currentKey: (() => {
          if (!s.currentKey) return null;
          const node = nodesByKey.get(s.currentKey);
          if (!node) return null;
          const c = node.config as { next_node_key?: string };
          return c.next_node_key ?? null;
        })(),
        hops: 0,
      };
      return advance(after);
    });
    setInput("");
  }

  // Hora simulada para los timestamps del chat (HH:MM).
  const nowStamp = "10:24";

  return (
    <div className="absolute inset-y-4 right-4 z-40 flex flex-col items-center">
      {/* Header de control fuera del frame del teléfono — botones de
          reiniciar, cerrar y toggle de variables. No es parte del
          "celular" para que la ilusión visual del frame sea pareja. */}
      <div className="mb-2 flex w-[360px] items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            setState(initial());
            setTimeout(start, 0);
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
          title="Reiniciar simulación"
        >
          <RefreshCw className="size-3" />
          Reiniciar
        </button>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Simulador
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border bg-card p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Cerrar"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* Frame del teléfono. Marco negro grueso + notch + esquinas
          redondeadas que imitan un iPhone moderno. Dimensiones fijas
          (~iPhone 14 ratio: 360x720). Sombra acentuada para que se
          despegue visualmente del lienzo del editor. */}
      <div
        className="relative flex flex-col overflow-hidden rounded-[2.5rem] bg-[#111] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.55)]"
        style={{ width: 360, height: 720, padding: 12 }}
      >
        {/* Pantalla interior con borde mate. Toda la app vive dentro. */}
        <div className="relative flex h-full flex-col overflow-hidden rounded-[1.8rem] bg-[#ece5dd]">
          {/* Notch (Dynamic Island estilo). Es decorativo. */}
          <div className="pointer-events-none absolute left-1/2 top-2 z-30 h-6 w-24 -translate-x-1/2 rounded-full bg-[#111]" />

          {/* Status bar — hora + iconos de wifi / batería como un
              celular real. */}
          <div className="z-10 flex shrink-0 items-center justify-between bg-[#111] px-5 pb-2 pt-2 text-[11px] font-medium text-white">
            <span>{nowStamp}</span>
            <div className="flex items-center gap-1 opacity-80">
              <SignalIcon />
              <WifiIcon />
              <BatteryIcon />
            </div>
          </div>

          {/* Header verde de WhatsApp con avatar + nombre. */}
          <div className="z-10 flex shrink-0 items-center gap-2 bg-[#075e54] px-3 py-2 text-white">
            <ChevronLeftIcon />
            <div className="flex size-8 items-center justify-center rounded-full bg-[#128c7e] text-sm font-semibold">
              T
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">Tu tienda</p>
              <p className="text-[10px] opacity-80">en línea</p>
            </div>
            <VideoIcon />
            <PhoneIcon />
            <MenuVerticalIcon />
          </div>

          {/* Historial de mensajes con el background típico de WhatsApp
              (beige con doodles tenues). */}
          <div
            ref={scrollRef}
            className="relative flex-1 space-y-2 overflow-y-auto px-3 py-3"
            style={{
              backgroundColor: "#ece5dd",
              backgroundImage:
                "radial-gradient(rgba(0,0,0,0.04) 1px, transparent 1px)",
              backgroundSize: "12px 12px",
            }}
          >
            {state.history.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-[#7a8a91]">
                <Bot className="size-8" />
                <p className="text-xs">
                  Toca &quot;Iniciar&quot; para correr el flujo desde el inicio.
                </p>
                <button
                  type="button"
                  onClick={start}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#25d366] px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-[#1ebe5a]"
                >
                  <Play className="size-3" />
                  Iniciar
                </button>
                {triggerType === "keyword" && (
                  <p className="text-[10px] text-[#7a8a91]">
                    Disparador real: keyword{" "}
                    {Array.isArray((triggerConfig as { keywords?: string[] }).keywords)
                      ? `(${(triggerConfig as { keywords: string[] }).keywords.join(", ")})`
                      : ""}
                  </p>
                )}
              </div>
            )}
            {state.history.map((m, i) => (
              <MessageBubble
                key={i}
                msg={m}
                stamp={nowStamp}
                onButton={handleButtonReply}
              />
            ))}
          </div>

          {/* Composer estilo WhatsApp con iconos a izq/der. */}
          <div className="z-10 flex shrink-0 items-center gap-2 bg-[#f0f0f0] px-2 py-2">
            <SmileIcon />
            {state.awaiting === "text" ? (
              <>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleTextSend(input);
                    }
                  }}
                  placeholder="Mensaje"
                  className="flex-1 rounded-full border border-[#dcdcdc] bg-white px-3 py-1.5 text-sm text-[#111b21] outline-none"
                />
                <PaperclipIcon />
                <button
                  type="button"
                  onClick={() => handleTextSend(input)}
                  disabled={!input.trim()}
                  className="inline-flex size-9 items-center justify-center rounded-full bg-[#25d366] text-white shadow-sm disabled:opacity-40"
                  aria-label="Enviar"
                >
                  <Send className="size-4" />
                </button>
              </>
            ) : (
              <>
                <div
                  className="flex-1 rounded-full border border-[#dcdcdc] bg-white px-3 py-1.5 text-sm text-[#9aa6ad]"
                  aria-hidden
                >
                  Esperando bot…
                </div>
                <PaperclipIcon />
                <span
                  className="inline-flex size-9 items-center justify-center rounded-full bg-[#25d366] opacity-60"
                  aria-hidden
                >
                  <MicIcon />
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Vars panel (debajo del teléfono, no dentro). */}
      {Object.keys(state.vars).length > 0 && (
        <div className="mt-3 w-[360px] rounded-lg border border-border bg-card px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Variables capturadas
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {Object.entries(state.vars).map(([k, v]) => (
              <span
                key={k}
                className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-foreground"
              >
                <code className="text-muted-foreground">{k}</code>={v}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Iconos SVG inline minimalistas para imitar el status bar y el
// header de WhatsApp. Inline para no agregar otra dependencia.
function SignalIcon() {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" fill="currentColor">
      <rect x="0" y="6" width="2" height="4" rx="0.5" />
      <rect x="3" y="4" width="2" height="6" rx="0.5" />
      <rect x="6" y="2" width="2" height="8" rx="0.5" />
      <rect x="9" y="0" width="2" height="10" rx="0.5" />
    </svg>
  );
}
function WifiIcon() {
  return (
    <svg width="12" height="10" viewBox="0 0 12 10" fill="currentColor">
      <path d="M6 8.5a1 1 0 110 2 1 1 0 010-2zm0-3a3 3 0 012.5 1.35L7.1 8.1A1.5 1.5 0 006 7.6c-.4 0-.8.15-1.1.5L3.5 6.85A3 3 0 016 5.5zm0-3.5a6 6 0 015.2 3l-1.4 1.4A4 4 0 006 4a4 4 0 00-3.8 2.4L.8 5A6 6 0 016 2z" />
    </svg>
  );
}
function BatteryIcon() {
  return (
    <svg width="22" height="10" viewBox="0 0 22 10" fill="none" stroke="currentColor" strokeWidth="1">
      <rect x="0.5" y="0.5" width="18" height="9" rx="2" />
      <rect x="19" y="3" width="2" height="4" rx="0.5" fill="currentColor" />
      <rect x="2" y="2" width="14" height="6" fill="currentColor" />
    </svg>
  );
}
function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M10 4L6 8l4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function VideoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="5" width="10" height="8" rx="1.5" />
      <path d="M12 8l4-2v6l-4-2" strokeLinejoin="round" />
    </svg>
  );
}
function PhoneIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M3.7 1.4c.6-.2 1.3.1 1.6.7l1 2c.3.6.1 1.3-.4 1.7l-.9.7c.7 1.5 1.9 2.7 3.4 3.4l.7-.9c.4-.5 1.1-.7 1.7-.4l2 1c.6.3.9 1 .7 1.6l-.7 1.8c-.2.6-.8 1-1.4 1C5.8 14 2 10.2 2 5.4c0-.6.4-1.2 1-1.4l.7-1.6z" />
    </svg>
  );
}
function MenuVerticalIcon() {
  return (
    <svg width="4" height="16" viewBox="0 0 4 16" fill="currentColor">
      <circle cx="2" cy="3" r="1.5" />
      <circle cx="2" cy="8" r="1.5" />
      <circle cx="2" cy="13" r="1.5" />
    </svg>
  );
}
function SmileIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="#7a8a91" strokeWidth="1.5">
      <circle cx="11" cy="11" r="8" />
      <circle cx="8" cy="9" r="0.8" fill="#7a8a91" />
      <circle cx="14" cy="9" r="0.8" fill="#7a8a91" />
      <path d="M7.5 13.5c.8 1.5 2.2 2.3 3.5 2.3s2.7-.8 3.5-2.3" strokeLinecap="round" />
    </svg>
  );
}
function PaperclipIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#7a8a91" strokeWidth="1.5">
      <path d="M14.5 4.5L7 12a3 3 0 104.24 4.24L18 9.5" strokeLinecap="round" />
    </svg>
  );
}
function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="white">
      <rect x="6" y="2" width="4" height="8" rx="2" />
      <path
        d="M4 8a4 4 0 008 0M8 12v2"
        fill="none"
        stroke="white"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MessageBubble({
  msg,
  stamp,
  onButton,
}: {
  msg: Msg;
  stamp: string;
  onButton: (b: { label: string; replyId: string; nextKey?: string }) => void;
}) {
  if (msg.from === "system") {
    return (
      <div className="flex justify-center">
        <span className="rounded-md bg-[#fef6c5] px-3 py-1 text-[10px] text-[#5a4a00] shadow-sm">
          {msg.text}
        </span>
      </div>
    );
  }
  const isUser = msg.from === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "relative max-w-[78%] space-y-1 px-2 py-1.5 text-[13px] leading-snug shadow-sm",
          isUser
            ? "rounded-lg rounded-br-none bg-[#dcf8c6] text-[#111b21]"
            : "rounded-lg rounded-bl-none bg-white text-[#111b21]",
        )}
      >
        {msg.text && <p className="whitespace-pre-wrap pr-10">{msg.text}</p>}
        {msg.kind === "buttons" && msg.buttons && (
          <div className="mt-1 flex flex-col gap-1 border-t border-black/5 pt-1">
            {msg.buttons.map((b) => (
              <button
                key={b.replyId}
                onClick={() => onButton(b)}
                className="rounded-md bg-white px-2 py-1 text-[12px] font-medium text-[#075e54] hover:bg-[#f5f5f5]"
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
        {msg.kind === "list" && msg.listRows && (
          <div className="mt-1 flex flex-col gap-1 border-t border-black/5 pt-1">
            {msg.listRows.map((r) => (
              <button
                key={r.replyId}
                onClick={() => onButton(r)}
                className="rounded-md bg-white px-2 py-1 text-left text-[12px] text-[#111b21] hover:bg-[#f5f5f5]"
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
        {msg.kind === "cta" && msg.ctaLabel && (
          <a
            href={msg.url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block rounded-md bg-white px-2 py-1 text-[12px] font-medium text-[#075e54]"
          >
            {msg.ctaLabel} ↗
          </a>
        )}
        {msg.kind === "media" && msg.url && (
          <div className="mt-1 rounded bg-black/5 px-2 py-1 text-[10px] text-[#54656f]">
            {msg.url}
          </div>
        )}
        <div className="flex items-center justify-end gap-1 text-[10px] text-[#667781]">
          <span>{stamp}</span>
          {isUser && <CheckCheck className="size-3 text-[#53bdeb]" />}
        </div>
      </div>
    </div>
  );
}

function interpolate(s: string, vars: Record<string, string>): string {
  return s.replace(/\{\{\s*vars\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, k: string) =>
    vars[k] ?? "",
  );
}
