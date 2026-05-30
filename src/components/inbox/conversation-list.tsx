"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationStatus } from "@/types";
import { ChannelLogo } from "@/components/inbox/channel-logo";
import {
  Search,
  ChevronDown,
  MoreVertical,
  Trash2,
  CheckSquare,
  Square,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { isToday, isYesterday, isThisWeek, isThisYear } from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { es } from "date-fns/locale";
import { useTimezone } from "@/hooks/use-timezone";
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

const FILTER_OPTIONS: { label: string; value: ConversationStatus | "all" }[] = [
  { label: "Todas", value: "all" },
  { label: "Abiertas", value: "open" },
  { label: "Pendientes", value: "pending" },
  { label: "Cerradas", value: "closed" },
];

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  onConversationDeleted,
  resyncToken = 0,
}: ConversationListProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ConversationStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const tz = useTimezone();

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

      onConversationsLoadedRef.current(data ?? []);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
  }, [resyncToken]);

  const filtered = useMemo(() => {
    let result = conversations;

    if (filter !== "all") {
      result = result.filter((c) => c.status === filter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const haystack = [
          c.contact?.name,
          c.contact?.email,
          c.contact?.phone,
          c.contact?.external_id,
          c.subject,
          c.last_message_text,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      });
    }

    return result;
  }, [conversations, filter, search]);

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
    if (
      !window.confirm(
        `¿Eliminar ${selectedIds.size} conversación(es)? Se quitarán de la bandeja.`,
      )
    )
      return;
    setBulkDeleting(true);
    const ids = [...selectedIds];
    let ok = 0;
    for (const id of ids) {
      try {
        const r = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
        if (r.ok) {
          ok++;
          onConversationDeleted?.(id);
        }
      } catch {
        // best-effort; report the tally at the end
      }
    }
    setBulkDeleting(false);
    setSelectedIds(new Set());
    setSelectMode(false);
    if (ok > 0) toast.success(`${ok} conversación(es) eliminada(s)`);
    if (ok < ids.length) toast.error(`${ids.length - ok} no se pudieron eliminar`);
  }, [selectedIds, onConversationDeleted]);

  const activeFilter = FILTER_OPTIONS.find((o) => o.value === filter);

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
            placeholder="Buscar conversaciones..."
            className="border-border bg-muted pl-9 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"
          />
        </div>

        <div className="flex items-center justify-between">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-accent">
                {activeFilter?.label ?? "Todas"}
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
                  {opt.label}
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
              Cancelar
            </button>
          ) : (
            <button
              onClick={() => setSelectMode(true)}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <CheckSquare className="h-3.5 w-3.5" />
              Seleccionar
            </button>
          )}
        </div>
      </div>

      {/* Conversation Items — native overflow scroll. We dropped the
          base-ui ScrollArea here because its viewport wasn't resolving a
          bounded height inside the resizable flex column, which killed
          wheel scrolling on long lists. A plain overflow-y-auto always
          scrolls. */}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">No hay conversaciones</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
                onDelete={onConversationDeleted}
                selectMode={selectMode}
                selected={selectedIds.has(conv.id)}
                onToggleSelected={toggleSelected}
                tz={tz}
              />
            ))}
          </div>
        )}
      </div>

      {/* Bulk action bar — only while selecting. */}
      {selectMode && (
        <div className="flex items-center justify-between gap-2 border-t border-border bg-card p-3">
          <span className="text-xs text-muted-foreground">
            {selectedIds.size} seleccionada{selectedIds.size === 1 ? "" : "s"}
          </span>
          <button
            onClick={handleBulkDelete}
            disabled={selectedIds.size === 0 || bulkDeleting}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {bulkDeleting ? "Eliminando…" : "Eliminar"}
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

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onDelete,
  selectMode = false,
  selected = false,
  onToggleSelected,
  tz,
}: ConversationItemProps) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = useCallback(
    async (e: React.MouseEvent | Event) => {
      e.preventDefault();
      e.stopPropagation();
      if (deleting) return;
      const name =
        conversation.contact?.name ||
        conversation.contact?.email ||
        conversation.contact?.phone ||
        "esta conversación";
      if (!window.confirm(`¿Eliminar la conversación con ${name}? Se quitará de la bandeja.`)) return;
      setDeleting(true);
      try {
        const r = await fetch(`/api/conversations/${conversation.id}`, { method: "DELETE" });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          toast.error(j.error || "No se pudo eliminar");
          return;
        }
        onDelete?.(conversation.id);
        toast.success("Conversación eliminada");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error de red");
      } finally {
        setDeleting(false);
      }
    },
    [conversation, deleting, onDelete],
  );
  const contact = conversation.contact;
  const displayName =
    contact?.name || contact?.email || contact?.phone || contact?.external_id || "Sin nombre";
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
    if (isYesterday(zoned)) return "Ayer";
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
            aria-label="Acciones"
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
              className="text-sm text-red-400 focus:bg-red-500/10 focus:text-red-300"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Eliminar conversación
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
            {conversation.is_ad && (
              <span
                title="Comentario en un anuncio pagado"
                className="inline-flex items-center rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300 ring-1 ring-amber-500/30"
              >
                Anuncio
              </span>
            )}
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-xs text-muted-foreground">
            {conversation.subject ? (
              <span className="font-medium text-foreground">{conversation.subject} · </span>
            ) : null}
            {conversation.last_message_text || "Sin mensajes aún"}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {conversation.unread_count > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {conversation.unread_count}
              </span>
            )}
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                STATUS_COLORS[conversation.status]
              )}
              title={conversation.status}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
