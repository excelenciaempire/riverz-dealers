"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Channel, Conversation, Message, Contact, ConversationStatus } from "@/types";
import { useRealtime } from "@/hooks/use-realtime";
import { ConversationList } from "@/components/inbox/conversation-list";
import { MessageThread } from "@/components/inbox/message-thread";
import { ContactSidebar } from "@/components/inbox/contact-sidebar";
import { ChannelFilter } from "@/components/inbox/channel-filter";
import { MlSubFilter, type MlKindFilter } from "@/components/inbox/ml-subfilter";
import { mlThreadKind } from "@/lib/channels/display";
import {
  InboxTabs,
  type InboxTab,
  MESSAGE_CHANNELS,
  COMMENT_CHANNELS,
  channelBelongsToTab,
} from "@/components/inbox/inbox-tabs";
import { ResizablePane } from "@/components/inbox/resizable-pane";
import Link from "@/components/i18n/locale-link";
import { Plug2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT, useLocale } from "@/hooks/use-locale";
import { localizePath, canonicalizePath } from "@/lib/i18n/routes";

export default function InboxPage() {
  const t = useT();
  const { locale } = useLocale();
  const searchParams = useSearchParams();
  /**
   * `?c=<id>` deep-link support. Used when landing here from the
   * dashboard's recent-conversations list so the right thread opens
   * automatically instead of showing the empty center panel.
   */
  const deepLinkConvId = searchParams.get("c");

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] =
    useState<Conversation | null>(null);
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [channelFilter, setChannelFilter] = useState<Channel | null>(null);
  // Secondary filter within the MercadoLibre chip: all / questions / messages.
  const [mlKindFilter, setMlKindFilter] = useState<MlKindFilter>("all");
  const [inboxTab, setInboxTab] = useState<InboxTab>("messages");
  const [hasAnyConnection, setHasAnyConnection] = useState<boolean | null>(
    null,
  );
  /**
   * Bumped whenever we want children (ConversationList, MessageThread)
   * to refetch from the DB — used as a safety net against missed
   * realtime events. Bumped on WS reconnect and on tab visibility →
   * visible. The initial mount fetches don't depend on this; they fire
   * once on conversationId-change as usual.
   */
  const [resyncToken, setResyncToken] = useState(0);

  // Right-hand contact panel is collapsed by default; the thread header
  // has a button to reveal it. Keeps the conversation the focus and gives
  // the thread the full width until the agent explicitly wants the
  // contact's details / notes / Shopify context.
  const [contactPanelOpen, setContactPanelOpen] = useState(false);
  const toggleContactPanel = useCallback(
    () => setContactPanelOpen((v) => !v),
    [],
  );

  // Fire the deep-link auto-select exactly once per URL — subsequent
  // list refreshes (realtime, manual refetch) must not snap the user
  // back to the deep-linked conversation if they've already clicked
  // elsewhere.
  const autoSelectedForDeepLinkRef = useRef<string | null>(null);

  // Tracks conversations whose hydrate fetch is currently in flight. The
  // conv-INSERT and the first-message-INSERT events both call into
  // hydrateConversation; the dedupe here keeps it at one refetch per
  // new conversation even when both events arrive within milliseconds.
  const hydratingConvIdsRef = useRef<Set<string>>(new Set());

  /**
   * Synchronous mirror of the conversation ids currently in `conversations`
   * state. Event handlers need to know "do we already have this conv?"
   * without waiting for a setState updater to run — updaters fire during
   * reconciliation, *after* the synchronous handler code returns, so a
   * `let foundInList = false; setState(p => { foundInList = ...; return ... })`
   * flag reads as `false` in the same tick (this exact bug shipped in #105
   * and caused #106: every incoming message and every status flip fired a
   * redundant DB hydrate, swamping the supabase client and starving the
   * realtime channel). The ref is kept in sync via the effect below.
   */
  const knownConvIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const next = new Set<string>();
    for (const c of conversations) next.add(c.id);
    knownConvIdsRef.current = next;
  }, [conversations]);

  // Pull the conversation row with its `contact` joined and merge it
  // into state. Needed because Supabase Realtime payloads only carry the
  // row's own columns — a brand-new conversation arrives without a
  // contact, which surfaced as "Unknown" names, empty avatars, and
  // (when the conv-INSERT event was delayed past the message-INSERT)
  // conversations stuck on "No messages yet" until the user reloaded.
  // Also self-heals if a realtime event was missed: callers can invoke
  // this whenever they reference a conversation id they don't recognise.
  const hydrateConversation = useCallback(async (convId: string) => {
    if (hydratingConvIdsRef.current.has(convId)) return;
    hydratingConvIdsRef.current.add(convId);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("conversations")
        .select("*, contact:contacts(*)")
        .eq("id", convId)
        .maybeSingle();
      if (error) {
        // Supabase errors have non-enumerable properties — log fields
        // explicitly so the console message isn't just `{}`.
        console.error("Failed to hydrate conversation:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        return;
      }
      if (!data) return;
      const fetched = data as Conversation;
      // No re-insertar una conversación borrada de la bandeja (soft-delete):
      // si una carrera de eventos intentara hidratarla, la ignoramos.
      if (fetched.deleted_at) return;
      setConversations((prev) => {
        const existing = prev.find((c) => c.id === fetched.id);
        if (existing) {
          // Already in state — keep its fields (a realtime UPDATE may
          // have landed while the fetch was in flight and patched
          // last_message_text / unread_count to fresher values than
          // the row we just read). Only backfill `contact`, which the
          // realtime payloads never carry.
          return prev.map((c) =>
            c.id === fetched.id
              ? { ...c, contact: c.contact ?? fetched.contact }
              : c,
          );
        }
        return [fetched, ...prev];
      });
    } finally {
      hydratingConvIdsRef.current.delete(convId);
    }
  }, []);

  // Check WhatsApp connection status on mount
  useEffect(() => {
    const checkConnection = async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;

      if (!user) return;

      // Email channels (gmail/outlook) are personal — only show the
      // chip if THIS user connected that mailbox. Business channels
      // (WhatsApp, IG, Messenger, comments) are shared, so the chip
      // shows for every workspace member.
      const { data: rows } = await supabase
        .from("channel_connections")
        .select("channel, created_by")
        .eq("status", "connected");

      const channels = new Set<Channel>();
      for (const r of rows ?? []) {
        const isEmail = r.channel === "gmail" || r.channel === "outlook";
        if (!isEmail || r.created_by === user.id) {
          channels.add(r.channel as Channel);
        }
      }
      setHasAnyConnection(channels.size > 0);
    };

    checkConnection();
  }, []);

  // Handle realtime message events
  const handleMessageEvent = useCallback(
    (event: { eventType: string; new: Message; old: Partial<Message> }) => {
      const newMsg = event.new;

      if (event.eventType === "INSERT") {
        // Add to messages if it belongs to active conversation
        if (
          activeConversation &&
          newMsg.conversation_id === activeConversation.id
        ) {
          setMessages((prev) => {
            // Avoid duplicates
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            // Replace optimistic message if it exists
            const withoutOptimistic = prev.filter(
              (m) => !m.id.startsWith("temp-")
            );
            return [...withoutOptimistic, newMsg];
          });
        }

        // Update conversation list preview. We need to know *synchronously*
        // whether the conv is already in state to decide between patching
        // the preview and triggering a hydrate — see the comment on
        // knownConvIdsRef for why a closure flag inside the updater would
        // always read false here.
        if (knownConvIdsRef.current.has(newMsg.conversation_id)) {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === newMsg.conversation_id
                ? {
                    ...c,
                    last_message_text: newMsg.content_text ?? "",
                    last_message_at: newMsg.created_at,
                    unread_count:
                      activeConversation?.id === newMsg.conversation_id
                        ? 0
                        : c.unread_count + 1,
                  }
                : c,
            ),
          );
        } else {
          // First time we're seeing this conv: the conv-INSERT event
          // hasn't landed yet, or was missed. Hydrate from the DB so
          // the row surfaces with its `contact` joined; the conv-UPDATE
          // event the webhook emits right after the message INSERT will
          // converge state when it arrives.
          hydrateConversation(newMsg.conversation_id);
        }
      }

      if (event.eventType === "UPDATE") {
        // Update message status
        setMessages((prev) =>
          prev.map((m) => (m.id === newMsg.id ? { ...m, ...newMsg } : m))
        );
      }
    },
    [activeConversation, hydrateConversation]
  );

  // Handle realtime conversation events
  const handleConversationEvent = useCallback(
    (event: {
      eventType: string;
      new: Conversation;
      old: Partial<Conversation>;
    }) => {
      const conv = event.new;

      if (event.eventType === "INSERT") {
        // Prepend immediately for snappy UX so the new conv shows in the
        // list right away, then hydrate to fill in the `contact` join
        // (realtime payloads never include joins). Skip both if we
        // already have the row — that shouldn't happen normally, but
        // out-of-order delivery would have us prepending a duplicate.
        if (!knownConvIdsRef.current.has(conv.id)) {
          setConversations((prev) => {
            if (prev.some((c) => c.id === conv.id)) return prev;
            return [conv, ...prev];
          });
          hydrateConversation(conv.id);
        }
      }

      if (event.eventType === "UPDATE") {
        // Soft-delete (migración 085): "borrar de la bandeja" es un UPDATE que
        // setea deleted_at. Lo tratamos como un borrado — sacarla de la lista y
        // cerrar el hilo si estaba abierto — en vez de parchear la fila (que la
        // dejaría visible). Cubre el borrado hecho desde otra pestaña/usuario.
        if (conv.deleted_at) {
          setConversations((prev) => prev.filter((c) => c.id !== conv.id));
          if (activeConversation?.id === conv.id) {
            setActiveConversation(null);
            setActiveContact(null);
            setMessages([]);
          }
          return;
        }
        if (knownConvIdsRef.current.has(conv.id)) {
          // If this UPDATE is for the conv the user is currently viewing,
          // suppress the incoming unread_count — the user is reading it
          // RIGHT NOW, so any positive value would just flicker the badge
          // back on for the ~100ms it takes for the reset effect's server
          // UPDATE to round-trip. Non-active convs take the value as-is.
          const isActive = activeConversation?.id === conv.id;
          setConversations((prev) =>
            prev.map((c) =>
              c.id === conv.id
                ? {
                    ...c,
                    ...conv,
                    unread_count: isActive ? 0 : conv.unread_count,
                  }
                : c,
            ),
          );
        } else {
          // UPDATE arrived before the INSERT (or after a missed INSERT)
          // — fetch the row so it surfaces with its contact joined. The
          // patch contained in `conv` will already be reflected in what
          // the hydrate fetch returns.
          hydrateConversation(conv.id);
        }

        // Update active conversation if it changed
        if (activeConversation && conv.id === activeConversation.id) {
          setActiveConversation((prev) =>
            prev ? { ...prev, ...conv } : prev
          );
        }
      }
    },
    [activeConversation, hydrateConversation]
  );

  // Subscribe to realtime. The `isConnected` flag below feeds the
  // reconnect resync: realtime is best-effort and events sent while the
  // WS was disconnected (laptop sleep, network blip, background-tab
  // throttle) are simply lost. We need a way to catch up.
  const { isConnected } = useRealtime({
    channelName: "inbox-realtime",
    onMessageEvent: handleMessageEvent,
    onConversationEvent: handleConversationEvent,
    enabled: true,
  });

  /**
   * Bump `resyncToken` whenever the realtime channel transitions from
   * disconnected → connected *after* the initial connect. The initial
   * connect is covered by the children's on-mount fetches; only later
   * reconnects need a manual refetch to fill the gap.
   *
   * Tracked via a `was-connected` ref rather than a count so that React
   * strict-mode's dev-only effect double-fire doesn't read as a
   * reconnect.
   */
  const wasConnectedRef = useRef(false);
  const initialConnectDoneRef = useRef(false);
  useEffect(() => {
    if (isConnected && !wasConnectedRef.current) {
      // false → true transition
      if (initialConnectDoneRef.current) {
        setResyncToken((n) => n + 1);
      } else {
        initialConnectDoneRef.current = true;
      }
    }
    wasConnectedRef.current = isConnected;
  }, [isConnected]);

  /**
   * Refetch when the tab regains focus. Background tabs may have their
   * WS throttled by the browser even without a full disconnect, so a
   * visibilitychange → visible is a reliable signal that we may have
   * missed events. Cheap to fire; the children dedupe on their own.
   */
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        setResyncToken((n) => n + 1);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  /**
   * Manual refresh trigger for the thread-header refresh button.
   * Bumps the same resyncToken the reconnect / visibility paths use,
   * so it goes through the existing dedupe & refetch plumbing — no
   * separate code path to keep in sync.
   */
  const handleManualRefresh = useCallback(() => {
    setResyncToken((n) => n + 1);
  }, []);

  const handleConversationsLoaded = useCallback(
    (loaded: Conversation[]) => {
      setConversations(loaded);
      // Resolve a pending deep-link here rather than in an effect — this
      // is an event handler, so the setState calls below are allowed by
      // react-hooks/set-state-in-effect. Runs once per ?c=<id> URL value
      // via the ref, so realtime refreshes of the list can't snap the
      // user back to the deep-linked thread after they've navigated.
      if (
        deepLinkConvId &&
        autoSelectedForDeepLinkRef.current !== deepLinkConvId &&
        loaded.length > 0
      ) {
        autoSelectedForDeepLinkRef.current = deepLinkConvId;
        // If the deep-linked conversation is already the active one
        // (e.g. a refresh landed on /bandeja?c=<id> for a conv that's
        // already selected), do NOT re-apply it. Doing so
        // would setMessages([]) on a thread whose messages have
        // already been loaded by MessageThread — and because
        // conversationId didn't change, MessageThread wouldn't
        // refetch. The thread would read "No messages yet" until a
        // full page reload rehydrated state from scratch.
        if (activeConversation?.id === deepLinkConvId) return;
        const match = loaded.find((c) => c.id === deepLinkConvId);
        if (match) {
          setActiveConversation(match);
          setActiveContact(match.contact ?? null);
          setMessages([]);
          // Mirror the optimistic unread reset that handleSelectConversation
          // does — the user just deep-linked into this conv, treat that the
          // same as a click. Leaves activeConversation.unread_count alone so
          // the MessageThread reset effect still fires the server UPDATE.
          if (match.unread_count > 0) {
            setConversations((prev) =>
              prev.map((c) =>
                c.id === match.id ? { ...c, unread_count: 0 } : c,
              ),
            );
          }
        }
      }
    },
    [deepLinkConvId, activeConversation?.id]
  );

  const handleSelectConversation = useCallback(
    (conv: Conversation) => {
      // Re-clicking the already-active conversation would clear the
      // messages array, but the fetch effect in MessageThread only re-runs
      // when conversationId changes — so messages would stay empty until
      // the user navigated away and back. Bail out early instead.
      if (activeConversation?.id === conv.id) return;
      setActiveConversation(conv);
      setActiveContact(conv.contact ?? null);
      setMessages([]);
      // Optimistically clear the unread badge for this conv. The
      // server-side reset is fired by the unread-reset effect inside
      // MessageThread (which reads activeConversation.unread_count, not
      // the list copy — so we deliberately leave that intact below to
      // keep the effect firing), and the realtime UPDATE that comes
      // back will sync to 0 again as a no-op. Zeroing the list copy
      // here means the user sees the badge disappear the instant they
      // click instead of waiting for the round-trip — and it persists
      // even if the realtime UPDATE is dropped.
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conv.id && c.unread_count > 0
            ? { ...c, unread_count: 0 }
            : c,
        ),
      );
      autoSelectedForDeepLinkRef.current = conv.id;
      // Reflect the selection in the URL (so refresh / copy-paste lands back
      // here) WITHOUT a router navigation. router.replace() re-runs the route
      // and made the conversation list refetch on every click — that's the
      // "whole page reloads" the user saw. history.replaceState updates the
      // address bar only: no re-render, no refetch. Selection is React state.
      window.history.replaceState(
        null,
        "",
        localizePath(canonicalizePath(`/bandeja?c=${conv.id}`), locale),
      );
    },
    [activeConversation?.id, locale]
  );

  // Drop a conversation from local state after the user deletes it via
  // the row's kebab menu. The DELETE request itself happens inside
  // ConversationList; here we just keep the in-memory list in sync.
  const handleConversationDeleted = useCallback(
    (id: string) => {
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConversation?.id === id) {
        setActiveConversation(null);
        setActiveContact(null);
        setMessages([]);
        autoSelectedForDeepLinkRef.current = null;
        window.history.replaceState(
          null,
          "",
          localizePath(canonicalizePath("/bandeja"), locale),
        );
      }
    },
    [activeConversation?.id, locale],
  );

  // After a bulk delete, refetch authoritative state from the DB. The list
  // already removed the rows it knew about optimistically; this bump makes the
  // counts (tab + channel badges) accurate again and drops any rows that were
  // wiped by a server-side scope delete but hadn't been loaded client-side —
  // which is what stopped deleted conversations from "reappearing" on reload.
  const handleBulkDeleted = useCallback(() => {
    setResyncToken((n) => n + 1);
  }, []);

  // Mobile "back" — deselect the conversation so the list pane comes
  // back. Also clears the ?c= param so a refresh lands on the list
  // instead of re-opening the thread the user just backed out of.
  const handleCloseConversation = useCallback(() => {
    setActiveConversation(null);
    setActiveContact(null);
    setMessages([]);
    // Clearing the ref lets the deep-link auto-selector fire again if
    // the user later visits /bandeja?c=<same-id> — desirable UX.
    autoSelectedForDeepLinkRef.current = null;
    window.history.replaceState(
      null,
      "",
      localizePath(canonicalizePath("/bandeja"), locale),
    );
  }, [locale]);


  const handleMessagesLoaded = useCallback((loaded: Message[]) => {
    setMessages(loaded);
  }, []);

  const handleNewMessage = useCallback((msg: Message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  const handleUpdateMessage = useCallback(
    (id: string, updates: Partial<Message>) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, ...updates } : m))
      );
    },
    []
  );

  const handleDeleteMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const handleStatusChange = useCallback(
    (conversationId: string, status: ConversationStatus) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, status } : c))
      );
      if (activeConversation?.id === conversationId) {
        setActiveConversation((prev) => (prev ? { ...prev, status } : prev));
      }
    },
    [activeConversation]
  );

  const handleAssignChange = useCallback(
    (conversationId: string, assignedAgentId: string | null) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, assigned_agent_id: assignedAgentId ?? undefined }
            : c
        )
      );
      if (activeConversation?.id === conversationId) {
        setActiveConversation((prev) =>
          prev
            ? { ...prev, assigned_agent_id: assignedAgentId ?? undefined }
            : prev
        );
      }
    },
    [activeConversation]
  );

  // On mobile (<lg) we show a SINGLE pane — either the list or the
  // thread — rather than cramming both side-by-side. Selecting a
  // conversation slides the thread in; the thread's back button pops
  // it back to the list. On lg+ both panes render side-by-side as
  // before, unchanged.
  const hasActiveConv = !!activeConversation;

  // Channel filter derived state — recomputed cheaply on every render
  // since the conversations array is already in memory. We also count
  // unread per top-level tab so the tabs can show their own badge.
  const unreadByChannel: Partial<Record<Channel | "all", number>> = { all: 0 };
  const tabCounts = { messages: 0, comments: 0 };
  for (const c of conversations) {
    // Guard against stale/negative unread_count drifting the badges.
    const unread = Math.max(0, c.unread_count ?? 0);
    unreadByChannel[c.channel] = (unreadByChannel[c.channel] ?? 0) + unread;
    if (COMMENT_CHANNELS.includes(c.channel)) tabCounts.comments += unread;
    else if (MESSAGE_CHANNELS.includes(c.channel)) tabCounts.messages += unread;
  }
  // The "All" chip lives inside the active tab's filter row, so its count must
  // be the CURRENT tab's total — not the global sum across both tabs (that made
  // the Messages tab show comment unread too, and vice versa).
  unreadByChannel.all =
    inboxTab === "comments" ? tabCounts.comments : tabCounts.messages;
  // Channels that belong to the current tab — drives which chips are
  // shown in the secondary filter row below the tabs. We render a chip
  // for EVERY channel of the active tab, connected or not and even with
  // zero messages/comments, so the filter row stays complete and
  // consistent instead of icons appearing/disappearing as traffic lands.
  const tabChannels: Channel[] =
    inboxTab === "comments" ? COMMENT_CHANNELS : MESSAGE_CHANNELS;
  const visibleAvailableChannels = new Set<Channel>(tabChannels);
  // Memoize the filtered list so a single realtime UPDATE doesn't
  // rebuild the array (and force every ConversationItem to re-render)
  // on every render tick. Stable identity also lets React.memo on
  // ConversationItem actually do its job.
  const filteredConversations = useMemo(() => {
    let list = conversations;
    // Tab-level filter
    if (inboxTab === "comments") {
      list = list.filter((c) => COMMENT_CHANNELS.includes(c.channel));
    } else {
      list = list.filter((c) => MESSAGE_CHANNELS.includes(c.channel));
    }
    // Secondary filter (channel chips)
    if (channelFilter) {
      list = list.filter((c) => c.channel === channelFilter);
    }
    // Tertiary filter — only under MercadoLibre: pregunta vs mensaje.
    if (channelFilter === "mercadolibre" && mlKindFilter !== "all") {
      list = list.filter(
        (c) => mlThreadKind(c.channel, c.thread_external_id) === mlKindFilter,
      );
    }
    return list;
  }, [conversations, inboxTab, channelFilter, mlKindFilter]);

  // Counts for the ML sub-filter chips (question vs message), across all
  // loaded ML conversations regardless of the active sub-filter so the
  // chip totals stay stable while the user toggles between them.
  const mlCounts = useMemo(() => {
    let question = 0;
    let message = 0;
    for (const c of conversations) {
      const kind = mlThreadKind(c.channel, c.thread_external_id);
      if (kind === "question") question++;
      else if (kind === "message") message++;
    }
    return { question, message };
  }, [conversations]);

  // Switching the channel chip resets the ML sub-filter so a stale
  // "solo preguntas" doesn't hide everything under another channel.
  const handleChannelChange = useCallback((next: Channel | null) => {
    setChannelFilter(next);
    setMlKindFilter("all");
  }, []);

  // Switching tab clears any channel filter that no longer applies, so
  // the user doesn't get an empty list because a stale chip is still
  // restricting results. También cierra la conversación abierta: al pasar de
  // Mensajes a Comentarios (o al revés) el hilo activo ya no pertenece a la
  // pestaña que se está mirando, así que quedaría abierto sin estar en la lista.
  const handleTabChange = useCallback(
    (next: InboxTab) => {
      if (next === inboxTab) return;
      setInboxTab(next);
      setMlKindFilter("all");
      if (channelFilter && !channelBelongsToTab(channelFilter, next)) {
        setChannelFilter(null);
      }
      if (activeConversation) handleCloseConversation();
    },
    [inboxTab, channelFilter, activeConversation, handleCloseConversation],
  );

  return (
    <div className="-m-4 flex h-[calc(100dvh-3.5rem)] flex-col overflow-hidden sm:-m-6 lg:-m-8 lg:h-dvh">
      {hasAnyConnection === false && (
        <Link
          href="/integraciones"
          className="group flex shrink-0 items-center justify-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 transition-colors hover:bg-amber-500/15"
        >
          <Plug2 className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-800 dark:text-amber-200">
            <span className="font-semibold underline-offset-2 group-hover:underline">
              {t("inbox.connectChannelArrow")}
            </span>
          </p>
        </Link>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: Conversation list.
            Hidden on mobile when a conversation is selected so the
            thread can occupy the full width. Always visible on lg+. */}
        <ResizablePane
          storageKey="ui.inbox.list-width"
          defaultWidth={320}
          minWidth={260}
          maxWidth={560}
          className={cn(
            "h-full border-r border-border bg-card",
            // Below lg the pane is full-width via the wrapping flex, so
            // hide it entirely when a conv is open (matches existing UX).
            // `max-lg:!w-full` forces full width on mobile (overriding the
            // pane's inline px width); on lg+ the inline resizable width
            // applies so the thread + contact sidebar get their space.
            hasActiveConv ? "hidden lg:block" : "block max-lg:!w-full",
          )}
        >
          <div className="flex h-full flex-col">
            <InboxTabs
              value={inboxTab}
              onChange={handleTabChange}
              counts={tabCounts}
            />
            <ChannelFilter
              value={channelFilter}
              onChange={handleChannelChange}
              available={visibleAvailableChannels}
              unread={unreadByChannel}
            />
            {channelFilter === "mercadolibre" && (
              <MlSubFilter
                value={mlKindFilter}
                onChange={setMlKindFilter}
                counts={mlCounts}
              />
            )}
            <div className="flex-1 overflow-hidden">
              <ConversationList
                activeConversationId={activeConversation?.id ?? null}
                onSelect={handleSelectConversation}
                conversations={filteredConversations}
                onConversationsLoaded={handleConversationsLoaded}
                onConversationDeleted={handleConversationDeleted}
                onBulkDeleted={handleBulkDeleted}
                inboxTab={inboxTab}
                channelFilter={channelFilter}
                hasAnyConnection={hasAnyConnection !== false}
                resyncToken={resyncToken}
              />
            </div>
          </div>
        </ResizablePane>

        {/* Center panel: Message thread.
            Hidden on mobile when no conversation is selected so the
            list can occupy the full width. Always visible on lg+
            (shows its own empty-state if no thread is picked yet). */}
        <div
          className={cn(
            "flex h-full flex-1 lg:flex",
            hasActiveConv ? "flex" : "hidden lg:flex",
          )}
        >
          <MessageThread
            conversation={activeConversation}
            contact={activeContact}
            messages={messages}
            onMessagesLoaded={handleMessagesLoaded}
            onNewMessage={handleNewMessage}
            onUpdateMessage={handleUpdateMessage}
            onDeleteMessage={handleDeleteMessage}
            onStatusChange={handleStatusChange}
            onAssignChange={handleAssignChange}
            onBack={handleCloseConversation}
            resyncToken={resyncToken}
            onRefresh={handleManualRefresh}
            contactPanelOpen={contactPanelOpen}
            onToggleContactPanel={toggleContactPanel}
          />
        </div>

        {/* Right panel: Contact sidebar. Collapsed by default, revealed via
            the thread header's toggle.
            - Desktop (lg+): an inline column beside the thread.
            - Mobile (<lg): a right-side drawer over a backdrop, since the
              3-pane layout has no room for a third column on a phone. This
              also makes the thread header's contact toggle actually do
              something on mobile (previously it flipped state but nothing
              rendered). */}
        {contactPanelOpen && (
          <>
            <div className="hidden shrink-0 lg:block">
              <ContactSidebar
                contact={activeContact}
                onClose={() => setContactPanelOpen(false)}
              />
            </div>
            <div className="fixed inset-0 z-50 flex lg:hidden">
              <button
                type="button"
                aria-label={t("inbox.closeContactPanel")}
                onClick={() => setContactPanelOpen(false)}
                className="flex-1 bg-black/60 backdrop-blur-sm"
              />
              <div className="h-full shrink-0 shadow-xl">
                <ContactSidebar
                  contact={activeContact}
                  onClose={() => setContactPanelOpen(false)}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
