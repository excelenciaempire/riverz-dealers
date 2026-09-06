"use client";

import { useState, useEffect, useCallback, useRef, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createClient } from "@/lib/supabase/client";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import { cn } from "@/lib/utils";
import type { Channel, Conversation, ConversationStatus, MessageStatus } from "@/types";
import { ChannelLogo } from "@/components/inbox/channel-logo";
import { MlKindBadge } from "@/components/inbox/ml-kind-badge";
import {
  channelLabel,
  isUnsupportedSnippet,
  localizeContentToken,
  stripLeadingMentions,
} from "@/lib/channels/display";
import { formatPhoneDisplay } from "@/lib/whatsapp/phone-utils";
import {
  MESSAGE_CHANNELS,
  COMMENT_CHANNELS,
  isStoryConversation,
  type InboxTab,
} from "@/components/inbox/inbox-tabs";
import Link from "@/components/i18n/locale-link";
import {
  Plus,
  MoreVertical,
  Trash2,
  CheckSquare,
  Square,
  X,
  Inbox as InboxIcon,
  Plug2,
  Check,
  CheckCheck,
  Clock,
  XCircle,
  EyeOff,
} from "lucide-react";
import { NewChatModal } from "@/components/inbox/new-chat-modal";
import { toast } from "sonner";
import { isToday, isYesterday, isThisWeek, isThisYear } from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { useTimezone } from "@/hooks/use-timezone";
import { useWorkspace } from "@/hooks/use-workspace";
import { useT, useLocale } from "@/hooks/use-locale";
import { dateFnsLocale } from "@/lib/i18n/format";
import type { TFn } from "@/lib/i18n/translate";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  onConversationDeleted?: (id: string) => void;
  /**
   * Called after a successful bulk delete so the parent can refetch
   * authoritative state (correct counts, drop any scope-deleted rows the
   * client hadn't loaded) and clear the open thread if it was wiped.
   */
  onBulkDeleted?: () => void;
  /**
   * Which inbox slice this list is showing. Used so "Select all → Delete"
   * can clear the whole tab server-side (by channel scope) instead of only
   * the rows currently loaded. Defaults to "messages".
   */
  inboxTab?: InboxTab;
  /** Active channel chip, if any — narrows the "clear all" scope to it. */
  channelFilter?: Channel | null;
  /**
   * Whether the workspace has at least one connected channel. Drives the
   * empty-state copy: with a connection we say "no messages yet" instead of
   * telling the merchant to connect a channel they've already connected.
   */
  hasAnyConnection?: boolean;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
  /**
   * Hay una búsqueda escrita arriba. La lista ya llega filtrada; esto sólo
   * cambia el vacío: "sin resultados" en vez de "todavía no llegaron mensajes".
   */
  searchActive?: boolean;
  /** La búsqueda está yendo al servidor: se muestra el mismo spinner. */
  searchLoading?: boolean;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-primary",
  pending: "bg-amber-500",
  closed: "bg-muted-foreground",
};

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  onConversationDeleted,
  onBulkDeleted,
  inboxTab = "messages",
  channelFilter = null,
  hasAnyConnection = false,
  resyncToken = 0,
  searchActive = false,
  searchLoading = false,
}: ConversationListProps) {
  const fetchWithCsrf = useFetchWithCsrf();
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const tz = useTimezone();
  const { workspace, isAdmin } = useWorkspace();
  const workspaceId = workspace?.id ?? null;

  // Keep the latest callback in a ref so the fetch effect below can
  // have a stable, empty-dep identity. Previously the fetch useCallback
  // depended on `onConversationsLoaded`, which depends on the parent's
  // `deepLinkConvId` — so every URL change (including one the parent
  // triggered via router.replace after a click) caused a fresh
  // conversations fetch. That extra refetch was the trigger for the
  // deep-link auto-select running a second time and wiping the active
  // thread's messages.
  // Mutation lives in an effect (not render) per React 19's refs rule;
  // the fetch runs once on mount so it's fine to read the slightly
  // older value — the very next render updates the ref for any
  // subsequent async completion.
  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });
  // Signature of the last applied list — lets a resync refetch (tab refocus /
  // WS reconnect) skip replacing the array when nothing changed, so returning
  // to the tab doesn't re-render/reflow the whole list.
  const lastSigRef = useRef<string>("");

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    // Active workspace is required for the cross-workspace leak fix
    // — without it RLS would still return conversations from every
    // workspace the user belongs to. Wait for useWorkspace to settle.
    if (!workspaceId) return;

    (async () => {
      // Scoping rule: EMAIL channels (gmail/outlook) are personal — each
      // agent only sees the mailboxes they themselves connected. Every
      // other channel (WhatsApp, Instagram, Messenger, FB/IG comments)
      // is a shared business asset, so all workspace members see it.
      // This is what the user asked for: "que solamente se vean los
      // emails del email conectado" without hiding the shared WhatsApp.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setLoading(false);
        return;
      }
      const { data: ownConns } = await supabase
        .from("channel_connections")
        .select("id")
        .eq("created_by", user.id)
        .in("channel", ["gmail", "outlook", "zoho"]);
      const ownEmailIds = (ownConns ?? []).map((c) => c.id);

      let query = supabase
        .from("conversations")
        .select("*, contact:contacts(*)")
        .eq("workspace_id", workspaceId)
        // Ocultar conversaciones vacías: las automatizaciones de Shopify
        // (recuperación de carrito / pedidos) crean la conversación ANTES
        // de enviar, y si el envío falla (p.ej. bloqueo de pago de WhatsApp)
        // queda una conversación "Sin mensajes" que ensucia la bandeja.
        // Sin último mensaje no es una conversación real.
        .not("last_message_at", "is", null)
        // Ocultar conversaciones borradas de la bandeja (soft-delete, migración
        // 085): la fila sigue en BD (para métricas + dedup de ingest) pero no
        // se muestra.
        .is("deleted_at", null)
        .order("last_message_at", { ascending: false });
      // Show all non-email conversations (RLS already limits to the
      // workspace) plus email conversations from this user's mailboxes.
      query =
        ownEmailIds.length > 0
          ? query.or(
              `channel.not.in.(gmail,outlook,zoho),connection_id.in.(${ownEmailIds.join(",")})`,
            )
          : query.not("channel", "in", "(gmail,outlook,zoho)");
      const { data, error } = await query;

      if (cancelled) return;

      if (error) {
        // Supabase errors have non-enumerable properties — log fields explicitly
        console.error("Failed to fetch conversations:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        setLoading(false);
        return;
      }

      const loaded = (data ?? []) as unknown as Conversation[];
      // Only push into parent state when the visible list actually changed —
      // an unchanged resync (the common tab-refocus case) is a no-op, avoiding
      // a full re-render. Realtime keeps the list live in between.
      const sig = loaded
        .map(
          (c) =>
            // `last_message_hidden` entra en la firma porque cambia SIN que
            // cambie nada más: ocultar un comentario no mueve el último
            // mensaje ni el no-leído, así que sin esto el resync lo daría por
            // "sin cambios" y la lista se quedaría con el estado viejo.
            `${c.id}:${c.last_message_at}:${c.unread_count}:${c.deleted_at ?? ""}:${c.last_message_hidden ? 1 : 0}`,
        )
        .join("|");
      if (sig !== lastSigRef.current) {
        lastSigRef.current = sig;
        onConversationsLoadedRef.current(loaded);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
    // `workspaceId` is included so a workspace switch reissues the
    // fetch with the new scope.
  }, [resyncToken, workspaceId]);

  const filtered = conversations;

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0 || !workspaceId) return;
    if (!window.confirm(t("inbox.bulkDeleteConfirm", { n: selectedIds.size })))
      return;
    setBulkDeleting(true);
    const ids = [...selectedIds];
    // "Clearing the whole view": every row in this tab/channel is selected. En
    // ese caso borramos por ALCANCE DE CANAL en el servidor, que barre la
    // pestaña de verdad — incluidas las filas que el cliente nunca cargó o que
    // entraron a mitad de la selección. Es el arreglo de "lo borré y volvió al
    // recargar". Cualquier selección más chica borra los ids puntuales.
    // Con una búsqueda escrita NUNCA se borra por alcance: "seleccionar todo"
    // sobre tres resultados significa esos tres, no la pestaña entera.
    const clearingAll =
      !searchActive && filtered.length > 0 && selectedIds.size >= filtered.length;
    const channels = channelFilter
      ? [channelFilter]
      : inboxTab === "comments"
        ? COMMENT_CHANNELS
        : MESSAGE_CHANNELS;
    let ok = false;
    let deleted = 0;
    try {
      const res = await fetchWithCsrf("/api/conversations/bulk-delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          clearingAll
            ? { workspace_id: workspaceId, channels }
            : { workspace_id: workspaceId, ids },
        ),
      });
      const payload = await res.json().catch(() => ({}));
      ok = res.ok;
      deleted = payload?.deleted ?? ids.length;
      if (!res.ok)
        toast.error(payload.error || t("inbox.bulkDeleteFailed", { n: ids.length }));
    } catch (err) {
      toast.error(t("inbox.networkError"));
    }
    setBulkDeleting(false);
    setSelectedIds(new Set());
    setSelectMode(false);
    if (ok) {
      // Snappy local removal of what we had, then let the parent refetch
      // authoritative state (accurate counts + drop any scope-deleted rows we
      // hadn't loaded).
      ids.forEach((id) => onConversationDeleted?.(id));
      onBulkDeleted?.();
      toast.success(t("inbox.bulkDeleteSuccess", { n: deleted || ids.length }));
    }
  }, [
    selectedIds,
    workspaceId,
    filtered,
    searchActive,
    channelFilter,
    inboxTab,
    fetchWithCsrf,
    onConversationDeleted,
    onBulkDeleted,
    t,
  ]);

  // ── Virtualization ──
  // Plain `.map()` over `filtered` mounts every row on first paint and
  // pays a memo-compare on every state change. For 500+ rows that was
  // visible work even with the row-level `ConversationItem` memo.
  // The scroller div (`min-h-0 flex-1 overflow-y-auto`) is the scroll
  // element; we DON'T use `useWindowVirtualizer` because the list lives
  // inside a `ResizablePane` and the scroll element is this inner div,
  // not the window.
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    // Matches `px-3 py-3` + `h-10` avatar row in `ConversationItem`. The
    // virtualizer measures real rows after first paint, so a slight
    // miss here just costs a re-flow on mount.
    estimateSize: () => 64,
    overscan: 5,
  });

  // Scroll the active conversation into view when it's set programmatically
  // (deep link, realtime update, etc.). Without this, a deep link to a row
  // 300 entries down wouldn't auto-scroll because that row isn't mounted.
  useEffect(() => {
    if (!activeConversationId || filtered.length === 0) return;
    const i = filtered.findIndex((c) => c.id === activeConversationId);
    if (i >= 0) rowVirtualizer.scrollToIndex(i, { align: "auto" });
  }, [activeConversationId, filtered, rowVirtualizer]);

  return (
    // Always fills its parent. Width is controlled by ResizablePane on
    // desktop (with localStorage persistence) and by the inbox flex row
    // on mobile. Keeping the fixed `lg:w-80` here was overriding the
    // resize drag visually — the inline width from the parent would
    // change but this div stayed pinned at 320px.
    <div className="flex h-full w-full flex-col bg-card">
      <NewChatModal
        open={newChatOpen}
        onOpenChange={setNewChatOpen}
        onConversationCreated={(conv) => {
          onConversationsLoaded([
            conv,
            ...conversations.filter((c) => c.id !== conv.id),
          ]);
          onSelect(conv);
        }}
      />
      {/* La búsqueda vive arriba de la lista (InboxSearchBox): busca en el
          servidor y adentro de los mensajes, no sólo en la vista previa. Este
          campo local duplicaba la caja y encontraba menos. */}
      <div className="border-b border-border p-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setNewChatOpen(true)}
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-accent-ink hover:bg-accent"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("inbox.newChat")}
          </button>
          {selectMode ? (
            <button
              onClick={exitSelectMode}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              {t("inbox.cancel")}
            </button>
          ) : isAdmin ? (
            // Bulk select + delete is admin-only — it can wipe the whole inbox.
            <button
              onClick={() => setSelectMode(true)}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <CheckSquare className="h-3.5 w-3.5" />
              {t("inbox.select")}
            </button>
          ) : null}
        </div>
      </div>

      {/* Conversation Items — native overflow scroll. We dropped the
          base-ui ScrollArea here because its viewport wasn't resolving a
          bounded height inside the resizable flex column, which killed
          wheel scrolling on long lists. A plain overflow-y-auto always
          scrolls. */}
      <div ref={parentRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {loading || searchLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <InboxEmptyState
            hasFilters={searchActive}
            channelActive={!!channelFilter}
            hasAnyConnection={hasAnyConnection}
          />
        ) : (
          <div
            style={{
              height: rowVirtualizer.getTotalSize(),
              position: "relative",
              width: "100%",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((vRow) => {
              const conv = filtered[vRow.index];
              return (
                <div
                  key={conv.id}
                  data-index={vRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vRow.start}px)`,
                  }}
                >
                  <ConversationItem
                    conversation={conv}
                    isActive={conv.id === activeConversationId}
                    onSelect={handleSelect}
                    onDelete={onConversationDeleted}
                    selectMode={selectMode}
                    selected={selectedIds.has(conv.id)}
                    onToggleSelected={toggleSelected}
                    tz={tz}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bulk action bar — only while selecting. */}
      {selectMode && (
        <div className="flex items-center justify-between gap-2 border-t border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                setSelectedIds((prev) =>
                  filtered.length > 0 && prev.size >= filtered.length
                    ? new Set()
                    : new Set(filtered.map((c) => c.id)),
                )
              }
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <CheckSquare className="h-3.5 w-3.5" />
              {filtered.length > 0 && selectedIds.size >= filtered.length
                ? t("inbox.deselectAll")
                : t("inbox.selectAll")}
            </button>
            <span className="text-xs text-muted-foreground">
              {t("inbox.selectedCount", { n: selectedIds.size })}
            </span>
          </div>
          <button
            onClick={handleBulkDelete}
            disabled={selectedIds.size === 0 || bulkDeleting}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {bulkDeleting ? t("inbox.deleting") : t("inbox.delete")}
          </button>
        </div>
      )}
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  onDelete?: (id: string) => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelected?: (id: string) => void;
  tz: string;
}

// Memoized so a single-row UPDATE doesn't repaint all N rows. Custom
// equality compares the conversation fields the row actually renders
// — anything else (extra contact fields, unread bump on a *different*
// row) is irrelevant and shouldn't re-render this row.
const ConversationItem = memo(function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onDelete,
  selectMode = false,
  selected = false,
  onToggleSelected,
  tz,
}: ConversationItemProps) {
  const fetchWithCsrf = useFetchWithCsrf();
  const t = useT();
  const { locale } = useLocale();
  const dfLocale = dateFnsLocale(locale);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = useCallback(
    async (e: React.MouseEvent | Event) => {
      e.preventDefault();
      e.stopPropagation();
      if (deleting) return;
      if (!window.confirm(t("inbox.deleteConversationConfirm"))) return;
      setDeleting(true);
      try {
        const r = await fetchWithCsrf(`/api/conversations/${conversation.id}`, { method: "DELETE" });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          toast.error(j.error || t("inbox.deleteFailed"));
          return;
        }
        onDelete?.(conversation.id);
        toast.success(t("inbox.deleted"));
      } catch (err) {
        toast.error(t("inbox.networkError"));
      } finally {
        setDeleting(false);
      }
    },
    [conversation, deleting, onDelete, fetchWithCsrf, t],
  );
  const contact = conversation.contact;
  const displayName = resolveDisplayName(conversation.channel, contact, t);
  const initials = displayName.charAt(0).toUpperCase();

  const handleClick = useCallback(() => {
    if (selectMode) {
      onToggleSelected?.(conversation.id);
      return;
    }
    onSelect(conversation);
  }, [selectMode, onToggleSelected, onSelect, conversation]);

  // Smart timestamp — same idiom every messaging app uses, formatted
  // in the user's IANA timezone so 14:32 means 14:32 *for them*, not
  // for the server. isToday / isYesterday compare against the local
  // calendar day via toZonedTime so a message sent at 23:30 doesn't
  // jump to "Ayer" just because UTC ticked over.
  const timeAgo = (() => {
    if (!conversation.last_message_at) return "";
    const utc = new Date(conversation.last_message_at);
    const zoned = toZonedTime(utc, tz);
    if (isToday(zoned)) return formatInTimeZone(utc, tz, "HH:mm");
    if (isYesterday(zoned)) return t("inbox.yesterday");
    if (isThisWeek(zoned, { weekStartsOn: 1 }))
      return formatInTimeZone(utc, tz, "EEE", { locale: dfLocale });
    if (isThisYear(zoned))
      return formatInTimeZone(utc, tz, "d MMM", { locale: dfLocale });
    return formatInTimeZone(utc, tz, "d MMM yy", { locale: dfLocale });
  })();

  return (
    <div
      onClick={handleClick}
      className={cn(
        "group relative flex w-full cursor-pointer items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-accent/50",
        isActive && !selectMode && "border-l-2 border-primary bg-accent/70",
        selected && "bg-primary/10"
      )}
    >
      {/* Selection checkbox — only in multi-select mode. */}
      {selectMode && (
        <span className="mt-2.5 shrink-0">
          {selected ? (
            <CheckSquare className="h-5 w-5 text-accent-ink" />
          ) : (
            <Square className="h-5 w-5 text-muted-foreground" />
          )}
        </span>
      )}
      {onDelete && !selectMode && (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t("inbox.actions")}
            className="absolute right-1.5 top-2 hidden h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent/60 hover:text-foreground group-hover:flex data-[popup-open]:flex"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreVertical className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="border-border bg-card"
          >
            <DropdownMenuItem
              onClick={(e) => handleDelete(e as unknown as Event)}
              className="text-sm text-red-600 dark:text-red-400 focus:bg-red-500/10 focus:text-red-700 dark:focus:text-red-300"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t("inbox.deleteConversation")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {/* Avatar with channel logo badge — the small overlay tells the
          agent at a glance which app the message came from without having
          to read a separate text badge in the row. */}
      <div className="relative h-10 w-10 shrink-0">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
          {/* Iniciales de base; el avatar va superpuesto y, si la URL está
              rota/expirada, onError lo oculta y quedan las iniciales. */}
          {initials}
          {contact?.avatar_url && (
            <img
              key={contact.avatar_url}
              src={contact.avatar_url}
              alt={displayName}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-10 w-10 rounded-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          )}
        </div>
        <span
          className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-card ring-2 ring-card"
          title={conversation.channel}
        >
          <ChannelLogo channel={conversation.channel} size={12} />
        </span>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {displayName}
            </span>
            {/* ML: marca pregunta (pública) vs mensaje (post-venta) */}
            <MlKindBadge
              channel={conversation.channel}
              threadExternalId={conversation.thread_external_id}
              status={conversation.status}
            />
            {/* Nació de una historia. Es un DM, pero no una consulta fría:
                quien contesta tu historia es la señal más caliente que Meta
                deja contactar, y sin esto se leía igual que cualquier otra. */}
            {isStoryConversation(conversation) && (
              <span className="shrink-0 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {t(
                  conversation.engagement_kind === "story_mention"
                    ? "inbox.storyMentionBadge"
                    : "inbox.storyReplyBadge",
                )}
              </span>
            )}
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            {/* Tick estilo WhatsApp: solo cuando el ÚLTIMO mensaje lo enviamos
                nosotros. Así se distingue de un vistazo si el último fue mío
                (con su estado de entrega) o de la otra persona. */}
            {(conversation.last_sender_type === "agent" ||
              conversation.last_sender_type === "bot") &&
              conversation.last_message_status && (
                <PreviewTick status={conversation.last_message_status} />
              )}
            {/* Comentario oculto en la publicación: se marca acá también, no
                sólo dentro de la conversación. El texto se sigue leyendo —
                ocultar no borra lo que dijeron— pero desde la lista tiene que
                verse que eso ya no lo ve nadie más. */}
            {conversation.last_message_hidden && (
              <EyeOff
                className="size-3 shrink-0 text-amber-600 dark:text-amber-400"
                aria-label={t("inbox.commentHiddenNotice")}
              />
            )}
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                // Sólo cursiva: el `opacity-70` que llevaba antes bajaba el
                // gris a 2.96:1 sobre la tarjeta clara y la vista previa del
                // mensaje oculto dejaba de leerse.
                conversation.last_message_hidden && "italic",
              )}
            >
              {/* En ML el prefijo del subject ("Pregunta · <id>") repetiría el
                  badge de arriba y el id crudo no aporta — lo omitimos ahí.
                  En TikTok el subject es el caption del video (a menudo un
                  muro de hashtags): se comía la fila entera y tapaba lo único
                  que importa acá, que es el comentario. El caption ya se ve en
                  el banner del hilo. */}
              {conversation.subject &&
              conversation.channel !== "mercadolibre" &&
              conversation.channel !== "tiktok_comment" ? (
                <span className="font-medium text-foreground">{conversation.subject} · </span>
              ) : null}
              {isUnsupportedSnippet(conversation.last_message_text)
                ? t("inbox.unsupported", { channel: channelLabel(conversation.channel, t) })
                : // Mismo criterio que la burbuja: el "@usuario" que IG/FB
                  // anteponen a cada respuesta no se muestra. Sólo en los
                  // canales de comentarios — en un chat, un texto que arranca
                  // con @ es lo que la persona escribió.
                  (conversation.channel === "ig_comment" ||
                  conversation.channel === "fb_comment" ||
                  conversation.channel === "tiktok_comment"
                    ? stripLeadingMentions(
                        localizeContentToken(conversation.last_message_text, t),
                      )
                    : localizeContentToken(conversation.last_message_text, t)) ||
                  t("inbox.noMessages")}
            </span>
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {/* Un caso que el asistente dejó de atender. Se apaga solo al abrir
                el hilo: si siguiera puesto después de leerlo, en un día la
                bandeja entera estaría en rojo y el aviso no diría nada. */}
            {conversation.needs_human_at && !conversation.needs_human_visto_at && (
              <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-400">
                {t("inbox.needsHumanBadge")}
              </span>
            )}
            {conversation.unread_count > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {conversation.unread_count}
              </span>
            )}
            {needsReplyDot(conversation) && (
              <span
                className={cn("h-2 w-2 rounded-full", STATUS_COLORS[conversation.status])}
                title={t("inbox.unreplied")}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}, (a, b) =>
  a.isActive === b.isActive &&
  a.selected === b.selected &&
  a.selectMode === b.selectMode &&
  a.tz === b.tz &&
  a.onDelete === b.onDelete &&
  a.onSelect === b.onSelect &&
  a.onToggleSelected === b.onToggleSelected &&
  a.conversation.id === b.conversation.id &&
  a.conversation.last_message_at === b.conversation.last_message_at &&
  a.conversation.last_message_text === b.conversation.last_message_text &&
  a.conversation.unread_count === b.conversation.unread_count &&
  a.conversation.needs_human_at === b.conversation.needs_human_at &&
  a.conversation.needs_human_visto_at === b.conversation.needs_human_visto_at &&
  a.conversation.status === b.conversation.status &&
  a.conversation.last_sender_type === b.conversation.last_sender_type &&
  a.conversation.last_message_status === b.conversation.last_message_status &&
  a.conversation.last_message_hidden === b.conversation.last_message_hidden &&
  a.conversation.subject === b.conversation.subject &&
  a.conversation.thread_external_id === b.conversation.thread_external_id &&
  a.conversation.is_ad === b.conversation.is_ad &&
  a.conversation.engagement_kind === b.conversation.engagement_kind &&
  a.conversation.contact?.name === b.conversation.contact?.name &&
  a.conversation.contact?.avatar_url === b.conversation.contact?.avatar_url &&
  a.conversation.contact?.email === b.conversation.contact?.email &&
  a.conversation.contact?.phone === b.conversation.contact?.phone &&
  a.conversation.contact?.external_id === b.conversation.contact?.external_id,
);

// Editorial-style empty state. Distintos mensajes según por qué está vacía:
//   - Buscando/filtrando por texto → "sin resultados", ampliar la búsqueda.
//   - Chip de un canal activo sin mensajes → "aún no hay mensajes en este canal".
//   - Canales YA conectados pero sin nada todavía → "aún no llegaron mensajes"
//     (NO mostramos "Conectar un canal": ya está conectado, sería confuso).
//   - Nada conectado → apuntamos a Integraciones para conectar el primer canal.
function InboxEmptyState({
  hasFilters,
  channelActive,
  hasAnyConnection,
}: {
  hasFilters: boolean;
  channelActive: boolean;
  hasAnyConnection: boolean;
}) {
  const t = useT();
  // El CTA "Conectar un canal" solo tiene sentido cuando NO hay ninguna
  // conexión y no se está filtrando.
  const showConnectCta = !hasFilters && !channelActive && !hasAnyConnection;
  const title = hasFilters ? t("inbox.noResults") : t("inbox.emptyInbox");
  const hint = hasFilters
    ? t("inbox.emptyFilteredHint")
    : channelActive
      ? t("inbox.emptyChannelHint")
      : hasAnyConnection
        ? t("inbox.emptyConnectedHint")
        : t("inbox.emptyInboxHint");
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-accent-ink">
        <InboxIcon className="size-7" />
      </div>
      <p className="mt-4 text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
        {hint}
      </p>
      {showConnectCta && (
        <Link
          href="/integraciones"
          className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plug2 className="size-3.5" />
          {t("inbox.connectChannel")}
        </Link>
      )}
    </div>
  );
}

/**
 * The status dot is an unread/unreplied signal — only show it while the
 * conversation is open AND the last message came from the customer.
 * Once an agent (or bot) replies, or the conversation is closed, the
 * dot goes away.
 */
function needsReplyDot(conversation: Conversation): boolean {
  if (conversation.status === "closed") return false;
  const last = conversation.last_sender_type;
  if (last === "agent" || last === "bot") return false;
  return true;
}

/**
 * Tick estilo WhatsApp en el preview de la lista — solo cuando el último
 * mensaje lo enviamos nosotros: ✓ enviado · ✓✓ entregado · ✓✓ azul leído ·
 * ✗ fallido. En canales sin acuse de entrega el estado se queda en "enviado"
 * (✓), que igual sirve para distinguir "lo mandé yo".
 */
function PreviewTick({ status }: { status: MessageStatus }) {
  switch (status) {
    case "sending":
      return <Clock className="size-3 shrink-0 text-muted-foreground" />;
    case "sent":
      return <Check className="size-3 shrink-0 text-muted-foreground" />;
    case "delivered":
      return <CheckCheck className="size-3 shrink-0 text-muted-foreground" />;
    case "read":
      return <CheckCheck className="size-3 shrink-0 text-blue-600 dark:text-blue-400" />;
    case "failed":
      return <XCircle className="size-3 shrink-0 text-red-600 dark:text-red-400" />;
    default:
      return null;
  }
}

/**
 * Best-effort display label for a conversation row. Falls back through
 * the contact's available identifiers, and for Meta DMs (whose names
 * Meta withholds until the app has Advanced Access to
 * instagram_manage_messages / pages_messaging) we render a friendly
 * "Cliente Instagram · ...id" instead of pasting the raw 16-digit PSID.
 */
function resolveDisplayName(
  channel: Conversation["channel"],
  contact: Conversation["contact"],
  t: TFn,
): string {
  if (contact?.name) return contact.name;
  if (contact?.email) return contact.email;
  // Sin nombre: el número formateado ("+54 9 11 6758 0888") es el label menos
  // malo. Con nombre, el número NUNCA aparece en la lista (vive en la barra
  // de contacto al abrir la conversación).
  if (contact?.phone) return formatPhoneDisplay(contact.phone);
  const ext = contact?.external_id;
  if (ext) {
    if (channel === "instagram") return t("inbox.instagramCustomer", { id: ext.slice(-5) });
    if (channel === "messenger") return t("inbox.messengerCustomer", { id: ext.slice(-5) });
    if (channel === "mercadolibre")
      return t("inbox.mercadolibreCustomer", { id: ext.slice(-5) });
    return ext;
  }
  return t("inbox.noName");
}
