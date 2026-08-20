"use client";

import { useState, useRef, useCallback, useEffect, useMemo, KeyboardEvent } from "react";
import { Send, LayoutTemplate, Slash, Paperclip, X, Plus, Trash2, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ReplyQuote } from "./reply-quote";
import { useT } from "@/hooks/use-locale";
import { useSnippets } from "@/hooks/use-snippets";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import type { Channel } from "@/types";

/** Client-side attachment ceiling — mirrors MAX_ATTACHMENT_BYTES on the server. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Alto maximo del compositor: 4 lineas. Mas alla de eso desplaza. */
const MAX_COMPOSER_HEIGHT = 96;

interface ReplyDraft {
  /** Internal UUID of the message being replied to — sent back through onSend. */
  id: string;
  authorLabel: string;
  preview: string;
}

/**
 * Snippets de texto del operador. El asesor tipea "/saludo" + Enter y se
 * inserta el texto completo. La lista = 2 atajos base (saludo/gracias) + los
 * que cada workspace crea (tabla message_snippets, via useSnippets). Desde el
 * mismo picker se puede crear un atajo nuevo tipeando "/loquesea" + "Crear".
 * Todos se normalizan a { trigger, label, body } literales antes del picker.
 */
interface Snippet {
  trigger: string;
  label: string;
  body: string;
  /** Workspace snippet id — present only for user-created ones (the two
   *  built-in defaults have none and can't be deleted). */
  id?: string;
}

