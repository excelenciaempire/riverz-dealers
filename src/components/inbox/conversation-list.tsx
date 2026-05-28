"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationStatus } from "@/types";
import { ChannelLogo } from "@/components/inbox/channel-logo";
import { Search, ChevronDown, MoreVertical, Trash2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

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
  closed: "bg-slate-500",
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
      // Per-user scoping: a workspace member only sees conversations
      // from the connections they themselves connected. Without this
      // filter every user in the workspace would see each other's
      // Gmail / Hotmail / WhatsApp threads, which is what we want
      // avoid — "que cada usuario en su cuenta pueda conectar su email".
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
        .eq("created_by", user.id);
      const ownIds = (ownConns ?? []).map((c) => c.id);
      if (ownIds.length === 0) {
        if (!cancelled) {
          onConversationsLoadedRef.current([]);
          setLoading(false);
        }
        return;
      }

      const { data, error } = await supabase
        .from("conversations")
        .select("*, contact:contacts(*)")
        .in("connection_id", ownIds)
        .order("last_message_at", { ascending: false });

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
        const name = c.contact?.name?.toLowerCase() ?? "";
        const phone = c.contact?.phone?.toLowerCase() ?? "";
        const lastMsg = c.last_message_text?.toLowerCase() ?? "";
        return name.includes(q) || phone.includes(q) || lastMsg.includes(q);
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

  const activeFilter = FILTER_OPTIONS.find((o) => o.value === filter);

  return (
    // Always fills its parent. Width is controlled by ResizablePane on
    // desktop (with localStorage persistence) and by the inbox flex row
    // on mobile. Keeping the fixed `lg:w-80` here was overriding the
    // resize drag visually — the inline width from the parent would
    // change but this div stayed pinned at 320px.
    <div className="flex h-full w-full flex-col bg-slate-900">
      {/* Search + Filter */}
      <div className="space-y-2 border-b border-slate-800 p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder="Buscar conversaciones..."
            className="border-slate-700 bg-slate-800 pl-9 text-sm text-white placeholder-slate-500 focus:border-primary/50"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 gap-1 px-2 text-xs text-slate-400 hover:text-white rounded-md hover:bg-slate-800">
              {activeFilter?.label ?? "Todas"}
              <ChevronDown className="h-3 w-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="border-slate-700 bg-slate-800"
          >
            {FILTER_OPTIONS.map((opt) => (
              <DropdownMenuItem
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                className={cn(
                  "text-sm",
                  filter === opt.value
                    ? "text-primary"
                    : "text-slate-300"
                )}
              >
                {opt.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Conversation Items */}
      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-slate-500">No hay conversaciones</p>
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
                tz={tz}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  onDelete?: (id: string) => void;
  tz: string;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onDelete,
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
    onSelect(conversation);
  }, [onSelect, conversation]);

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
        "group relative flex w-full cursor-pointer items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-slate-800/50",
        isActive && "border-l-2 border-primary bg-slate-800/70"
      )}
    >
      {onDelete && (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Acciones"
            className="absolute right-1.5 top-2 hidden h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-700/60 hover:text-white group-hover:flex data-[popup-open]:flex"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreVertical className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="border-slate-700 bg-slate-800"
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
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-700 text-sm font-medium text-white">
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
          className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-900 ring-2 ring-slate-900"
          title={conversation.channel}
        >
          <ChannelLogo channel={conversation.channel} size={12} />
        </span>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-white">
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
          <span className="shrink-0 text-[10px] text-slate-500">{timeAgo}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-xs text-slate-400">
            {conversation.subject ? (
              <span className="font-medium text-slate-300">{conversation.subject} · </span>
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
