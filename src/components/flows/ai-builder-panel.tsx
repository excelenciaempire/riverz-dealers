"use client";

/**
 * Panel del constructor IA — chat embebido dentro del lienzo del
 * editor de flujos. Hablás en lenguaje natural ("agrega un botón que
 * lleve a un menú con tres opciones: envíos, devoluciones, contacto")
 * y la IA aplica los cambios al estado del builder via patches
 * estructurados.
 *
 * Anclado a la esquina derecha. Cerrado por defecto: un botón con un
 * ícono de chispas (Sparkles) abre el panel y mantiene su historial
 * durante la sesión. El historial se pasa al endpoint en cada turn
 * (limitado a los últimos 10) para que la IA tenga continuidad si el
 * usuario refine.
 *
 * El panel se aplica al estado local — la persistencia ocurre cuando
 * el usuario pulsa Guardar arriba. Si arruina algo, Ctrl+Z reverte el
 * turn entero.
 */

import { useCallback, useRef, useState, useEffect } from "react";
import { Sparkles, Send, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { AiPatch, AssistResponse } from "@/lib/flows/ai-patches";

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  /** Solo presente en respuestas del asistente. Útil para mostrar un
   *  resumen tipo "3 cambios aplicados" debajo del mensaje. */
  patchCount?: number;
}

export interface AiBuilderPanelProps {
  /** UUID del flujo. Se concatena en /api/flows/{id}/assist. */
  flowId: string;
  /**
   * Snapshot del estado actual del builder. El panel lo manda en cada
   * llamada para que la IA tenga contexto fresco. Recibe una función
   * para no capturar el state en closure y mandar el último.
   */
  getSnapshot: () => {
    name?: string;
    trigger_type: "keyword" | "first_inbound_message" | "manual";
    trigger_config: Record<string, unknown>;
    trigger_position?: { x: number; y: number };
    entry_node_id: string | null;
    nodes: Array<{
      node_key: string;
      node_type: string;
      config: Record<string, unknown>;
      position_x?: number;
      position_y?: number;
    }>;
  };
  /**
   * Callback que aplica los patches recibidos. El FlowBuilder lo
   * implementa con un único commit() = un push de undo stack.
   */
  onApplyPatches: (patches: AiPatch[]) => void;
}

export function AiBuilderPanel({
  flowId,
  getSnapshot,
  onApplyPatches,
}: AiBuilderPanelProps) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll al final cada vez que cambia el historial.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [turns]);

  const send = useCallback(async () => {
    const message = input.trim();
    if (!message || sending) return;
    setInput("");
    setSending(true);
    const userTurn: ChatTurn = { role: "user", content: message };
    setTurns((prev) => [...prev, userTurn]);
    try {
      const res = await fetch(`/api/flows/${flowId}/assist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          flow_snapshot: getSnapshot(),
          // Solo mandamos historial textual (no patches anteriores) —
          // la IA reconstruye intención de los turnos previos.
          history: turns.map((t) => ({ role: t.role, content: t.content })),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Error ${res.status}`);
      }
      const data = (await res.json()) as AssistResponse;
      if (data.patches.length > 0) {
        onApplyPatches(data.patches);
      }
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.reply,
          patchCount: data.patches.length,
        },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo conectar";
      toast.error(msg);
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `No pude procesar eso: ${msg}`,
        },
      ]);
    } finally {
      setSending(false);
    }
  }, [flowId, getSnapshot, input, onApplyPatches, sending, turns]);

  // Enter para enviar, Shift+Enter para newline.
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <>
      {/* Botón flotante para abrir/cerrar el panel. Esquina superior
          derecha del lienzo para no chocar con la paleta de "Agregar
          paso" (esquina inferior izquierda) ni los controles de zoom
          (esquina inferior derecha). */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "absolute right-4 top-4 z-30 inline-flex items-center gap-2",
            "rounded-full border border-border bg-foreground px-4 py-2",
            "text-sm font-medium text-background shadow-lg shadow-black/30",
            "transition-opacity hover:opacity-90",
          )}
          aria-label="Abrir constructor IA"
        >
          <Sparkles className="size-4" />
          Constructor IA
        </button>
      )}

      {open && (
        <div
          className={cn(
            "absolute right-4 top-4 bottom-4 z-30 flex w-[400px] flex-col",
            "rounded-xl border border-border bg-card shadow-2xl shadow-black/40",
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-md bg-accent">
                <Sparkles className="size-3.5 text-accent-ink" />
              </div>
              <div>
                <div className="text-sm font-semibold text-foreground">
                  Constructor IA
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Edita el flujo en lenguaje natural
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Cerrar"
            >
              <X className="size-4" />
            </button>
          </div>

          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-3 py-3"
          >
            {turns.length === 0 ? (
              <div className="space-y-3 text-xs text-muted-foreground">
                <p>
                  Pídele a la IA que construya o modifique el flujo. Ejemplos:
                </p>
                <ul className="space-y-2">
                  {EXAMPLE_PROMPTS.map((ex) => (
                    <li key={ex}>
                      <button
                        type="button"
                        onClick={() => setInput(ex)}
                        className="w-full rounded-md border border-border bg-muted/30 px-2.5 py-2 text-left text-xs text-foreground transition-colors hover:bg-muted"
                      >
                        {ex}
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[10px]">
                  Los cambios se aplican al lienzo pero NO se guardan hasta
                  que pulses Guardar arriba. Ctrl+Z reverte el último turno.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {turns.map((t, i) => (
                  <TurnBubble key={i} turn={t} />
                ))}
                {sending && (
                  <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    Pensando…
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-border p-2">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="¿Qué querés que arme?"
                rows={2}
                className={cn(
                  "min-h-[44px] flex-1 resize-none rounded-md border border-border bg-muted/30 px-2.5 py-1.5",
                  "text-sm text-foreground placeholder:text-muted-foreground",
                  "focus:border-foreground/30 focus:outline-none",
                )}
                disabled={sending}
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={!input.trim() || sending}
                className={cn(
                  "inline-flex size-9 items-center justify-center rounded-md",
                  "bg-foreground text-background transition-opacity",
                  "hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40",
                )}
                aria-label="Enviar"
              >
                {sending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TurnBubble({ turn }: { turn: ChatTurn }) {
  const isUser = turn.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-snug",
          isUser
            ? "rounded-br-md bg-foreground text-background"
            : "rounded-bl-md border border-border bg-muted/40 text-foreground",
        )}
      >
        <p className="whitespace-pre-wrap">{turn.content}</p>
        {!isUser && typeof turn.patchCount === "number" && turn.patchCount > 0 && (
          <p className="mt-1 text-[10px] text-muted-foreground">
            {turn.patchCount === 1
              ? "1 cambio aplicado"
              : `${turn.patchCount} cambios aplicados`}
          </p>
        )}
      </div>
    </div>
  );
}

const EXAMPLE_PROMPTS = [
  "Agrega un mensaje de bienvenida con tres botones: Comprar, Soporte, Catálogo.",
  "Cambia el texto del nodo de bienvenida para que sea más cálido.",
  "Conecta el botón Catálogo a un nodo que envíe el link de la tienda.",
];
