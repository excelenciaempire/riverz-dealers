"use client";

import { useState, useRef, useCallback, useEffect, KeyboardEvent } from "react";
import { Send, LayoutTemplate, Slash, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ReplyQuote } from "./reply-quote";
import { useT } from "@/hooks/use-locale";

/** Client-side attachment ceiling — mirrors MAX_ATTACHMENT_BYTES on the server. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

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
 * defina los suyos. Solo incluimos atajos genéricos (saludo de
 * bienvenida y agradecimiento) que no asumen ninguna política de
 * negocio del merchant.
 */
interface Snippet {
  trigger: string;
  /** i18n key for the snippet's display label, resolved at render. */
  labelKey: string;
  /** i18n key for the snippet's inserted body text, resolved at insert. */
  bodyKey: string;
}
const SNIPPETS: Snippet[] = [
  {
    trigger: "saludo",
    labelKey: "inbox.snippetGreetingLabel",
    bodyKey: "inbox.snippetGreetingBody",
  },
  {
    trigger: "gracias",
    labelKey: "inbox.snippetThanksLabel",
    bodyKey: "inbox.snippetThanksBody",
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
  /** Send an attachment (image/video/audio/document) with an optional caption. */
  onSendMedia?: (file: File, caption: string, replyToId?: string) => void | Promise<void>;
  onOpenTemplates: () => void;
  replyTo?: ReplyDraft | null;
  onClearReply?: () => void;
}

export function MessageComposer({
  conversationId,
  sessionExpired,
  onSend,
  onSendMedia,
  onOpenTemplates,
  replyTo,
  onClearReply,
}: MessageComposerProps) {
  const t = useT();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
      const body = t(snippet.bodyKey);
      const before = text.slice(0, snippetMenu.start);
      const after = text.slice(snippetMenu.start + 1 + snippetMenu.query.length);
      const next = `${before}${body}${after}`;
      setText(next);
      setSnippetMenu(null);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        const pos = before.length + body.length;
        el.focus();
        el.setSelectionRange(pos, pos);
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
      });
    },
    [snippetMenu, text, t],
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
    // A message is sendable if it has text OR a pending attachment.
    if ((!trimmed && !pendingFile) || sendingRef.current || sessionExpired) return;
    sendingRef.current = true;
    setSending(true);
    const fileToSend = pendingFile;
    setText("");
    setPendingFile(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    try {
      // await garantiza que el botón siga deshabilitado hasta que el
      // POST resuelva.
      if (fileToSend && onSendMedia) {
        await onSendMedia(fileToSend, trimmed, replyTo?.id);
      } else {
        await onSend(trimmed, replyTo?.id);
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [text, pendingFile, sessionExpired, onSend, onSendMedia, replyTo?.id]);

  const handleFilePick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = ""; // let the same file be re-picked later
      if (!f) return;
      if (f.size > MAX_FILE_BYTES) {
        toast.error(t("inbox.fileTooLarge"));
        return;
      }
      setPendingFile(f);
    },
    [t],
  );

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
    <div className="border-t border-border bg-card px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
            {t("inbox.sessionExpiredBanner")}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-300"
            onClick={onOpenTemplates}
          >
            <LayoutTemplate className="mr-1 h-3 w-3" />
            {t("inbox.templates")}
          </Button>
        </div>
      )}

      {/* Picker de snippets: flota sobre el textarea cuando hay match. */}
      {snippetMenu && filteredSnippets.length > 0 && (
        <div className="mb-2 overflow-hidden rounded-lg border border-border bg-popover shadow-lg shadow-black/20">
          <div className="border-b border-border bg-muted/30 px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("inbox.quickSnippets")}
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
                        {t(s.labelKey)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {t(s.bodyKey)}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-border bg-muted/20 px-3 py-1 text-[10px] text-muted-foreground">
            {t("inbox.snippetHints")}
          </div>
        </div>
      )}

      {/* Adjunto pendiente: chip con nombre + quitar. */}
      {pendingFile && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-1.5">
          <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-xs text-foreground">
            {pendingFile.name}
          </span>
          <button
            type="button"
            onClick={() => setPendingFile(null)}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t("inbox.removeAttachment")}
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,audio/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx"
          className="hidden"
          onChange={handleFilePick}
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-foreground"
          onClick={() => fileInputRef.current?.click()}
          disabled={sessionExpired || sending}
          title={t("inbox.attachFile")}
          aria-label={t("inbox.attachFile")}
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-foreground"
          onClick={onOpenTemplates}
          title={t("inbox.sendTemplate")}
          aria-label={t("inbox.sendTemplate")}
        >
          <LayoutTemplate className="h-4 w-4" />
        </Button>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={sessionExpired ? t("inbox.composerExpiredPlaceholder") : ""}
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
          disabled={(!text.trim() && !pendingFile) || sessionExpired || sending}
          onClick={handleSend}
          aria-label={t("inbox.sendMessage")}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
