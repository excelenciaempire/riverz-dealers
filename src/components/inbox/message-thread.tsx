"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { mlThreadKind } from "@/lib/channels/display";
import { formatPhoneDisplay } from "@/lib/whatsapp/phone-utils";
import type {
  Conversation,
  Message,
  MessageReaction,
  Contact,
  ConversationStatus,
  MessageTemplate,
  NeedsHumanReason,
  Profile,
} from "@/types";
import {
  MessageSquare,
  ChevronDown,
  UserPlus,
  Check,
  Clock,
  ArrowLeft,
  RefreshCw,
  ChevronUp,
  PanelRight,
  Bot,
  UserRound,
} from "lucide-react";
import { format, isToday, isYesterday, differenceInHours } from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { useTimezone } from "@/hooks/use-timezone";
import { useT, useLocale } from "@/hooks/use-locale";
import type { TFn } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/config";
import { dateFnsLocale } from "@/lib/i18n/format";
import { Badge } from "@/components/ui/badge";
import { MlKindBadge } from "@/components/inbox/ml-kind-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble } from "./message-bubble";
import { MessageActions } from "./message-actions";
import { MessageComposer } from "./message-composer";
import { PendingReplyCard } from "./pending-reply-card";
import { VoiceCallCard } from "./voice-call-view";
import { TemplatePicker } from "./template-picker";
import { buildReplyPreview } from "./reply-quote";
import { originLabelKey } from "@/lib/inbox/message-origin";
import { toast } from "sonner";

interface ReplyDraft {
  id: string;
  authorLabel: string;
  preview: string;
}

/**
 * Etiqueta de la funcionalidad que envió el mensaje (migración 143):
 * "Automatización · Carrito abandonado", "Comentarios IA", "Flujo"…
 * `null` cuando lo escribió una persona, para que su burbuja no lleve nada.
 */
function originLabel(m: Message, t: TFn): string | null {
  if (!m.origin) return null;
  const label = t(originLabelKey(m.origin));
  return m.origin_name ? `${label} · ${m.origin_name}` : label;
}

function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    return params[idx] ?? `{{${raw}}}`;
  });
}

interface MessageThreadProps {
  conversation: Conversation | null;
  contact: Contact | null;
  messages: Message[];
  onMessagesLoaded: (messages: Message[]) => void;
  onNewMessage: (message: Message) => void;
  onUpdateMessage: (id: string, updates: Partial<Message>) => void;
  /** Optional — when set, the per-message actions bar renders a delete
   *  button that calls this with the deleted message's id so the parent
   *  can drop it from its state. The DELETE API call lives in the
   *  actions bar; the parent's job is just to forget the row. */
  onDeleteMessage?: (id: string) => void;
  onStatusChange: (conversationId: string, status: ConversationStatus) => void;
  onAssignChange: (
    conversationId: string,
    assignedAgentId: string | null,
  ) => void;
  /**
   * On mobile, the thread is shown full-screen with the conversation list
   * hidden. This callback lets the page deselect the active conversation
   * and reveal the list again. Rendered as a back-arrow in the header on
   * mobile only.
   */
  onBack?: () => void;
  /**
   * Increment to force the messages + reactions fetch effects to refire.
   * Parent bumps this on realtime reconnect / tab visibility → visible
   * so the open thread catches up on any events sent while the WS was
   * disconnected or the tab was throttled. Optional so existing callers
   * keep working.
   */
  resyncToken?: number;
  /**
   * Fired by the manual-refresh button in the thread header. The parent
   * typically bumps the same `resyncToken` it controls — this gives the
   * user a way to force a refetch when they suspect realtime missed an
   * event (or they're impatient). Optional so existing callers keep
   * working; the button is only rendered when this is provided.
   */
  onRefresh?: () => void;
  /** Whether the right-hand contact panel is currently open. */
  contactPanelOpen?: boolean;
  /** Toggles the contact panel. When provided, the header shows a button
   *  (desktop only) to open/close it — the panel is collapsed by default. */
  onToggleContactPanel?: () => void;
}

function formatDateSeparator(
  dateStr: string,
  tz: string,
  t: TFn,
  locale: Locale,
): string {
  const utc = new Date(dateStr);
  const zoned = toZonedTime(utc, tz);
  if (isToday(zoned)) return t("inbox.today");
  if (isYesterday(zoned)) return t("inbox.yesterday");
  // Spanish uses "d 'de' MMMM 'de' yyyy" (21 de junio de 2026); English
  // uses "MMMM d, yyyy" (June 21, 2026).
  const pattern = locale === "en" ? "MMMM d, yyyy" : "d 'de' MMMM 'de' yyyy";
  return formatInTimeZone(utc, tz, pattern, { locale: dateFnsLocale(locale) });
}

function groupMessagesByDate(messages: Message[], tz: string) {
  const groups: { date: string; messages: Message[] }[] = [];
  let currentDate = "";

  for (const msg of messages) {
    // Day key has to be computed in the user's tz, otherwise a message
    // sent at 23:30 local would land in the next day's group.
    const day = formatInTimeZone(new Date(msg.created_at), tz, "yyyy-MM-dd");
    if (day !== currentDate) {
      currentDate = day;
      groups.push({ date: msg.created_at, messages: [msg] });
    } else {
      groups[groups.length - 1].messages.push(msg);
    }
  }

  return groups;
}

/** Motivo del escalamiento → clave i18n del aviso (migración 122). */
const NEEDS_HUMAN_REASON_KEY: Record<NeedsHumanReason, string> = {
  escalation_keyword: "inbox.needsHumanKeyword",
  escalate_after_messages: "inbox.needsHumanMaxReplies",
  flow_handoff: "inbox.needsHumanFlow",
};

const STATUS_OPTIONS: { labelKey: string; value: ConversationStatus; color: string }[] = [
  { labelKey: "inbox.statusOpen", value: "open", color: "text-accent-ink" },
  { labelKey: "inbox.statusPending", value: "pending", color: "text-amber-600 dark:text-amber-400" },
  { labelKey: "inbox.statusClosed", value: "closed", color: "text-muted-foreground" },
];

/**
 * WhatsApp-style doodle background applied to the chat area (both the
 * active thread and the empty state). The SVG tile lives at
 * `/public/inbox-doodle.svg`; the background colour sits underneath so
 * the doodles read as a subtle pattern rather than a stark grid.
 *
 * Defined once at module scope so the two render paths can't drift —
 * if we ever switch the asset, both spots update together.
 */
