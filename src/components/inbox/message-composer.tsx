"use client";

import { useState, useRef, useCallback, useEffect, useMemo, KeyboardEvent } from "react";
import {
  Send,
  LayoutTemplate,
  Slash,
  Plus,
  Pencil,
  Trash2,
  Sparkles,
  Wand2,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ReplyQuote } from "./reply-quote";
import { useT } from "@/hooks/use-locale";
import { useSaldo } from "@/hooks/use-saldo";
import Link from "@/components/i18n/locale-link";
import { useSnippets } from "@/hooks/use-snippets";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import type { Channel } from "@/types";
import {
  canUseTemplateLibrary,
  isOfficialTemplateSend,
} from "@/lib/inbox/template-channel";
import { VoiceNoteComposer } from '@/components/voice/voice-note-editor';
import { supportsVoiceNotes } from '@/lib/voice-notes/channels';

import { AttachmentPreview } from './attachment-preview';
import { OutgoingTranslation } from './conversation-understanding';
import { MAX_ATTACHMENTS, selectAttachments, sendAttachmentQueue } from './attachment-queue';

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
  /** Workspace snippet id — present only for user-created ones (los dos
   *  atajos base no tienen fila hasta que se los edita o elimina). */
  id?: string;
}

interface MessageComposerProps {
  conversationId: string;
  attachmentDropZoneRef?: React.RefObject<HTMLDivElement | null>;
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
  onComposingChange?: (composing: boolean) => void;
}

