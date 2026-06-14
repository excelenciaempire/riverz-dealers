"use client";

import { useState, useRef, useCallback, useEffect, KeyboardEvent } from "react";
import { Send, LayoutTemplate, Slash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ReplyQuote } from "./reply-quote";

interface ReplyDraft {
  /** Internal UUID of the message being replied to — sent back through onSend. */
  id: string;
  authorLabel: string;
  preview: string;
}

/**
 * Snippets de texto del operador. El asesor tipea "/saludo" + Enter
 * y se inserta el texto completo. Por ahora hardcodeados; la próxima
 * iteración los lleva a Ajustes → Snippets para que cada workspace
 * defina los suyos. Cubren los 6 casos más repetidos en LATAM DTC:
 * saludo de bienvenida, estado de envío, política de devolución,
 * horario, métodos de pago y agradecimiento.
 */
interface Snippet {
  trigger: string;
  label: string;
  body: string;
}
const SNIPPETS: Snippet[] = [
  {
    trigger: "saludo",
    label: "Saludo de bienvenida",
    body: "¡Hola! Gracias por escribirnos. ¿En qué te puedo ayudar?",
  },
  {
    trigger: "envio",
    label: "Tiempo de envío",
    body: "Enviamos a todo el país en 2 a 4 días hábiles. El envío es gratis en compras desde 80 mil pesos.",
  },
  {
    trigger: "devolucion",
    label: "Política de devolución",
    body: "Tienes 30 días para cambios o devoluciones. El producto debe estar sin uso y con su empaque original.",
  },
  {
    trigger: "horario",
    label: "Horario de atención",
    body: "Te respondemos de lunes a viernes de 9 a 18h y sábados de 10 a 14h.",
  },
  {
    trigger: "pago",
    label: "Métodos de pago",
    body: "Aceptamos tarjeta de crédito, débito, transferencia y PSE. El pago contra entrega también está disponible en ciudades principales.",
  },
  {
    trigger: "gracias",
    label: "Agradecimiento",
    body: "Muchas gracias por tu compra. Te avisamos en cuanto tu pedido salga del almacén.",
  },
];

interface MessageComposerProps {
  conversationId: string;
  sessionExpired: boolean;
  /** Devuelve una Promise para que el composer pueda esperar al envío
   *  real antes de re-habilitar el botón. Sin esto el botón quedaba
   *  clickeable en el mismo tick que se disparaba el envío y un
   *  spam de Enter mandaba el mismo mensaje 5 veces. */
  onSend: (text: string, replyToId?: string) => void | Promise<void>;
  onOpenTemplates: () => void;
  replyTo?: ReplyDraft | null;
  onClearReply?: () => void;
}

