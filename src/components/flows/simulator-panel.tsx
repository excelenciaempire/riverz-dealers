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

  return (
    <div className="absolute inset-y-4 right-4 z-40 flex w-[380px] flex-col rounded-xl border border-border bg-card shadow-2xl shadow-black/40">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-md bg-emerald-500/15">
            <Play className="size-3.5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">
              Simulador WhatsApp
            </div>
            <div className="text-[10px] text-muted-foreground">
              Probá el flujo como cliente, sin tocar tu teléfono.
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Cerrar"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Vars panel */}
      {Object.keys(state.vars).length > 0 && (
        <div className="border-b border-border bg-muted/30 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Variables vivas
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {Object.entries(state.vars).map(([k, v]) => (
              <span
                key={k}
                className="rounded-full bg-card px-1.5 py-0.5 text-[10px] text-foreground"
              >
                <code className="text-muted-foreground">{k}</code>={v}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* History */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-2 overflow-y-auto bg-[#0c1418] px-3 py-3"
        style={{
          backgroundImage:
            'radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)',
          backgroundSize: '10px 10px',
        }}
      >
        {state.history.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <Bot className="size-8" />
            <p className="text-xs">
              Pulsa “Iniciar” para correr el flujo desde el inicio.
            </p>
            <button
              type="button"
              onClick={start}
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/30"
            >
              <Play className="size-3" />
              Iniciar
            </button>
            {triggerType === "keyword" && (
              <p className="text-[10px] text-muted-foreground">
                Disparador real: keyword{" "}
                {Array.isArray((triggerConfig as { keywords?: string[] }).keywords) ? `(${(triggerConfig as { keywords: string[] }).keywords.join(", ")})` : ""}
              </p>
            )}
          </div>
        )}
        {state.history.map((m, i) => (
          <MessageBubble key={i} msg={m} onButton={handleButtonReply} />
        ))}
      </div>

      {/* Footer */}
      <div className="border-t border-border bg-card px-3 py-2">
        {state.awaiting === "text" ? (
          <div className="flex items-end gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleTextSend(input);
                }
              }}
              placeholder="Escribe como cliente…"
              className="flex-1 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-sm text-foreground outline-none focus:border-foreground/30"
            />
            <button
              type="button"
              onClick={() => handleTextSend(input)}
              disabled={!input.trim()}
              className="inline-flex size-9 items-center justify-center rounded-md bg-emerald-500 text-white disabled:opacity-40"
              aria-label="Enviar"
            >
              <Send className="size-4" />
            </button>
          </div>
        ) : state.history.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              setState(initial());
              setTimeout(start, 0);
            }}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-muted px-3 py-1.5 text-xs text-foreground hover:bg-accent"
          >
            <RefreshCw className="size-3.5" />
            Reiniciar simulación
          </button>
        ) : null}
      </div>
    </div>
  );
}

function MessageBubble({
  msg,
  onButton,
}: {
  msg: Msg;
  onButton: (b: { label: string; replyId: string; nextKey?: string }) => void;
}) {
  if (msg.from === "system") {
    return (
      <div className="flex justify-center">
        <span className="rounded-full bg-white/10 px-3 py-1 text-[10px] text-white/60">
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
          "max-w-[80%] space-y-1 rounded-lg px-2.5 py-1.5 text-xs",
          isUser
            ? "rounded-br-sm bg-emerald-600 text-white"
            : "rounded-bl-sm bg-white text-gray-900",
        )}
      >
        {msg.text && <p className="whitespace-pre-wrap">{msg.text}</p>}
        {msg.kind === "buttons" && msg.buttons && (
          <div className="mt-1 flex flex-col gap-1">
            {msg.buttons.map((b) => (
              <button
                key={b.replyId}
                onClick={() => onButton(b)}
                className="rounded border border-blue-500/40 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
        {msg.kind === "list" && msg.listRows && (
          <div className="mt-1 flex flex-col gap-1">
            {msg.listRows.map((r) => (
              <button
                key={r.replyId}
                onClick={() => onButton(r)}
                className="rounded border border-gray-300 bg-gray-50 px-2 py-1 text-left text-[11px] text-gray-800 hover:bg-gray-100"
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
            className="mt-1 inline-block rounded border border-blue-500/40 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700"
          >
            {msg.ctaLabel} ↗
          </a>
        )}
        {msg.kind === "media" && msg.url && (
          <div className="mt-1 rounded bg-gray-100 px-2 py-1 text-[10px] text-gray-600">
            {msg.url}
          </div>
        )}
        {isUser && (
          <div className="mt-0.5 flex items-center justify-end gap-0.5 text-[9px] text-white/70">
            <CheckCheck className="size-2.5" /> Visto
          </div>
        )}
      </div>
    </div>
  );
}

function interpolate(s: string, vars: Record<string, string>): string {
  return s.replace(/\{\{\s*vars\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, k: string) =>
    vars[k] ?? "",
  );
}