export function MessageComposer({
  conversationId,
  attachmentDropZoneRef,
  channel,
  sessionExpired: channelSessionExpired,
  onSend,
  onSendMedia,
  onOpenTemplates,
  replyTo,
  onClearReply,
  onComposingChange,
}: MessageComposerProps) {
  const t = useT();
  const { saldo } = useSaldo();
  const readOnly=saldo?.soloLectura === true;
  const sessionExpired=channelSessionExpired || readOnly;
  const fetchWithCsrf = useFetchWithCsrf();
  // Capacidades por canal, según lo que el adapter sabe enviar de verdad.
  // WhatsApp, Instagram y Messenger envían medios por Meta; los correos
  // adjuntan el archivo; Chat web entrega el archivo en el widget. Instagram
  // no acepta documentos por DM. En comentarios y Voz se oculta el clip.
  // WhatsApp sends approved HSM templates. In the other written channels the
  // same library is available as reusable content and is sent as a normal
  // message supported by that channel.
  const canAttachMedia =
    channel === "whatsapp" ||
    channel === "instagram" ||
    channel === "messenger" ||
    channel === "gmail" ||
    channel === "outlook" ||
    channel === "zoho" ||
    channel === "webchat" ||
    channel === "mercadolibre";
  // El correo y el chat web aceptan cualquier archivo. Meta mantiene sus
  // formatos propios para evitar ofrecer adjuntos que el canal rechaza.
  const acceptedFiles =
    channel === "instagram"
      ? "image/*,video/*,audio/*"
      : channel === "gmail" || channel === "outlook" || channel === "zoho" || channel === "webchat"
        ? undefined
        : "image/*,video/*,audio/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx";
  const canUseOfficialTemplates = isOfficialTemplateSend(channel);
  const canUseTemplates = canUseTemplateLibrary(channel);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<Array<{ id: string; file: File }>>([]);
  useEffect(() => { onComposingChange?.(text.trim().length > 0 || pendingFiles.length > 0 || sending); }, [text, pendingFiles.length, sending, onComposingChange]);
  const [dragging, setDragging] = useState(false);
  const activeConversation = useRef(conversationId);
  activeConversation.current = conversationId;
  // Mejorar redaccion: un clic reescribe el borrador antes de enviarlo.
  const [improving, setImproving] = useState(false);
  // Generar respuesta: el agente propone qué contestar; nadie envía nada.
  const [drafting, setDrafting] = useState(false);
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
  // Formulario del picker: crear un atajo nuevo (desde el pie) o editar uno
  // existente (desde el lápiz de la fila). `editando` guarda a quién se está
  // reescribiendo, para poder renombrarlo sin dejar el viejo dando vueltas.
  const [creating, setCreating] = useState(false);
  const [editando, setEditando] = useState<Snippet | null>(null);
  const [createShortcut, setCreateShortcut] = useState("");
  const [createBody, setCreateBody] = useState("");

  const {
    snippets: wsSnippets,
    create: createSnippet,
    remove: removeSnippet,
    hide: hideSnippet,
  } = useSnippets();
  // 2 built-in defaults (translated) + workspace snippets (literal), keyed by
  // trigger so a workspace snippet can override a default. Las filas con
  // `hidden` son lápidas de atajos eliminados: no se muestran, y tapan al
  // atajo base del mismo trigger.
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
      if (s.hidden) {
        byTrigger.delete(trigger);
        continue;
      }
      byTrigger.set(trigger, { trigger, label: s.title ?? "", body: s.body, id: s.id });
    }
    return [...byTrigger.values()];
  }, [t, wsSnippets]);

  /**
   * Eliminar cualquier atajo. Los del workspace se borran; los base
   * (sin fila) dejan una lápida para que no vuelvan a aparecer.
   */
  const deleteSnippet = useCallback(
    (s: Snippet) => {
      const esBase = s.trigger === "saludo" || s.trigger === "gracias";
      void (esBase ? hideSnippet(s.trigger, s.id) : removeSnippet(s.id!));
    },
    [hideSnippet, removeSnippet],
  );

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
  // La lista puede ser más larga que su caja: al moverse con las flechas el
  // elegido tiene que entrar en vista solo (con el mouse ya se desplaza).
  const snippetListRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const item = snippetListRef.current?.children[snippetActiveIdx];
    item?.scrollIntoView({ block: "nearest" });
  }, [snippetActiveIdx, snippetMenu?.query]);
  // Closing the picker also closes any open "create shortcut" form.
  useEffect(() => {
    if (!snippetMenu) {
      setCreating(false);
      setEditando(null);
    }
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
    const shortcut = createShortcut.trim().replace(/^\/+/, "").toLowerCase();
    if (!body || !shortcut) return;
    // Persist (fail-soft if the table isn't there yet) then insert the body
    // into the composer, replacing the typed "/query".
    await createSnippet(shortcut, body).catch(() => ({}));
    // Editar y cambiarle el nombre no debe dejar el atajo viejo en la lista.
    if (editando && editando.trigger !== shortcut) {
      await Promise.resolve(deleteSnippet(editando)).catch(() => {});
    }
    if (editando) {
      // Editar no escribe en el chat: se vuelve a la lista y listo.
      setCreating(false);
      setEditando(null);
      setCreateBody("");
      setCreateShortcut("");
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }
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
  }, [snippetMenu, createBody, createShortcut, createSnippet, text, editando, deleteSnippet]);

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

  /**
   * Cada chat con su borrador.
   *
   * El compositor es UNO solo para toda la bandeja: al cambiar de
   * conversación cambia la prop, no el componente, así que el texto se
   * quedaba pegado en pantalla. Con la respuesta generada eso pasa de
   * molesto a peligroso: el borrador escrito para una persona quedaba
   * cargado y listo para enviar en el chat de otra.
   *
   * Se guarda lo que había en el chat que se deja y se restaura lo que
   * tenía el que se abre — el adjunto no viaja, que pertenece al mensaje
   * que se estaba armando.
   */
  const borradores = useRef<Map<string, string>>(new Map());
  const chatAnterior = useRef(conversationId);
  useEffect(() => {
    if (chatAnterior.current === conversationId) return;
    const saliente = chatAnterior.current;
    if (text.trim()) borradores.current.set(saliente, text);
    else borradores.current.delete(saliente);
    chatAnterior.current = conversationId;
    setText(borradores.current.get(conversationId) ?? "");
    setPendingFiles([]);
    setDragging(false);
    setSnippetMenu(null);
  }, [conversationId, text]);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if ((!trimmed && !pendingFiles.length) || sendingRef.current || sessionExpired) return;
    if (pendingFiles.length && !onSendMedia) return;
    sendingRef.current = true;
    setSending(true);
    const targetConversation = conversationId;
    // La burbuja optimista ya aparece arriba al pulsar Enviar. Dejar el mismo
    // texto abajo hasta que termine toda la petición parecía un duplicado y
    // permitía creer que aún no se había enviado. Lo retiramos en el acto y
    // sólo lo recuperamos si el canal rechaza el envío.
    const draftBeforeSend = text;
    if (draftBeforeSend) setText('');
    borradores.current.delete(targetConversation);
    let captionSent = false;
    try {
      if (pendingFiles.length && onSendMedia) {
        await sendAttachmentQueue(pendingFiles,
          (item, index) => Promise.resolve(onSendMedia(item.file, index === 0 ? trimmed : '', replyTo?.id)),
          () => activeConversation.current === targetConversation,
          (item, index) => {
            if (activeConversation.current !== targetConversation) return;
            setPendingFiles(files => files.filter(f => f.id !== item.id));
            if (index === 0) captionSent = true;
          });
      } else {
        await onSend(trimmed, replyTo?.id);
      }
    } catch {
      // El sender muestra el error. Conservamos adjuntos fallidos/no enviados y
      // devolvemos el texto sólo si todavía no se alcanzó a mandar como caption.
      if (
        activeConversation.current === targetConversation &&
        draftBeforeSend &&
        !captionSent
      ) {
        setText((current) => current.trim() ? current : draftBeforeSend);
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [text, pendingFiles, sessionExpired, onSend, onSendMedia, replyTo?.id, conversationId]);

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

  /**
   * El botón hermano: en vez de reescribir lo que ya está escrito, el agente
   * lee la conversación entera y lo que sabe del producto y propone la
   * respuesta. Cae en el cuadro de escritura — no se envía nada — y si pisó
   * un borrador a medio escribir, el toast lo devuelve.
   */
  const handleDraft = useCallback(async () => {
    if (drafting || sessionExpired || !conversationId) return;
    const previo = text;
    setDrafting(true);
    try {
      const res = await fetchWithCsrf("/api/ai/draft-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      const data = (await res.json().catch(() => null)) as
        | { text?: string; error?: string }
        | null;
      if (!res.ok || !data?.text) {
        toast.error(data?.error || t("inbox.draftReplyFailed"));
        return;
      }
      const propuesta = data.text;
      setText(propuesta);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(propuesta.length, propuesta.length);
        adjustHeight();
      });
      toast(t("inbox.draftReplyReady"), {
        action: {
          label: t("inbox.improveTextUndo"),
          onClick: () => {
            setText(previo);
            requestAnimationFrame(adjustHeight);
          },
        },
      });
    } catch {
      toast.error(t("inbox.draftReplyFailed"));
    } finally {
      setDrafting(false);
    }
  }, [text, drafting, sessionExpired, fetchWithCsrf, conversationId, t, adjustHeight]);

  const addFiles = useCallback((files: File[]) => {
    if (sessionExpired || sendingRef.current || !canAttachMedia || !onSendMedia) return;
    const selected = selectAttachments(files, acceptedFiles, MAX_ATTACHMENTS - pendingFiles.length);
    for (const reason of new Set(selected.rejected.map(r => r.reason))) {
      toast.error(t(reason === 'size' ? 'inbox.fileTooLarge' : reason === 'type' ? 'inbox.attachmentUnsupported' : 'inbox.tooManyAttachments', { count: MAX_ATTACHMENTS }));
    }
    setPendingFiles(current => [...current, ...selected.accepted.map(file => ({ id: crypto.randomUUID(), file }))].slice(0, MAX_ATTACHMENTS));
    textareaRef.current?.focus();
  }, [sessionExpired, canAttachMedia, onSendMedia, acceptedFiles, pendingFiles.length, t]);

  useEffect(() => {
    const zone = attachmentDropZoneRef?.current;
    if (!zone) return;
    let depth = 0;
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault(); depth++;
      if (!sessionExpired && !sendingRef.current && canAttachMedia && onSendMedia) setDragging(true);
    };
    const over = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = sessionExpired || sendingRef.current || !canAttachMedia || !onSendMedia ? 'none' : 'copy';
    };
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault(); depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault(); depth = 0; setDragging(false);
      addFiles(Array.from(event.dataTransfer?.files ?? []));
    };
    zone.addEventListener('dragenter', enter); zone.addEventListener('dragover', over);
    zone.addEventListener('dragleave', leave); zone.addEventListener('drop', drop);
    return () => {
      zone.removeEventListener('dragenter', enter); zone.removeEventListener('dragover', over);
      zone.removeEventListener('dragleave', leave); zone.removeEventListener('drop', drop);
    };
  }, [attachmentDropZoneRef, addFiles, sessionExpired, canAttachMedia, onSendMedia]);

  const handleFilePick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    addFiles(files);
  }, [addFiles]);

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

  if (readOnly) return (
    <div className="border-t px-4 py-3 text-sm text-muted-foreground">
      {t('settings.readOnlyComposer')}{' '}
      {saldo?.mensualidad?.invoiceUrl
        ? <a href={saldo.mensualidad.invoiceUrl} target="_blank" rel="noopener noreferrer" className="font-medium underline">{t('settings.avisoGraciaCta')}</a>
        : <Link href="/ajustes?tab=billing" className="font-medium underline">{t('settings.avisoGraciaCta')}</Link>}
    </div>
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
            {t(
              canUseOfficialTemplates
                ? "inbox.sessionExpiredBanner"
                : "inbox.metaSessionExpiredBanner",
            )}
          </p>
          {canUseOfficialTemplates && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300"
              onClick={onOpenTemplates}
            >
              <LayoutTemplate className="mr-1 h-3 w-3" />
              {t("inbox.templates")}
            </Button>
          )}
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
                    setEditando(null);
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
                  {editando ? t("common.save") : t("inbox.createSnippet")}
                </button>
              </div>
            </div>
          ) : (
            <>
              {filteredSnippets.length > 0 && (
                <ul
                  ref={snippetListRef}
                  className="max-h-56 overflow-y-auto overscroll-contain py-1"
                >
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
                      <button
                        type="button"
                        aria-label={t("inbox.editSnippet")}
                        title={t("inbox.editSnippet")}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setEditando(s);
                          setCreateShortcut(s.trigger);
                          setCreateBody(s.body);
                          setCreating(true);
                        }}
                        className="mt-1 shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-colors hover:bg-accent hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={t("inbox.deleteSnippet")}
                        title={t("inbox.deleteSnippet")}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          deleteSnippet(s);
                        }}
                        className="mr-1.5 mt-1 shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-colors hover:bg-red-500/10 hover:text-red-600 focus:opacity-100 group-hover:opacity-100 dark:hover:text-red-400"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setEditando(null);
                  setCreateShortcut(snippetMenu.query);
                  setCreateBody("");
                  setCreating(true);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-accent-ink hover:bg-muted",
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

      {dragging && <div className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/95 text-sm font-medium" role="status">{t('inbox.dropAttachments')}</div>}
      {pendingFiles.length > 0 && (
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label={t('inbox.attachmentPreviews')}>
          {pendingFiles.map(item => <AttachmentPreview key={item.id} file={item.file} disabled={sending}
            onRemove={() => setPendingFiles(files => files.filter(f => f.id !== item.id))} />)}
        </div>
      )}

      <OutgoingTranslation key={conversationId} conversationId={conversationId} draft={text} onApply={setText} disabled={sessionExpired || sending || improving || drafting} />
      <div className="relative flex items-end gap-2">
        {supportsVoiceNotes(channel) && <VoiceNoteComposer key={conversationId} channel={channel} conversationId={conversationId} disabled={sessionExpired || sending} />}
        {canAttachMedia && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
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
          data-inbox-composer
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={event => {
            const files = Array.from(event.clipboardData.files);
            if (!files.length) return;
            event.preventDefault();
            addFiles(files);
          }}
          placeholder={
            sessionExpired
              ? t(
                  canUseOfficialTemplates
                    ? "inbox.composerExpiredPlaceholder"
                    : "inbox.metaComposerExpiredPlaceholder",
                )
              : t("inbox.typeMessage")
          }
          disabled={sessionExpired || sending}
          rows={1}
          className={cn(
            "scrollbar-thin flex-1 resize-none overflow-y-hidden rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50",
            sessionExpired && "cursor-not-allowed opacity-50"
          )}
        />

        {/* Generar respuesta: el agente propone qué contestar. */}
        {conversationId && (
          <Button
            variant="ghost"
            size="sm"
            className="hidden h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-foreground sm:inline-flex"
            onClick={handleDraft}
            disabled={sessionExpired || sending || drafting || improving}
            title={t("inbox.draftReply")}
            aria-label={t("inbox.draftReply")}
          >
            {drafting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4" />
            )}
          </Button>
        )}

        {/* Mejorar redacción: reescribe el borrador antes de enviarlo. */}
        <Button
          variant="ghost"
          size="sm"
          className="hidden h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-foreground sm:inline-flex"
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

        {/* Approved on WhatsApp; reusable message content on other channels. */}
        {canUseTemplates && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-foreground"
            onClick={onOpenTemplates}
            disabled={sessionExpired && !canUseOfficialTemplates}
            title={t("inbox.sendTemplate")}
            aria-label={t("inbox.sendTemplate")}
          >
            <LayoutTemplate className="h-4 w-4" />
          </Button>
        )}

        <Button
          size="sm"
          className="h-9 w-9 shrink-0 bg-primary p-0 hover:bg-primary/90 disabled:opacity-40"
          disabled={(!text.trim() && !pendingFiles.length) || sessionExpired || sending}
          onClick={handleSend}
          aria-label={t("inbox.sendMessage")}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