const DOODLE_BG_CLASSES =
  "bg-background bg-[url('/inbox-doodle.svg')] bg-repeat";

export function MessageThread({
  conversation,
  contact,
  messages,
  onMessagesLoaded,
  onNewMessage,
  onUpdateMessage,
  onDeleteMessage,
  onStatusChange,
  onAssignChange,
  onBack,
  resyncToken = 0,
  onRefresh,
  contactPanelOpen = false,
  onToggleContactPanel,
}: MessageThreadProps) {
  const { user } = useAuth();
  const fetchWithCsrf = useFetchWithCsrf();
  const tz = useTimezone();
  const t = useT();
  const { locale } = useLocale();
  const [loading, setLoading] = useState(false);
  // Toggle de IA por conversación (migración 082). Se sincroniza con la
  // conversación; en false el asistente no responde en este chat (se suma
  // a la regla de "responder aunque haya agente asignado" del runner).
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiToggling, setAiToggling] = useState(false);
  useEffect(() => {
    setAiEnabled(conversation?.ai_enabled !== false);
  }, [conversation?.id, conversation?.ai_enabled]);

  // ¿Hay un agente IA que cubra el canal de ESTA conversación? Si no, el
  // toggle "IA activa/en pausa" es engañoso (no hay quién responda), así que
  // no lo mostramos. Un agente cubre el canal si está activo y es
  // workspace-scoped (todos los canales) o channel-scoped con el canal
  // enlazado en ai_agent_channels — misma regla que pickAgent en el runner.
  const [hasAgentForChannel, setHasAgentForChannel] = useState(false);
  const convChannel = conversation?.channel;
  useEffect(() => {
    if (!convChannel) {
      setHasAgentForChannel(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("ai_agents")
        .select("scope, ai_agent_channels(channel)")
        .eq("is_active", true)
        .is("deleted_at", null);
      if (cancelled) return;
      if (error) {
        // Fail-open: si no podemos verificar, mostramos el toggle como antes
        // en vez de esconderlo por un error de red.
        setHasAgentForChannel(true);
        return;
      }
      const covers = (data ?? []).some((a) => {
        const row = a as {
          scope: string;
          ai_agent_channels: { channel: string }[] | null;
        };
        if (row.scope === "workspace") return true;
        return (row.ai_agent_channels ?? []).some(
          (c) => c.channel === convChannel,
        );
      });
      setHasAgentForChannel(covers);
    })();
    return () => {
      cancelled = true;
    };
  }, [convChannel]);
  const toggleAi = useCallback(async () => {
    if (!conversation || aiToggling) return;
    const next = !aiEnabled;
    setAiToggling(true);
    setAiEnabled(next); // optimista
    try {
      const res = await fetchWithCsrf(`/api/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ai_enabled: next }),
      });
      if (!res.ok) throw new Error("failed");
    } catch {
      setAiEnabled(!next); // revertir si falla
    } finally {
      setAiToggling(false);
    }
  }, [conversation, aiEnabled, aiToggling, fetchWithCsrf]);
  // Pagination cursor — created_at of the oldest message currently loaded.
  // The "Cargar más antiguos" button reads from this to fetch the next
  // page (created_at < oldestLoadedAt). Reset whenever the conversation
  // changes or a fresh fetch lands. `hasMore` flips to false once the
  // server returns less than PAGE_SIZE rows.
  const PAGE_SIZE = 100;
  const [oldestLoadedAt, setOldestLoadedAt] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // The conversation whose messages are currently loaded — lets the fetch
  // effect tell a real conversation switch (show spinner) from a resync
  // refetch (stay silent) when only resyncToken changed.
  const loadedConvRef = useRef<string | null>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  // Resolved publication a comment thread belongs to (thumbnail +
  // caption + permalink), fetched lazily when a comment conversation
  // opens so the agent sees which ad/post the comment is on.
  const [postPreview, setPostPreview] = useState<{
    permalink?: string;
    image?: string;
    caption?: string;
    isAd?: boolean;
    adId?: string;
  } | null>(null);
  const [commentCount, setCommentCount] = useState<number | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  // Purely visual spin state for the manual-refresh button. The actual
  // refetch is fire-and-forget through `onRefresh` (which bumps the
  // parent's resyncToken); the 700ms spin is just feedback so the click
  // doesn't feel like a no-op. Cleared via the timer ref on unmount.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);
  const handleRefreshClick = useCallback(() => {
    if (isRefreshing || !onRefresh) return;
    setIsRefreshing(true);
    onRefresh();
    refreshTimerRef.current = setTimeout(() => {
      setIsRefreshing(false);
      refreshTimerRef.current = null;
    }, 700);
  }, [isRefreshing, onRefresh]);
  const [replyTo, setReplyTo] = useState<ReplyDraft | null>(null);

  // Profiles are bounded by RLS to rows the current user is allowed to
  // see — today that's just the current user, but the dropdown keeps the
  // shape ready for shared-team workspaces without a refactor.
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("*")
      .order("full_name")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to fetch profiles:", error);
          return;
        }
        setProfiles((data as Profile[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolve the publication a comment thread is about (thumbnail +
  // caption + permalink) so the agent sees which ad/post it's on.
  useEffect(() => {
    setPostPreview(null);
    const convId = conversation?.id;
    const ch = conversation?.channel;
    if (
      !convId ||
      (ch !== "fb_comment" && ch !== "ig_comment" && ch !== "tiktok_comment")
    )
      return;
    let cancelled = false;
    fetch(`/api/conversations/${convId}/post-preview`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setPostPreview(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [conversation?.id, conversation?.channel]);

  // Read the customer comments on this post/media straight from Graph
  // (user-generated content). This live call exercises
  // pages_read_user_content (FB) / instagram_manage_comments (IG) and
  // surfaces how many comments the post has. Best-effort: the thread still
  // renders if it fails.
  useEffect(() => {
    setCommentCount(null);
    const convId = conversation?.id;
    const ch = conversation?.channel;
    if (!convId || (ch !== "fb_comment" && ch !== "ig_comment")) return;
    let cancelled = false;
    fetch(`/api/conversations/${convId}/comment-context`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !Array.isArray(data?.comments)) return;
        setCommentCount(data.comments.length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [conversation?.id, conversation?.channel]);

  // TikTok no entrega comentarios en tiempo real por ninguna vía (su propio
  // webhook se dispara "dentro de 5 min"), así que el hilo ABIERTO se pone al
  // día contra la API cada 15 s mientras la pestaña esté visible. Lo que entra
  // llega por realtime, así que acá no hay que refetchear nada; el servidor
  // ignora las llamadas repetidas del mismo video en menos de 8 s.
  useEffect(() => {
    const convId = conversation?.id;
    if (!convId || conversation?.channel !== "tiktok_comment") return;
    let cancelled = false;
    const tick = () => {
      if (cancelled || document.visibilityState !== "visible") return;
      fetchWithCsrf(`/api/conversations/${convId}/tiktok-refresh`, {
        method: "POST",
      }).catch(() => {});
    };
    tick();
    const timer = setInterval(tick, 15_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [conversation?.id, conversation?.channel, fetchWithCsrf]);

  // 24-hour session timer
  const sessionInfo = useMemo(() => {
    if (!messages.length) return { expired: false, remaining: "" };

    // Find last customer message
    const lastCustomerMsg = [...messages]
      .reverse()
      .find((m) => m.sender_type === "customer");

    if (!lastCustomerMsg) return { expired: true, remaining: t("inbox.noCustomerMessages") };

    const hoursSince = differenceInHours(new Date(), new Date(lastCustomerMsg.created_at));
    const expired = hoursSince >= 24;

    if (expired) {
      return { expired: true, remaining: t("inbox.sessionExpired") };
    }

    const hoursLeft = 24 - hoursSince;
    const remaining =
      hoursLeft >= 1
        ? t("inbox.hoursRemaining", { n: Math.floor(hoursLeft) })
        : t("inbox.minutesRemaining", { n: Math.floor(hoursLeft * 60) });

    return { expired, remaining };
  }, [messages, t]);

  // Store latest callback in a ref so fetchMessages doesn't need to
  // depend on `onMessagesLoaded` — otherwise parent re-renders cause
  // fetchMessages to change → useEffect re-fires → refetch → realtime
  // UPDATE on conversations.unread_count → parent re-renders → LOOP.
  // The ref is written inside an effect so the mutation doesn't happen
  // during render (React 19 refs rule); consumers only read `.current`
  // inside the async fetch completion, which runs after the render.
  const onMessagesLoadedRef = useRef(onMessagesLoaded);
  useEffect(() => {
    onMessagesLoadedRef.current = onMessagesLoaded;
  });

  const conversationId = conversation?.id;
  const hasUnread = (conversation?.unread_count ?? 0) > 0;

  // Al abrir un chat de Messenger/Instagram le pedimos a Meta el historial del
  // hilo y rellenamos lo que falte: mensajes que no llegaron por webhook y
  // respuestas mandadas desde la app de Meta. El servidor limita la frecuencia
  // (synced_at), así que abrir y cerrar no bombardea a Graph. Si trajo algo,
  // volvemos a leer los mensajes.
  const [historyNonce, setHistoryNonce] = useState(0);
  useEffect(() => {
    if (!conversationId) return;
    if (convChannel !== "messenger" && convChannel !== "instagram") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithCsrf(`/api/conversations/${conversationId}/sync`, {
          method: "POST",
        });
        if (cancelled || !res.ok) return;
        const json = (await res.json()) as { ingested?: number };
        if (!cancelled && (json.ingested ?? 0) > 0) setHistoryNonce((n) => n + 1);
      } catch {
        // Rellenar el historial es un extra: si falla, el hilo se ve igual.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, convChannel, fetchWithCsrf]);

  // Fetch messages whenever the selected conversation changes. Kept
  // separate from the unread-reset effect so that incoming messages
  // arriving while the thread is open don't trigger a full refetch —
  // they only flip hasUnread, which only the reset effect listens to.
  useEffect(() => {
    if (!conversationId) {
      loadedConvRef.current = null;
      return;
    }

    const supabase = createClient();
    let cancelled = false;
    // A resync (same conversation, bumped resyncToken from tab refocus / WS
    // reconnect) refetches SILENTLY — no full-screen spinner — so returning to
    // the tab doesn't flash. The spinner only shows on a real conversation
    // switch or first open.
    const isResync = loadedConvRef.current === conversationId;

    (async () => {
      if (!isResync) {
        setLoading(true);
        setHasMore(false);
        setOldestLoadedAt(null);
      }

      // Fetch the most recent PAGE_SIZE rows by ordering DESC + limiting,
      // then reverse client-side so the existing render loop (which
      // expects oldest-first) keeps working. Loading only the last page
      // keeps long-lived chats from dragging in thousands of rows on
      // every open.
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);

      if (cancelled) return;

      if (error) {
        console.error("Failed to fetch messages:", error);
      } else {
        const rows = (data ?? []).slice().reverse();
        onMessagesLoadedRef.current(rows);
        if (rows.length > 0) setOldestLoadedAt(rows[0].created_at);
        setHasMore((data ?? []).length === PAGE_SIZE);
        loadedConvRef.current = conversationId;
      }

      if (!cancelled && !isResync) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus —
    // realtime is best-effort and any message events sent while the WS
    // was disconnected or throttled are otherwise lost. `historyNonce`
    // hace lo mismo cuando el relleno de historial trajo mensajes viejos.
  }, [conversationId, resyncToken, historyNonce]);

  // Reactions fetch — pulls the current state from the DB. Kept separate
  // from the channel subscription below so a `resyncToken` bump just
  // refetches the rows without also tearing down and rebuilding the
  // realtime channel.
  useEffect(() => {
    if (!conversationId) {
      setReactions([]);
      return;
    }
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("message_reactions")
        .select("*")
        .eq("conversation_id", conversationId);
      if (cancelled) return;
      if (error) {
        console.error("Failed to fetch reactions:", error);
        return;
      }
      setReactions((data as MessageReaction[]) ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, resyncToken]);

  // Reactions realtime subscription per conversation. Subscribing here
  // (not at the page level) keeps the channel scoped to the visible
  // conversation and avoids cross-conversation chatter on a busy inbox.
  useEffect(() => {
    if (!conversationId) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`reactions:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => {
            if (prev.some((r) => r.id === row.id)) return prev;
            // Swap any matching optimistic temp row for the real one so
            // the pill doesn't double up after a successful POST.
            const tempIdx = prev.findIndex(
              (r) =>
                r.id.startsWith("temp-") &&
                r.message_id === row.message_id &&
                r.actor_type === row.actor_type &&
                r.actor_id === row.actor_id,
            );
            if (tempIdx >= 0) {
              const copy = prev.slice();
              copy[tempIdx] = row;
              return copy;
            }
            return [...prev, row];
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => prev.map((r) => (r.id === row.id ? row : r)));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const old = payload.old as Partial<MessageReaction>;
          if (!old?.id) return;
          setReactions((prev) => prev.filter((r) => r.id !== old.id));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  // Clear any in-progress reply draft when the active conversation changes —
  // a quote pulled from conversation A shouldn't bleed into conversation B.
  useEffect(() => {
    setReplyTo(null);
  }, [conversationId]);

  // Reset the server-side unread_count to 0 whenever an unread count
  // surfaces on the active conversation — covers both (a) opening a
  // conversation that had unread messages and (b) new messages arriving
  // while the user is already viewing the thread (webhook server-bumps
  // unread_count to N+1; the realtime UPDATE propagates it into the
  // client, which re-runs this effect and flips it back to 0).
  //
  // Guarding on hasUnread prevents the eq-update loop: once unread_count
  // is 0 the condition is false, so no further UPDATE is issued.
  useEffect(() => {
    if (!conversationId || !hasUnread) return;
    const supabase = createClient();
    supabase
      .from("conversations")
      .update({ unread_count: 0 })
      .eq("id", conversationId)
      .then(({ error }) => {
        if (error) console.error("Failed to reset unread_count:", error);
      });
  }, [conversationId, hasUnread]);

  // Auto-scroll to bottom on new messages. Suppressed while a
  // "Cargar más antiguos" fetch is in flight so prepending older rows
  // doesn't yank the scroll position to the bottom — handleLoadOlder
  // restores the user's anchor itself once the new rows render.
  useEffect(() => {
    if (loadingOlder) return;
    if (scrollRef.current) {
      const el = scrollRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, loadingOlder]);

  const handleSend = useCallback(
    async (text: string, replyToId?: string) => {
      if (!conversation) return;

      const tempId = `temp-${Date.now()}`;

      // Optimistic update — shows the message immediately with "sending" status
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        channel: conversation.channel,
        sender_type: "agent",
        content_type: "text",
        content_text: text,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: replyToId,
      };
      onNewMessage(optimisticMsg);
      setReplyTo(null);

      try {
        const res = await fetchWithCsrf("/api/messages/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            text,
            reply_to_external_id: replyToId,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error("Failed to send message:", reason);
          toast.error(t("inbox.sendFailed", { reason }));
          onUpdateMessage(tempId, { status: "failed" });
          return;
        }

        onUpdateMessage(tempId, { status: "sent" });
      } catch (err) {
        console.error("Failed to send message:", err);
        const reason = t("inbox.networkErrorReason");
        toast.error(t("inbox.sendFailed", { reason }));
        onUpdateMessage(tempId, { status: "failed" });
      }
    },
    [conversation, onNewMessage, onUpdateMessage, fetchWithCsrf, t]
  );

  const handleSendMedia = useCallback(
    async (file: File, caption: string, replyToId?: string) => {
      if (!conversation) return;
      const tempId = `temp-${Date.now()}`;
      const localUrl = URL.createObjectURL(file);
      const kind: "image" | "video" | "audio" | "document" =
        file.type.startsWith("image/")
          ? "image"
          : file.type.startsWith("video/")
            ? "video"
            : file.type.startsWith("audio/")
              ? "audio"
              : "document";

      // Optimistic bubble with a local blob preview while it uploads/sends.
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        channel: conversation.channel,
        sender_type: "agent",
        content_type: kind,
        content_text: caption || undefined,
        media_url: localUrl,
        media_type: kind,
        media_mime: file.type,
        media_size: file.size,
        attachments: [
          { url: localUrl, mime_type: file.type, name: file.name, size: file.size },
        ],
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: replyToId,
      };
      onNewMessage(optimisticMsg);
      setReplyTo(null);

      try {
        // 1) Upload the file to Storage.
        const fd = new FormData();
        fd.append("file", file);
        fd.append("conversation_id", conversation.id);
        const up = await fetchWithCsrf("/api/messages/upload", { method: "POST", body: fd });
        const upJson = await up.json().catch(() => ({}));
        if (!up.ok) throw new Error(upJson?.error || `HTTP ${up.status}`);

        // 2) Send it through the channel.
        const res = await fetchWithCsrf("/api/messages/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            text: caption || undefined,
            media: {
              url: upJson.url,
              mediaType: upJson.mediaType,
              mime: upJson.mime,
              name: upJson.name,
              filename: upJson.name,
              size: upJson.size,
            },
          }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
        // Swap the blob preview for the persisted public URL.
        onUpdateMessage(tempId, { status: "sent", media_url: upJson.url });
      } catch (err) {
        const reason = t("inbox.networkErrorReason");
        toast.error(t("inbox.sendFailed", { reason }));
        onUpdateMessage(tempId, { status: "failed" });
      } finally {
        URL.revokeObjectURL(localUrl);
      }
    },
    [conversation, onNewMessage, onUpdateMessage, fetchWithCsrf, t],
  );

  const handleStatusChange = useCallback(
    async (status: ConversationStatus) => {
      if (!conversation) return;

      const supabase = createClient();
      // closed_at gates the "Resueltas hoy" dashboard metric. We stamp
      // it on transitions into 'closed' and clear it when the user
      // re-opens a previously-closed thread so the count stays honest.
      const patch: {
        status: ConversationStatus;
        closed_at: string | null;
        needs_human_reason?: null;
        needs_human_at?: null;
      } = {
        status,
        closed_at: status === "closed" ? new Date().toISOString() : null,
      };
      // Sacarla de 'pendiente' significa que alguien ya la atendió: se cierra
      // el escalamiento para que el contador de la bandeja no quede inflado.
      if (status !== "pending") {
        patch.needs_human_reason = null;
        patch.needs_human_at = null;
      }
      await supabase
        .from("conversations")
        .update(patch)
        .eq("id", conversation.id);

      onStatusChange(conversation.id, status);
    },
    [conversation, onStatusChange]
  );

  const handleOpenTemplates = useCallback(() => {
    setTemplateModalOpen(true);
  }, []);

  const handleSendTemplate = useCallback(
    async (template: MessageTemplate, params: string[]) => {
      if (!conversation) return;

      const renderedBody = renderTemplateBody(template.body_text, params);
      const tempId = `temp-${Date.now()}`;

      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        channel: conversation.channel,
        sender_type: "agent",
        content_type: "template",
        content_text: renderedBody,
        template_name: template.name,
        status: "sending",
        created_at: new Date().toISOString(),
      };
      onNewMessage(optimisticMsg);

      try {
        const res = await fetchWithCsrf("/api/messages/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            template_name: template.name,
            template_language: template.language,
            template_params: params,
            // Rendered preview — what the thread shows for the sent template.
            text: renderedBody,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error("Failed to send template:", reason);
          toast.error(t("inbox.sendFailed", { reason }));
          onUpdateMessage(tempId, { status: "failed" });
          return;
        }

        onUpdateMessage(tempId, { status: "sent" });
      } catch (err) {
        console.error("Failed to send template:", err);
        const reason = t("inbox.networkErrorReason");
        toast.error(t("inbox.sendFailed", { reason }));
        onUpdateMessage(tempId, { status: "failed" });
      }
    },
    [conversation, onNewMessage, onUpdateMessage, fetchWithCsrf, t],
  );

  // Build a quick id → Message map so reply quotes can be rendered without
  // an extra fetch — the thread already holds the full conversation.
  const messagesById = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  // Bucket reactions by their target message_id for O(1) per-bubble lookup.
  const reactionsByMessageId = useMemo(() => {
    const map = new Map<string, MessageReaction[]>();
    for (const r of reactions) {
      const bucket = map.get(r.message_id);
      if (bucket) bucket.push(r);
      else map.set(r.message_id, [r]);
    }
    return map;
  }, [reactions]);

  const contactDisplayName =
    contact?.name || (contact?.phone ? formatPhoneDisplay(contact.phone) : "") || t("inbox.customer");

  // Map agent user_id → full name so a teammate's message shows their
  // name instead of a flat "Tú". Populated from `profiles`, which RLS
  // now scopes to workspace teammates (migration 062).
  const nameByUserId = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of profiles) if (p.user_id) m.set(p.user_id, p.full_name);
    return m;
  }, [profiles]);

  // Display name for a message's author. Customer → contact name; bot →
  // "Asistente IA"; your own agent message → "Tú"; a teammate's agent
  // message → their full name (falls back to "Agente" if the profile
  // isn't visible). Used for both bubbles and quoted-reply labels.
  const authorLabelFor = useCallback(
    (m: Message): string => {
      if (m.sender_type === "customer") return contactDisplayName;
      // Lo que el mensaje DICE de sí mismo manda sobre cualquier deducción
      // (migración 143): el asistente, un seguimiento, una automatización, un
      // flujo, una campaña, Comentarios o el agente de voz se nombran solos.
      const stamped = originLabel(m, t);
      if (stamped) return stamped;
      if (m.sender_type === "bot") {
        // Sin sello (mensajes anteriores a la migración): la vieja deducción.
        return m.content_type === "template"
          ? t("inbox.automation")
          : t("inbox.aiAssistant");
      }
      if (m.sender_id && m.sender_id === user?.id) return t("inbox.you");
      if (m.sender_id) return nameByUserId.get(m.sender_id) ?? t("inbox.agent");
      return t("inbox.you");
    },
    [contactDisplayName, nameByUserId, user?.id, t],
  );

  const handleStartReply = useCallback(
    (msg: Message) => {
      setReplyTo({
        id: msg.id,
        authorLabel: authorLabelFor(msg),
        preview: buildReplyPreview(msg, t),
      });
    },
    [authorLabelFor, t],
  );

  const handleDeleteMessage = useCallback(
    (messageId: string) => {
      onDeleteMessage?.(messageId);
    },
    [onDeleteMessage],
  );

  // Single reaction-set primitive. emoji === "" removes; otherwise adds/swaps.
  // The "toggle" semantic (pill click) is computed at the call site where the
  // current reactions for the bubble are already in scope — keeps this
  // function dependency-free w.r.t. the reaction list.
  const postReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!user?.id || !conversation) {
        console.warn("[reactions] missing user or conversation");
        return;
      }
      if (messageId.startsWith("temp-")) {
        toast.error(t("inbox.waitForSend"));
        return;
      }

      const convId = conversation.id;
      const userId = user.id;
      let snapshot: MessageReaction[] = [];

      // Functional updater — captures the freshest reactions list, never a
      // stale closure. Snapshot stored for rollback on POST failure.
      setReactions((prev) => {
        snapshot = prev;
        const own = prev.find(
          (r) =>
            r.message_id === messageId &&
            r.actor_type === "agent" &&
            r.actor_id === userId,
        );
        if (emoji === "") return own ? prev.filter((r) => r !== own) : prev;
        if (own) return prev.map((r) => (r === own ? { ...own, emoji } : r));
        return [
          ...prev,
          {
            id: `temp-${Date.now()}`,
            message_id: messageId,
            conversation_id: convId,
            actor_type: "agent",
            actor_id: userId,
            emoji,
            created_at: new Date().toISOString(),
          },
        ];
      });

      try {
        const res = await fetchWithCsrf("/api/whatsapp/react", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message_id: messageId, emoji }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.error || `HTTP ${res.status}`);
        }
      } catch (err) {
        const reason = t("inbox.networkErrorReason");
        toast.error(t("inbox.reactFailed", { reason }));
        setReactions(snapshot);
      }
    },
    [conversation, user?.id, fetchWithCsrf, t],
  );

  // "Cargar más antiguos" — fetches the next PAGE_SIZE rows whose
  // created_at < oldestLoadedAt, prepends them in chronological order,
  // and updates the cursor. Scroll position is anchored to the previous
  // top message so the user doesn't get yanked while older history loads.
  const handleLoadOlder = useCallback(async () => {
    if (!conversation || !oldestLoadedAt || loadingOlder) return;
    setLoadingOlder(true);
    const scroller = scrollRef.current;
    const prevScrollHeight = scroller?.scrollHeight ?? 0;
    const prevScrollTop = scroller?.scrollTop ?? 0;
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversation.id)
        .lt("created_at", oldestLoadedAt)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (error) {
        console.error("Failed to load older messages:", error);
        toast.error(t("inbox.loadOlderFailed"));
        return;
      }
      const older = (data ?? []).slice().reverse();
      if (older.length > 0) {
        onMessagesLoadedRef.current([...older, ...messages]);
        setOldestLoadedAt(older[0].created_at);
      }
      setHasMore((data ?? []).length === PAGE_SIZE);
      // Restore scroll so the message the user was looking at stays put
      // after the new rows are prepended. requestAnimationFrame waits for
      // React to paint the new layout before reading scrollHeight.
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (!el) return;
        const delta = el.scrollHeight - prevScrollHeight;
        el.scrollTop = prevScrollTop + delta;
      });
    } finally {
      setLoadingOlder(false);
    }
  }, [conversation, messages, oldestLoadedAt, loadingOlder, t]);

  const handleAssignChange = useCallback(
    async (agentId: string | null) => {
      if (!conversation) return;

      const supabase = createClient();
      const { error } = await supabase
        .from("conversations")
        .update({ assigned_agent_id: agentId })
        .eq("id", conversation.id);

      if (error) {
        console.error("Failed to update assignment:", error);
        toast.error(t("inbox.assignFailed"));
        return;
      }

      onAssignChange(conversation.id, agentId);
    },
    [conversation, onAssignChange, t],
  );

  // Empty state — same WhatsApp-style doodle background as the active
  // thread below, so swapping between empty/selected doesn't change the
  // pattern under the user's eye. Pitched as a quick orientation card
  // so a fresh user knows what each tab is for instead of staring at an
  // icon and a one-liner.
  if (!conversation || !contact) {
    return (
      <div
        className={cn(
          "flex flex-1 flex-col items-center justify-center px-6 py-8",
          DOODLE_BG_CLASSES,
        )}
      >
        <div className="flex flex-col items-center rounded-2xl border border-border bg-card/80 p-6 backdrop-blur">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 ring-1 ring-primary/30">
            <MessageSquare className="h-6 w-6 text-accent-ink" />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            {t("inbox.selectConversation")}
          </p>
        </div>
      </div>
    );
  }

  const displayName =
    contact.name ||
    contact.email ||
    (contact.phone ? formatPhoneDisplay(contact.phone) : "") ||
    (conversation.channel === "mercadolibre" && contact.external_id
      ? t("inbox.mercadolibreCustomer", { id: contact.external_id.slice(-5) })
      : "") ||
    contact.external_id ||
    t("inbox.contactFallback");
  const messageGroups = groupMessagesByDate(messages, tz);
  const currentStatus = STATUS_OPTIONS.find(
    (s) => s.value === conversation.status
  );
  const assignedAgentId = conversation.assigned_agent_id ?? null;
  const currentAssignee = profiles.find((p) => p.user_id === assignedAgentId);
  const assignLabel = assignedAgentId
    ? (currentAssignee?.full_name ?? t("inbox.assigned"))
    : t("inbox.assign");

  return (
    <div className={cn("flex flex-1 flex-col", DOODLE_BG_CLASSES)}>
      {/* Header — solid bg-card sits on top of the doodle so the
          name/avatar/dropdowns stay legible. */}
      <div className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {/* Back-to-list button — mobile only. Hidden on lg+ where the
              conversation list is always visible next to the thread. */}
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label={t("inbox.backToConversations")}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-foreground hover:bg-accent hover:text-foreground lg:hidden"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          {/* Avatar + name double as a button that opens the contact
              panel (same toggle as the header icon), so clicking the
              person's name reveals their details — a familiar inbox
              gesture. Falls back to a plain block if no toggle is wired. */}
          <button
            type="button"
            onClick={onToggleContactPanel}
            disabled={!onToggleContactPanel}
            aria-label={t("inbox.viewContactInfo")}
            className="flex min-w-0 items-center gap-2 rounded-md text-left transition-colors enabled:hover:bg-accent disabled:cursor-default sm:gap-3 lg:px-1.5 lg:py-1"
          >
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
              {displayName.charAt(0).toUpperCase()}
            </div>
            {/* Solo el nombre — el teléfono vive en la barra de contacto
                (clic aquí la abre), no pegado al nombre. */}
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-foreground">{displayName}</h2>
            </div>
          </button>
          {/* Session timer badge — only meaningful for WhatsApp's 24h
              customer-care window. For email / IG / comments there's no such
              window, so "Expirada" was just noise; hide it there. Hidden on
              the narrowest phones so the name + back arrow keep their room. */}
          {conversation.channel === "whatsapp" && (
            <Badge
              variant="outline"
              className={cn(
                "ml-1 hidden gap-1 border-border text-[10px] sm:inline-flex sm:ml-2",
                sessionInfo.expired ? "text-red-600 dark:text-red-400" : "text-accent-ink"
              )}
            >
              <Clock className="h-3 w-3" />
              {sessionInfo.remaining}
            </Badge>
          )}
          {/* ML: al responder importa saber si es una pregunta pública (la
              respuesta se publica en la publicación) o un mensaje privado. */}
          <MlKindBadge
            channel={conversation.channel}
            threadExternalId={conversation.thread_external_id}
            variant="header"
            className="ml-1 hidden sm:inline-flex sm:ml-2"
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Contact-panel toggle — desktop only. The right-hand panel is
              collapsed by default; this reveals/hides it on demand. */}
          {onToggleContactPanel && (
            <button
              type="button"
              onClick={onToggleContactPanel}
              aria-label={
                contactPanelOpen
                  ? t("inbox.hideContactInfo")
                  : t("inbox.showContactInfo")
              }
              aria-pressed={contactPanelOpen}
              className={cn(
                "hidden h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent lg:inline-flex",
                contactPanelOpen
                  ? "bg-accent text-accent-ink"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <PanelRight className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Manual refresh — forces a refetch of the messages + the
              conversation list (the parent bumps its resyncToken). Useful
              when realtime missed an event or the agent just wants to be
              sure nothing's stale. Only rendered when the parent wires
              up `onRefresh`. */}
          {onRefresh && (
            <button
              type="button"
              onClick={handleRefreshClick}
              disabled={isRefreshing}
              aria-label={t("inbox.refresh")}
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60",
              )}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")}
              />
            </button>
          )}

          {/* Status dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger className={cn(
                  "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-accent",
                  currentStatus?.color ?? "text-muted-foreground"
                )}>
                {currentStatus ? t(currentStatus.labelKey) : t("inbox.status")}
                <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="border-border bg-card"
            >
              {STATUS_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => handleStatusChange(opt.value)}
                  className={cn("text-sm", opt.color)}
                >
                  {t(opt.labelKey)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Toggle de IA por chat — prende/apaga al asistente en esta
              conversación. Verde cuando responde, gris cuando está en
              pausa (un humano toma el control). Solo se muestra si hay un
              agente IA que cubra este canal — sin agente no hay nada que
              activar/pausar. */}
          {hasAgentForChannel && (
            <button
              type="button"
              onClick={toggleAi}
              disabled={aiToggling}
              title={
                aiEnabled
                  ? t("inbox.aiActiveTooltip")
                  : t("inbox.aiPausedTooltip")
              }
              aria-pressed={aiEnabled}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs transition-colors hover:bg-accent disabled:opacity-60",
                aiEnabled
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-muted-foreground",
              )}
            >
              <Bot className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                {aiEnabled ? t("inbox.aiActive") : t("inbox.aiPaused")}
              </span>
            </button>
          )}

          {/* Assign dropdown — only render when there's more than one
              workspace member (or someone already assigned that we'd
              need to unassign). A solo merchant sees an "Asignar" chip
              with only themselves in it, which is noise. */}
          {(profiles.length > 1 || assignedAgentId) && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-accent",
                  assignedAgentId ? "text-accent-ink" : "text-muted-foreground"
                )}
              >
                <UserPlus className="h-3 w-3" />
                <span className="hidden sm:inline">{assignLabel}</span>
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="border-border bg-card"
              >
                {profiles.length === 0 ? (
                  <DropdownMenuItem disabled className="text-sm text-muted-foreground">
                    {t("inbox.noTeammates")}
                  </DropdownMenuItem>
                ) : (
                  profiles.map((p) => {
                    const isSelected = p.user_id === assignedAgentId;
                    return (
                      <DropdownMenuItem
                        key={p.id}
                        onClick={() => handleAssignChange(p.user_id)}
                        className={cn(
                          "text-sm",
                          isSelected ? "text-accent-ink" : "text-foreground"
                        )}
                      >
                        <span className="flex-1">
                          {p.full_name}
                          {p.user_id === user?.id ? t("inbox.youSuffix") : ""}
                        </span>
                        {isSelected && <Check className="ml-2 h-3 w-3" />}
                      </DropdownMenuItem>
                    );
                  })
                )}
                {assignedAgentId && (
                  <>
                    <DropdownMenuSeparator className="bg-border" />
                    <DropdownMenuItem
                      onClick={() => handleAssignChange(null)}
                      className="text-sm text-muted-foreground"
                    >
                      {t("inbox.removeAssignment")}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* La IA escaló y dejó el hilo a una persona. Sin este aviso, quien lo
          abre no sabe por qué el asistente dejó de responder ni desde cuándo
          espera el cliente — antes el escalamiento era completamente mudo. */}
      {conversation.needs_human_reason && (
        <div className="flex items-center gap-2 border-b border-border bg-amber-500/10 px-3 py-2 sm:px-4">
          <UserRound className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="min-w-0 flex-1 text-xs text-amber-700 dark:text-amber-300">
            {t(NEEDS_HUMAN_REASON_KEY[conversation.needs_human_reason])}
          </p>
        </div>
      )}

      {/* Email subject banner — surfaces the thread title up top
          instead of letting it disappear into the conversation row in
          the list. Long subjects truncate; click to expand. */}
      {(conversation.channel === "gmail" ||
        conversation.channel === "outlook") &&
        conversation.subject && (
          <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-3 py-2 text-xs sm:px-4">
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {conversation.subject}
            </p>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {messages.length}
            </span>
          </div>
        )}

      {/* Post context banner — only for comment channels. Makes it
          immediately clear which post the conversation is about, since a
          comment thread without that context just looks like a wall of
          replies from people the agent has never met. Adds a "Ver
          publicación" link so the agent can jump to the post on FB/IG. */}
      {(conversation.channel === "fb_comment" ||
        conversation.channel === "ig_comment" ||
        conversation.channel === "tiktok_comment") && (() => {
        const postId = conversation.thread_external_id ?? "";
        const isTiktok = conversation.channel === "tiktok_comment";
        // TikTok llega por `share_url` del listado de videos (el hilo sólo
        // guarda "video:<id>|comment:<top>", del que no se puede armar la url
        // porque falta el @usuario); FB deriva la suya del id, IG no.
        const postUrl =
          postPreview?.permalink ??
          (conversation.channel === "fb_comment" && postId
            ? `https://facebook.com/${postId}`
            : null);
        // En TikTok el subject trae "Video · <caption>": se limpia el prefijo
        // para que el banner muestre solo el texto del video.
        const caption =
          postPreview?.caption ||
          (isTiktok
            ? (conversation.subject ?? "").replace(/^Video · /, "")
            : conversation.subject) ||
          t("inbox.commentOnPost");
        return (
          <div className="flex items-start gap-3 border-b border-border bg-muted/70 px-3 py-2 text-xs sm:px-4">
            {/* Thumbnail of the actual post/ad. */}
            {postPreview?.image ? (
              <a
                href={postUrl ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={postPreview.image}
                  alt={t("inbox.post")}
                  className="size-12 rounded-md object-cover ring-1 ring-border"
                />
              </a>
            ) : (
              <span
                className={cn(
                  "mt-0.5 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                  conversation.channel === "fb_comment"
                    ? "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-500/30"
                    : conversation.channel === "ig_comment"
                      ? "bg-pink-500/15 text-pink-700 dark:text-pink-300 ring-1 ring-pink-500/30"
                      : "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 ring-1 ring-cyan-500/30",
                )}
              >
                {conversation.channel === "fb_comment"
                  ? t("inbox.postFb")
                  : conversation.channel === "ig_comment"
                    ? t("inbox.postIg")
                    : t("inbox.postTiktok")}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="mt-0.5 line-clamp-2 text-foreground">{caption}</p>
              {commentCount !== null && commentCount > 0 && (
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {t("inbox.commentsCount", { n: commentCount })}
                </p>
              )}
              {postUrl && (
                <a
                  href={postUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 inline-block text-[10px] text-accent-ink/80 hover:text-accent-ink hover:underline"
                >
                  {t("inbox.viewPost")}
                </a>
              )}
            </div>
          </div>
        );
      })()}

      {/* Ad-referral banner — the customer arrived from a click-to-message ad.
          Replaces the old inline "replied to an ad" bubble (now suppressed):
          the context lives up here, like the comment post banner. Shown
          wherever we captured the referral (WhatsApp CTWA, Messenger/IG CTM). */}
      {conversation.ad_referral &&
        (conversation.ad_referral.headline ||
          conversation.ad_referral.body ||
          conversation.ad_referral.sourceUrl) &&
        (() => {
          const ad = conversation.ad_referral!;
          const caption = ad.headline || ad.body || "";
          return (
            <div className="flex items-start gap-3 border-b border-border bg-muted/70 px-3 py-2 text-xs sm:px-4">
              <span className="mt-0.5 inline-flex shrink-0 items-center rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-ink ring-1 ring-primary/30">
                {t("inbox.adBadge")}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-muted-foreground">{t("inbox.repliedToAd")}</p>
                {caption && (
                  <p className="mt-0.5 line-clamp-2 text-foreground">{caption}</p>
                )}
                {ad.body && ad.headline && (
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                    {ad.body}
                  </p>
                )}
                {ad.sourceUrl && (
                  <a
                    href={ad.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 inline-block text-[10px] text-accent-ink/80 hover:text-accent-ink hover:underline"
                  >
                    {t("inbox.viewAd")}
                  </a>
                )}
              </div>
            </div>
          );
        })()}

      {/* Messages Area */}
      <div ref={scrollRef} className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">{t("inbox.noMessages")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {hasMore && (
              <div className="flex justify-center pb-1">
                <button
                  type="button"
                  onClick={handleLoadOlder}
                  disabled={loadingOlder}
                  className="inline-flex items-center gap-1.5 rounded-full bg-card/80 px-3 py-1 text-[11px] font-medium text-muted-foreground ring-1 ring-border backdrop-blur transition-colors hover:bg-card hover:text-foreground disabled:opacity-60"
                >
                  {loadingOlder ? (
                    <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  ) : (
                    <ChevronUp className="h-3 w-3" />
                  )}
                  {loadingOlder ? t("inbox.loading") : t("inbox.loadOlder")}
                </button>
              </div>
            )}
            {messageGroups.map((group) => (
              <div key={group.date}>
                {/* Date separator */}
                <div className="mb-4 flex items-center justify-center">
                  <span className="rounded-full bg-muted px-3 py-1 text-[10px] font-medium text-muted-foreground">
                    {formatDateSeparator(group.date, tz, t, locale)}
                  </span>
                </div>
                {/* Messages */}
                <div className="space-y-2">
                  {group.messages.map((msg) => {
                    // Suppress Meta's synthetic "X replied to an ad" echo — that
                    // context now lives in the ad-referral banner above. It's a
                    // plain agent text row with no structured marker, so we match
                    // its content. (es/en phrasings Meta uses.)
                    if (
                      msg.sender_type === "agent" &&
                      /replied to (an|your) ad|respondió a (un|tu) anuncio/i.test(
                        msg.content_text ?? "",
                      )
                    ) {
                      return null;
                    }
                    const parent = msg.reply_to_message_id
                      ? messagesById.get(msg.reply_to_message_id)
                      : null;
                    const reply = parent
                      ? {
                          authorLabel: authorLabelFor(parent),
                          preview: buildReplyPreview(parent, t),
                        }
                      : null;
                    const msgReactions = reactionsByMessageId.get(msg.id);
                    // Name heading for the bubble: shown for todo lo automático
                    // —con el nombre de la funcionalidad que lo mandó— y para
                    // los mensajes de compañeros. Los propios no llevan "Tú".
                    const senderName =
                      originLabel(msg, t) ??
                      (msg.sender_type === "bot"
                        ? msg.content_type === "template"
                          ? t("inbox.automation")
                          : t("inbox.aiAssistant")
                        : msg.sender_type === "agent" &&
                            msg.sender_id &&
                            msg.sender_id !== user?.id
                          ? (nameByUserId.get(msg.sender_id) ?? t("inbox.agent"))
                          : undefined);
                    // Toggle is computed at the call site — `msgReactions`
                    // and `user?.id` are already in scope, no extra hook.
                    const handlePillToggle = (emoji: string) => {
                      const own = msgReactions?.find(
                        (r) =>
                          r.actor_type === "agent" &&
                          r.actor_id === user?.id,
                      );
                      const next = own?.emoji === emoji ? "" : emoji;
                      void postReaction(msg.id, next);
                    };
                    return (
                      <MessageActions
                        key={msg.id}
                        message={msg}
                        onReply={() => handleStartReply(msg)}
                        onReact={(emoji) => {
                          if (emoji) void postReaction(msg.id, emoji);
                        }}
                        onDelete={handleDeleteMessage}
                      >
                        <MessageBubble
                          message={msg}
                          reply={reply}
                          reactions={msgReactions}
                          currentUserId={user?.id}
                          senderName={senderName}
                          contactName={contact?.name}
                          contactPhone={
                            contact?.phone ??
                            // El external_id sólo ES un teléfono en WhatsApp;
                            // en IG/Messenger es un id numérico que podría
                            // colisionar al comparar por sufijo.
                            (conversation?.channel === "whatsapp"
                              ? contact?.external_id
                              : null)
                          }
                          onToggleReaction={handlePillToggle}
                        />
                      </MessageActions>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Voice conversations are a call log: show the call card + transcript,
          no composer (you can't type a reply to a phone call). */}
      {conversation.channel === "voice" ? (
        <VoiceCallCard conversationId={conversation.id} />
      ) : mlThreadKind(conversation.channel, conversation.thread_external_id) ===
        "review" ? (
        /* Una opinión no se contesta: Mercado Libre no expone ningún endpoint
           para hacerlo. Mostrar el compositor sería ofrecer algo que al pulsar
           "enviar" iba a fallar — mejor decirlo antes de que lo escriba. */
        <div className="border-t border-border px-4 py-3 text-center text-xs text-muted-foreground">
          {t("inbox.mlReviewNoReply")}
        </div>
      ) : (
        /* Composer — the 24h session-window check only applies to
           WhatsApp; for every other channel the agent can reply any
           time (comments, DMs, emails). Without this gate, fb_comment
           threads opened a day after a comment landed showed the
           composer in "expired" state and blocked the reply. */
        <>
          {/* Respuesta propuesta por un agente que necesita aprobación. */}
          <PendingReplyCard
            conversationId={conversation.id}
            onSend={(text) => handleSend(text)}
          />
          <MessageComposer
            conversationId={conversation.id}
            channel={conversation.channel}
            sessionExpired={
              conversation.channel === "whatsapp" && sessionInfo.expired
            }
            onSend={handleSend}
            onSendMedia={handleSendMedia}
            onOpenTemplates={handleOpenTemplates}
            replyTo={replyTo}
            onClearReply={() => setReplyTo(null)}
          />
        </>
      )}

      <TemplatePicker
        open={templateModalOpen}
        onOpenChange={setTemplateModalOpen}
        onSelect={handleSendTemplate}
      />
    </div>
  );
}