interface MessageComposerProps {
  conversationId: string;
  /** Canal de la conversación — decide qué acciones ofrece el composer
   *  (adjuntar media, plantillas). Cada canal muestra sólo lo que soporta. */
  channel: Channel;
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
  channel,
  sessionExpired,
  onSend,
  onSendMedia,
  onOpenTemplates,
  replyTo,
  onClearReply,
}: MessageComposerProps) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  // Capacidades por canal, según lo que el adapter sabe enviar de verdad.
  // Mandan archivos: WhatsApp, Instagram y Messenger (Send API de Meta),
  // Gmail y Outlook (dentro del MIME del correo) y Mercado Libre (subida a su
  // endpoint, sólo en mensajes post-venta). Instagram no acepta documentos por
  // DM, sólo imagen, video y audio. En los comentarios y en Voz el envío es
  // texto: se oculta el clip para no ofrecer algo que el canal no puede hacer.
  // Las plantillas (HSM) son de WhatsApp únicamente.
  const canAttachMedia =
    channel === "whatsapp" ||
    channel === "instagram" ||
    channel === "messenger" ||
    channel === "gmail" ||
    channel === "outlook" ||
    channel === "mercadolibre";
  const acceptedFiles =
    channel === "instagram"
      ? "image/*,video/*,audio/*"
      : "image/*,video/*,audio/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx";
  const canUseTemplates = channel === "whatsapp";
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  // Mejorar redaccion: un clic reescribe el borrador antes de enviarlo.
  const [improving, setImproving] = useState(false);
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
  // Inline "create shortcut" form state (opened from the picker footer).
  const [creating, setCreating] = useState(false);
  const [createShortcut, setCreateShortcut] = useState("");
  const [createBody, setCreateBody] = useState("");

  const { snippets: wsSnippets, create: createSnippet, remove: removeSnippet } =
    useSnippets();
  // 2 built-in defaults (translated) + workspace snippets (literal), keyed by
  // trigger so a workspace snippet can override a default.
  const allSnippets = useMemo<Snippet[]>(() => {
    const byTrigger = new Map<string, Snippet>();
    byTrigger.set("saludo", {
      trigger: "saludo",
      label: t("inbox.snippetGreetingLabel"),
      body: t("inbox.snippetGreetingBody"),
    });
    byTrigger.set("gracias", {
      trigger: "gracias",
      label: t("inbox.snippetThanksLabel"),
      body: t("inbox.snippetThanksBody"),
    });
    for (const s of wsSnippets) {
      const trigger = s.shortcut.toLowerCase();
      byTrigger.set(trigger, { trigger, label: s.title ?? "", body: s.body, id: s.id });
    }
    return [...byTrigger.values()];
  }, [t, wsSnippets]);

  const filteredSnippets = snippetMenu
    ? allSnippets.filter((s) =>
        s.trigger.toLowerCase().startsWith(snippetMenu.query.toLowerCase()),
      )
    : [];
  // The typed query already exists as a snippet? Then don't offer to create it.
  const exactExists =
    !!snippetMenu &&
    allSnippets.some((s) => s.trigger === snippetMenu.query.toLowerCase());
  useEffect(() => {
    setSnippetActiveIdx(0);
  }, [snippetMenu?.query]);
  // Closing the picker also closes any open "create shortcut" form.
  useEffect(() => {
    if (!snippetMenu) setCreating(false);
  }, [snippetMenu]);

  const insertSnippet = useCallback(
    (snippet: Snippet) => {
      if (!snippetMenu) return;
      const body = snippet.body;
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
        el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
      });
    },
    [snippetMenu, text, t],
  );

  const submitCreate = useCallback(async () => {
    if (!snippetMenu) return;
    const body = createBody.trim();
    const shortcut = createShortcut.trim().replace(/^\/+/, "");
    if (!body || !shortcut) return;
    // Persist (fail-soft if the table isn't there yet) then insert the body
    // into the composer, replacing the typed "/query".
    await createSnippet(shortcut, body).catch(() => ({}));
    const before = text.slice(0, snippetMenu.start);
    const after = text.slice(snippetMenu.start + 1 + snippetMenu.query.length);
    setText(`${before}${body}${after}`);
    setCreating(false);
    setCreateBody("");
    setCreateShortcut("");
    setSnippetMenu(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      const pos = before.length + body.length;
      el.focus();
      el.setSelectionRange(pos, pos);
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
    });
  }, [snippetMenu, createBody, createShortcut, createSnippet, text]);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    // Max 4 lines (~96px)
    const next = Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT);
    el.style.height = `${next}px`;
    // La caja crece con el texto, así que la barra de desplazamiento sólo
    // tiene sentido cuando ya no puede crecer más. Sin esto Windows dibujaba
    // sus flechitas de scroll al lado de un mensaje de una sola línea.
    el.style.overflowY =
      el.scrollHeight > MAX_COMPOSER_HEIGHT ? "auto" : "hidden";
  }, []);

  // El texto también cambia sin que nadie tipee: al insertar un atajo, al
  // mejorar la redacción, al limpiar después de enviar. Un solo efecto cubre
  // todos esos casos.
  useEffect(() => {
    adjustHeight();
  }, [text, adjustHeight]);

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

  /**
   * Un clic: el borrador vuelve bien redactado. Es reescritura, no
   * respuesta — el modelo no agrega datos ni cambia el idioma. Si el
   * resultado no convence, el toast ofrece deshacer.
   */
  const handleImprove = useCallback(async () => {
    const draft = text.trim();
    if (!draft || improving || sessionExpired) return;
    setImproving(true);
    try {
      const res = await fetchWithCsrf("/api/ai/improve-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: draft, conversation_id: conversationId }),
      });
      const data = (await res.json().catch(() => null)) as
        | { text?: string; error?: string }
        | null;
      if (!res.ok || !data?.text) {
        toast.error(data?.error || t("inbox.improveTextFailed"));
        return;
      }
      if (data.text.trim() === draft) {
        toast(t("inbox.improveTextUnchanged"));
        return;
      }
      setText(data.text);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(data.text!.length, data.text!.length);
        adjustHeight();
      });
      toast(t("inbox.improveText"), {
        action: {
          label: t("inbox.improveTextUndo"),
          onClick: () => {
            setText(draft);
            requestAnimationFrame(adjustHeight);
          },
        },
      });
    } catch {
      toast.error(t("inbox.improveTextFailed"));
    } finally {
      setImproving(false);
    }
  }, [text, improving, sessionExpired, fetchWithCsrf, conversationId, t, adjustHeight]);

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

      {/* Picker de atajos: lista + crear atajo. Sin título ni hints. */}
      {snippetMenu && !sessionExpired && (
        <div className="mb-2 overflow-hidden rounded-lg border border-border bg-popover shadow-lg shadow-black/20">
          {creating ? (
            <div className="space-y-2 p-3">
              <div className="relative">
                <Slash className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={createShortcut}
                  onChange={(e) =>
                    setCreateShortcut(e.target.value.replace(/^\/+/, "").replace(/\s/g, ""))
                  }
                  placeholder={t("inbox.snippetShortcutPlaceholder")}
                  autoFocus
                  className="w-full rounded-md border border-border bg-muted pl-6 pr-2 py-1.5 text-sm text-foreground outline-none focus:border-primary/50"
                />
              </div>
              <textarea
                value={createBody}
                onChange={(e) => setCreateBody(e.target.value)}
                placeholder={t("inbox.snippetBodyPlaceholder")}
                rows={2}
                className="w-full resize-none rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary/50"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setCreating(false);
                  }}
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    void submitCreate();
                  }}
                  disabled={!createBody.trim() || !createShortcut.trim()}
                  className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                >
                  {t("inbox.createSnippet")}
                </button>
              </div>
            </div>
          ) : (
            <>
              {filteredSnippets.length > 0 && (
                <ul className="max-h-56 overflow-y-auto py-1">
                  {filteredSnippets.map((s, i) => (
                    <li
                      key={s.trigger}
                      onMouseEnter={() => setSnippetActiveIdx(i)}
                      className={cn(
                        "group flex items-start transition-colors",
                        i === snippetActiveIdx ? "bg-accent" : "hover:bg-muted",
                      )}
                    >
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          insertSnippet(s);
                        }}
                        className="flex min-w-0 flex-1 items-start gap-2 px-3 py-1.5 text-left"
                      >
                        <Slash className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <code className="text-xs font-medium text-foreground">/{s.trigger}</code>
                            {s.label && (
                              <span className="text-[10px] text-muted-foreground">{s.label}</span>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {s.body}
                          </p>
                        </div>
                      </button>
                      {s.id && (
                        <button
                          type="button"
                          aria-label={t("inbox.deleteSnippet")}
                          title={t("inbox.deleteSnippet")}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void removeSnippet(s.id!);
                          }}
                          className="mr-1.5 mt-1 shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-colors hover:bg-red-500/10 hover:text-red-600 focus:opacity-100 group-hover:opacity-100 dark:hover:text-red-400"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setCreateShortcut(snippetMenu.query);
                  setCreateBody("");
                  setCreating(true);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-primary hover:bg-muted",
                  filteredSnippets.length > 0 && "border-t border-border",
                )}
              >
                <Plus className="size-3.5 shrink-0" />
                {snippetMenu.query && !exactExists
                  ? t("inbox.createSnippetCta", { shortcut: snippetMenu.query })
                  : t("inbox.newSnippet")}
              </button>
            </>
          )}
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
        {canAttachMedia && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={acceptedFiles}
              className="hidden"
              onChange={handleFilePick}
            />
            {/* "+" adjuntar (como WhatsApp). */}
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => fileInputRef.current?.click()}
              disabled={sessionExpired || sending}
              title={t("inbox.attachFile")}
              aria-label={t("inbox.attachFile")}
            >
              <Plus className="h-5 w-5" />
            </Button>
          </>
        )}

        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={sessionExpired ? t("inbox.composerExpiredPlaceholder") : t("inbox.typeMessage")}
          disabled={sessionExpired}
          rows={1}
          className={cn(
            "scrollbar-thin flex-1 resize-none overflow-y-hidden rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50",
            sessionExpired && "cursor-not-allowed opacity-50"
          )}
        />

        {/* Mejorar redacción: reescribe el borrador antes de enviarlo. */}
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-foreground"
          onClick={handleImprove}
          disabled={!text.trim() || sessionExpired || sending || improving}
          title={t("inbox.improveText")}
          aria-label={t("inbox.improveText")}
        >
          {improving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
        </Button>

        {/* Plantillas aprobadas de WhatsApp (donde WhatsApp pone los stickers). */}
        {canUseTemplates && (
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
        )}

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