export function MessageComposer({
  conversationId,
  sessionExpired,
  onSend,
  onOpenTemplates,
  replyTo,
  onClearReply,
}: MessageComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  // Ref-guard adicional: setState es async, así que si el agente
  // pulsa Enter rapidísimo el segundo handler todavía lee
  // `sending=false` del closure viejo. El ref es síncrono y bloquea
  // el segundo disparo en el mismo tick.
  const sendingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Snippet picker: aparece cuando el usuario tipea "/" al inicio del
  // textarea o después de un espacio. `query` es lo que viene después
  // del "/". `activeIdx` permite navegar con flechas y elegir con Tab/
  // Enter.
  const [snippetMenu, setSnippetMenu] = useState<{
    query: string;
    start: number; // posición del "/" en el textarea
  } | null>(null);
  const [snippetActiveIdx, setSnippetActiveIdx] = useState(0);
  const filteredSnippets = snippetMenu
    ? SNIPPETS.filter((s) =>
        s.trigger.toLowerCase().startsWith(snippetMenu.query.toLowerCase()),
      )
    : [];
  useEffect(() => {
    setSnippetActiveIdx(0);
  }, [snippetMenu?.query]);

  const insertSnippet = useCallback(
    (snippet: Snippet) => {
      if (!snippetMenu) return;
      const before = text.slice(0, snippetMenu.start);
      const after = text.slice(snippetMenu.start + 1 + snippetMenu.query.length);
      const next = `${before}${snippet.body}${after}`;
      setText(next);
      setSnippetMenu(null);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        const pos = before.length + snippet.body.length;
        el.focus();
        el.setSelectionRange(pos, pos);
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
      });
    },
    [snippetMenu, text],
  );

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    // Max 4 lines (~96px)
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sendingRef.current || sessionExpired) return;
    sendingRef.current = true;
    setSending(true);
    setText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    try {
      // await garantiza que el botón siga deshabilitado hasta que el
      // POST resuelva. Antes onSend no se esperaba y setSending(false)
      // se ejecutaba en el mismo tick que setSending(true), dejando el
      // botón clickeable mientras el mensaje viajaba.
      await onSend(trimmed, replyTo?.id);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [text, sessionExpired, onSend, replyTo?.id]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Si el menú de snippets está abierto, las flechas y Tab/Enter
      // se atrapan acá antes de llegar al envío.
      if (snippetMenu && filteredSnippets.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSnippetActiveIdx((i) => (i + 1) % filteredSnippets.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSnippetActiveIdx(
            (i) => (i - 1 + filteredSnippets.length) % filteredSnippets.length,
          );
          return;
        }
        if (e.key === "Tab" || e.key === "Enter") {
          e.preventDefault();
          insertSnippet(filteredSnippets[snippetActiveIdx]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSnippetMenu(null);
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, snippetMenu, filteredSnippets, snippetActiveIdx, insertSnippet],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setText(value);
      adjustHeight();
      // Detectar trigger del snippet picker: "/" al inicio o después
      // de un espacio, seguido opcional de [a-z]+. Si el cursor está
      // dentro de ese token, lo capturamos como query.
      const cursor = e.target.selectionStart ?? value.length;
      const upToCursor = value.slice(0, cursor);
      const m = upToCursor.match(/(^|\s)\/([a-zA-Z]*)$/);
      if (m) {
        const start = cursor - m[2].length - 1;
        setSnippetMenu({ query: m[2], start });
      } else if (snippetMenu) {
        setSnippetMenu(null);
      }
    },
    [adjustHeight, snippetMenu],
  );

  return (
    <div className="border-t border-border bg-card p-3">
      {replyTo && (
        <div className="mb-2">
          <ReplyQuote
            authorLabel={replyTo.authorLabel}
            preview={replyTo.preview}
            onDismiss={onClearReply}
          />
        </div>
      )}
      {sessionExpired && (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-amber-500/10 px-3 py-2">
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Sesión de 24 horas expirada. Usa una plantilla.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-300"
            onClick={onOpenTemplates}
          >
            <LayoutTemplate className="mr-1 h-3 w-3" />
            Plantillas
          </Button>
        </div>
      )}

      {/* Picker de snippets: flota sobre el textarea cuando hay match. */}
      {snippetMenu && filteredSnippets.length > 0 && (
        <div className="mb-2 overflow-hidden rounded-lg border border-border bg-popover shadow-lg shadow-black/20">
          <div className="border-b border-border bg-muted/30 px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            Atajos rápidos
          </div>
          <ul className="max-h-60 overflow-y-auto py-1">
            {filteredSnippets.map((s, i) => (
              <li key={s.trigger}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertSnippet(s);
                  }}
                  onMouseEnter={() => setSnippetActiveIdx(i)}
                  className={cn(
                    "flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors",
                    i === snippetActiveIdx ? "bg-accent" : "hover:bg-muted",
                  )}
                >
                  <Slash className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-medium text-foreground">
                        /{s.trigger}
                      </code>
                      <span className="text-[10px] text-muted-foreground">
                        {s.label}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {s.body}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-border bg-muted/20 px-3 py-1 text-[10px] text-muted-foreground">
            ↑↓ navega · Enter inserta · Esc cierra
          </div>
        </div>
      )}

      <div className="flex items-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-foreground"
          onClick={onOpenTemplates}
          title="Enviar plantilla"
        >
          <LayoutTemplate className="h-4 w-4" />
        </Button>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={
            sessionExpired
              ? "Sesión expirada. Usa una plantilla."
              : "Mensaje. Tipea / para usar un atajo."
          }
          disabled={sessionExpired}
          rows={1}
          className={cn(
            "flex-1 resize-none rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50",
            sessionExpired && "cursor-not-allowed opacity-50"
          )}
        />

        <Button
          size="sm"
          className="h-9 w-9 shrink-0 bg-primary p-0 hover:bg-primary/90 disabled:opacity-40"
          disabled={!text.trim() || sessionExpired || sending}
          onClick={handleSend}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
