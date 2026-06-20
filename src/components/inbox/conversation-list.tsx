"use client";

import { useState, useEffect, useCallback, useMemo, useRef, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createClient } from "@/lib/supabase/client";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationStatus } from "@/types";
import { ChannelLogo } from "@/components/inbox/channel-logo";
import Link from "next/link";
import {
  Search,
  ChevronDown,
  MoreVertical,
  Trash2,
  CheckSquare,
  Square,
  X,
  Inbox as InboxIcon,
  Plug2,
} from "lucide-react";
import { toast } from "sonner";
import { isToday, isYesterday, isThisWeek, isThisYear } from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { es } from "date-fns/locale";
import { useTimezone } from "@/hooks/use-timezone";
import { useWorkspace } from "@/hooks/use-workspace";
import { normalize } from "@/lib/text/normalize";
import { useT } from "@/hooks/use-locale";
import type { TFn } from "@/lib/i18n/translate";
import { Input } from "@/components/ui/input";
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
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-primary",
  pending: "bg-amber-500",
  closed: "bg-muted-foreground",
};

const FILTER_OPTIONS: { labelKey: string; value: ConversationStatus | "all" }[] = [
  { labelKey: "inbox.filterAll", value: "all" },
  { labelKey: "inbox.filterOpen", value: "open" },
  { labelKey: "inbox.filterPending", value: "pending" },
  { labelKey: "inbox.filterClosed", value: "closed" },
];

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  onConversationDeleted,
  resyncToken = 0,
}: ConversationListProps) {
  const fetchWithCsrf = useFetchWithCsrf();
  const t = useT();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ConversationStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const tz = useTimezone();
  const { workspace } = useWorkspace();
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
        .in("channel", ["gmail", "outlook"]);
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
        .order("last_message_at", { ascending: false });
      // Show all non-email conversations (RLS already limits to the
      // workspace) plus email conversations from this user's mailboxes.
      query =
        ownEmailIds.length > 0
          ? query.or(
              `channel.not.in.(gmail,outlook),connection_id.in.(${ownEmailIds.join(",")})`,
            )
          : query.not("channel", "in", "(gmail,outlook)");
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

      onConversationsLoadedRef.current((data ?? []) as unknown as Conversation[]);
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

  // Memoize per-row normalized haystacks. Recomputes only when
  // `conversations` changes (not on every keystroke). Without this,
  // typing into the search box was O(N * normalize-cost) per character;
  // with 500 rows that produced visible typing lag.
  const normalizedIndex = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of conversations) {
      map.set(
        c.id,
        normalize(
          [
            c.contact?.name,
            c.contact?.email,
            c.contact?.phone,
            c.contact?.external_id,
            c.subject,
            c.last_message_text,
          ]
            .filter(Boolean)
            .join(" "),
        ),
      );
    }
    return map;
  }, [conversations]);

  const filtered = useMemo(() => {
    let result = conversations;

    if (filter !== "all") {
      result = result.filter((c) => c.status === filter);
    }

    if (search.trim()) {
      // Diacritic-insensitive — "cancion" should match "canción" and
      // "anibal" should match "Aníbal". Both sides go through the same
      // normalize() so the comparison is symmetric.
      const q = normalize(search);
      result = result.filter((c) =>
        normalizedIndex.get(c.id)?.includes(q) ?? false,
      );
    }

    return result;
  }, [conversations, filter, search, normalizedIndex]);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

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
    if (selectedIds.size === 0) return;
    if (!window.confirm(t("inbox.bulkDeleteConfirm", { n: selectedIds.size })))
      return;
    setBulkDeleting(true);
    const ids = [...selectedIds];
    // Parallelize so 50 deletes don't block for 50*RTT. `allSettled`
    // (not `all`) lets one network error fall through without aborting
    // the rest, and still leaves an accurate `ok` count for the toasts.
    const results = await Promise.allSettled(
      ids.map((id) =>
        fetchWithCsrf(`/api/conversations/${id}`, { method: "DELETE" }),
      ),
    );
    let ok = 0;
    results.forEach((res, i) => {
      if (res.status === "fulfilled" && res.value.ok) {
        ok++;
        onConversationDeleted?.(ids[i]);
      }
    });
    setBulkDeleting(false);
    setSelectedIds(new Set());
    setSelectMode(false);
    if (ok > 0) toast.success(t("inbox.bulkDeleteSuccess", { n: ok }));
    if (ok < ids.length) toast.error(t("inbox.bulkDeleteFailed", { n: ids.length - ok }));
  }, [selectedIds, onConversationDeleted, fetchWithCsrf, t]);

  const activeFilter = FILTER_OPTIONS.find((o) => o.value === filter);

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
      {/* Search + Filter */}
      <div className="space-y-2 border-b border-border p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder={t("inbox.search")}
            className="border-border bg-muted pl-9 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"
          />
        </div>

        <div className="flex items-center justify-between">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-accent">
                {activeFilter ? t(activeFilter.labelKey) : t("inbox.filterAll")}
                <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="border-border bg-card"
            >
              {FILTER_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setFilter(opt.value)}
                  className={cn(
                    "text-sm",
                    filter === opt.value
                      ? "text-accent-ink"
                      : "text-foreground"
                  )}
                >
                  {t(opt.labelKey)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {selectMode ? (
            <button
              onClick={exitSelectMode}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              {t("inbox.cancel")}
            </button>
          ) : (
            <button
              onClick={() => setSelectMode(true)}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <CheckSquare className="h-3.5 w-3.5" />
              {t("inbox.select")}
            </button>
          )}
        </div>
      </div>

      {/* Conversation Items — native overflow scroll. We dropped the
          base-ui ScrollArea here because its viewport wasn't resolving a
          bounded height inside the resizable flex column, which killed
          wheel scrolling on long lists. A plain overflow-y-auto always
          scrolls. */}
      <div ref={parentRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <InboxEmptyState
            hasFilters={!!search.trim() || filter !== "all"}
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
          <span className="text-xs text-muted-foreground">
            {t("inbox.selectedCount", { n: selectedIds.size })}
          </span>
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
        toast.error(err instanceof Error ? err.message : t("inbox.networkError"));
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
      return formatInTimeZone(utc, tz, "EEE", { locale: es });
    if (isThisYear(zoned))
      return formatInTimeZone(utc, tz, "d MMM", { locale: es });
    return formatInTimeZone(utc, tz, "d MMM yy", { locale: es });
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
              className="text-sm text-red-600 dark:text-red-400 focus:bg-red-500/10 focus:text-red-300"
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
          {contact?.avatar_url ? (
            <img
              src={contact.avatar_url}
              alt={displayName}
              loading="lazy"
              decoding="async"
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            initials
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
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-xs text-muted-foreground">
            {conversation.subject ? (
              <span className="font-medium text-foreground">{conversation.subject} · </span>
            ) : null}
            {conversation.last_message_text || t("inbox.noMessages")}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
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
  a.conversation.status === b.conversation.status &&
  a.conversation.last_sender_type === b.conversation.last_sender_type &&
  a.conversation.subject === b.conversation.subject &&
  a.conversation.is_ad === b.conversation.is_ad &&
  a.conversation.contact?.name === b.conversation.contact?.name &&
  a.conversation.contact?.avatar_url === b.conversation.contact?.avatar_url &&
  a.conversation.contact?.email === b.conversation.contact?.email &&
  a.conversation.contact?.phone === b.conversation.contact?.phone &&
  a.conversation.contact?.external_id === b.conversation.contact?.external_id,
);

// Editorial-style empty state. Two paths: the merchant is filtering /
// searching (we tell them to widen the filter) vs. the bandeja is
// genuinely empty (we point them at the integrations page so they can
// connect a channel and start receiving messages).
function InboxEmptyState({ hasFilters }: { hasFilters: boolean }) {
  const t = useT();
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-accent-ink">
        <InboxIcon className="size-7" />
      </div>
      <p className="mt-4 text-sm font-semibold text-foreground">
        {hasFilters ? t("inbox.noResults") : t("inbox.emptyInbox")}
      </p>
      <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
        {hasFilters
          ? t("inbox.emptyFilteredHint")
          : t("inbox.emptyInboxHint")}
      </p>
      {!hasFilters && (
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
  if (contact?.phone) return contact.phone;
  const ext = contact?.external_id;
  if (ext) {
    if (channel === "instagram") return t("inbox.instagramCustomer", { id: ext.slice(-5) });
    if (channel === "messenger") return t("inbox.messengerCustomer", { id: ext.slice(-5) });
    return ext;
  }
  return t("inbox.noName");
}
