"use client";

import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/hooks/use-workspace";
import type { Channel, Conversation, Message, Contact, ConversationStatus } from "@/types";
import { useRealtime } from "@/hooks/use-realtime";
import { ConversationList } from "@/components/inbox/conversation-list";
import { MlClaimsPanel } from "@/components/inbox/ml-claims-panel";
import { MessageThread } from "@/components/inbox/message-thread";
import { ContactSidebar } from "@/components/inbox/contact-sidebar";
import { TeamNotifications } from '@/components/inbox/team-notifications';
import { SavedViews } from '@/components/inbox/saved-views';
import { TeamCapacity } from '@/components/inbox/team-capacity';
import { conversationIsSnoozed } from '@/lib/inbox/case-actions';
import { inboxShortcut } from '@/lib/inbox/shortcuts';
import { conversationMatchesView, type SavedViewConfig } from '@/lib/inbox/saved-views';
import { ChannelFilter } from "@/components/inbox/channel-filter";
import {
  InboxSearchBox,
  type InboxSearchState,
} from "@/components/inbox/search-box";
import { MlSubFilter, type MlKindFilter } from "@/components/inbox/ml-subfilter";
import { mlThreadKind } from "@/lib/channels/display";
import {
  InboxTabs,
  type InboxTab,
  MESSAGE_CHANNELS,
  COMMENT_CHANNELS,
  channelBelongsToTab,
  visibleChannelsForTab,
} from "@/components/inbox/inbox-tabs";
import { ResizablePane } from "@/components/inbox/resizable-pane";
import { Switch } from "@/components/ui/switch";
import Link from "@/components/i18n/locale-link";
import { Plug2, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT, useLocale } from "@/hooks/use-locale";
import { localizePath, canonicalizePath } from "@/lib/i18n/routes";
import { actionableUnreadCount } from "@/lib/inbox/actionable-unread";
import { latestPreviewMessage, mergeLiveConversation, previewFromMessage } from "@/lib/inbox/live-preview";

// Preferencia local de la pestaña/modo de bandeja (Mensajes / Comentarios /
// Unificar). Persiste entre recargas por navegador — es UI, no dato de cuenta.
const INBOX_TAB_KEY = "riverz_inbox_tab";

export default function InboxPage() {
  const t = useT();
  const { workspace } = useWorkspace();
  const { locale } = useLocale();
  const searchParams = useSearchParams();
  /**
   * `?c=<id>` deep-link support. Used when landing here from the
   * dashboard's recent-conversations list so the right thread opens
   * automatically instead of showing the empty center panel.
   */
  const deepLinkConvId = searchParams.get("c");
  /**
   * `?t=<fecha ISO>` — el ancla. Acompaña al `?c=` cuando quien manda el
   * enlace sabe de qué momento habla: cada fila del detalle de atribución
   * dice "a esta persona le llegó tal mensaje tal día", y el clic tiene que
   * caer ahí y no al final de una charla que siguió otras dos semanas.
   */
  const deepLinkMomento = searchParams.get("t");

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [inboxNow, setInboxNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setInboxNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const [savedView, setSavedView] = useState<{ config: SavedViewConfig; userId: string } | null>(null);
  const applySavedView = useCallback((config: SavedViewConfig | null, userId: string) => {
    setSavedView(config ? { config, userId } : null);
    if (config) { setInboxTab('all'); setChannelFilter(null); setMlKindFilter('all'); setNeedsHumanOnly(false); }
  }, []);
  // Búsqueda: filtra ESTA lista en vez de abrir un panel encima. Mientras hay
  // búsqueda, manda ella: los chips de pestaña y canal no la recortan, porque
  // buscar es global y "no aparece" con el resultado tapado por un filtro es
  // el peor final posible.
  const [search, setSearch] = useState<InboxSearchState>({
    active: false,
    loading: false,
    ids: [],
  });
  const [activeConversation, setActiveConversation] =
    useState<Conversation | null>(null);
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [channelFilter, setChannelFilter] = useState<Channel | null>(null);
  // Filtro "Necesita humano": hilos donde la IA escaló (palabra clave, cupo
  // agotado o traspaso de un flujo) y que esperan a una persona.
  const [needsHumanOnly, setNeedsHumanOnly] = useState(false);
  // Secondary filter within the MercadoLibre chip: all / questions / messages.
  const [mlKindFilter, setMlKindFilter] = useState<MlKindFilter>("all");
  const [inboxTab, setInboxTab] = useState<InboxTab>("messages");
  // Restaurar la pestaña/modo guardado en un effect (no en el initializer) para
  // no romper la hidratación SSR — el server no tiene localStorage. Corre una
  // vez al montar; el brevísimo tick en "Mensajes" antes de saltar al valor
  // guardado es imperceptible.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(INBOX_TAB_KEY);
      if (saved === "messages" || saved === "comments" || saved === "all") {
        setInboxTab(saved);
      }
    } catch {
      /* localStorage bloqueado — se queda en el default */
    }
  }, []);
  const [hasAnyConnection, setHasAnyConnection] = useState<boolean | null>(
    null,
  );
  const [connectedChannels, setConnectedChannels] = useState<Set<Channel>>(
    () => new Set(),
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
  /** El id que ya se pidió por separado por venir en un `?c=` y no estar en
   *  la página de conversaciones cargada. Una sola vez por id. */
  const hidratadaPorEnlaceRef = useRef<string | null>(null);

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

  /**
   * Abre una conversación que NO está en la página cargada de la lista.
   *
   * La lista trae las más recientes; un enlace del detalle de atribución
   * apunta a la charla de una compra que puede ser de hace semanas. Antes
   * ese enlace no hacía nada y no había forma de saber por qué.
   */
  const abrirConversacionPorId = useCallback(async (convId: string) => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("conversations")
      .select("*, contact:contacts(*)")
      .eq("id", convId)
      .maybeSingle();
    if (error || !data) {
      console.error("No se pudo abrir la conversación del enlace:", convId, error);
      return;
    }
    const conv = data as Conversation;
    if (conv.deleted_at) return;
    setConversations((prev) =>
      prev.some((c) => c.id === conv.id) ? prev : [conv, ...prev],
    );
    setActiveConversation(conv);
    setActiveContact(conv.contact ?? null);
    setMessages([]);
  }, []);

  // Load the channels available to this user in the active workspace.
  useEffect(() => {
    const checkConnection = async () => {
      if (!workspace?.id) return;
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
        .eq("workspace_id", workspace.id)
        .eq("status", "connected");

      const channels = new Set<Channel>();
      for (const r of rows ?? []) {
        const isEmail = r.channel === "gmail" || r.channel === "outlook" || r.channel === "zoho";
        if (!isEmail || r.created_by === user.id) {
          channels.add(r.channel as Channel);
        }
      }
      setConnectedChannels(channels);
      setHasAnyConnection(channels.size > 0);
    };

    checkConnection();
  }, [workspace?.id]);

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
          setActiveConversation(current => current ? previewFromMessage(current, newMsg) : current);
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
                    ...previewFromMessage(c, newMsg),
                    // Un mensaje que es sólo un archivo llega sin texto: el
                    // preview muestra el marcador del tipo ("[Audio]") en vez
                    // de quedar en "Sin mensajes" hasta el UPDATE de la
                    // conversación.
                    unread_count:
                      activeConversation?.id === newMsg.conversation_id
                        ? 0
                        : c.unread_count + (newMsg.sender_type === "customer" ? 1 : 0),
                  }
                : c,
            ),
          );
        } else {
          // El INSERT de conversación llega por su propio canal filtrado por
          // workspace. No hidratamos ids desconocidos desde `messages`: esos
          // eventos también existen para otros workspaces y antes provocaban
          // un ciclo de reconsultas/parpadeo durante un backfill ajeno.
        }
      }

      if (event.eventType === "UPDATE") {
        // Un borrado desde la bandeja es un UPDATE que fija `deleted_at`
        // (migración 264): la burbuja se va de esta pestaña y de las demás.
        if (newMsg.deleted_at) {
          setMessages((prev) => prev.filter((m) => m.id !== newMsg.id));
          setConversations(current => current.map(c =>
            c.id === newMsg.conversation_id && Date.parse(c.last_message_at ?? '') === Date.parse(newMsg.created_at)
              ? { ...c, last_message_at: undefined } : c));
          setResyncToken(n => n + 1);
          return;
        }
        // Update message status
        setMessages((prev) =>
          prev.map((m) => (m.id === newMsg.id ? { ...m, ...newMsg } : m))
        );
        setConversations(current => current.map(c => previewFromMessage(c, newMsg)));
      }
    },
    [activeConversation]
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
                    ...mergeLiveConversation(c, conv),
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
            prev ? mergeLiveConversation(prev, conv) : prev
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
    workspaceId: workspace?.id,
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
      setConversations(current => loaded.map(row => {
        const previous = current.find(c => c.id === row.id);
        return previous ? mergeLiveConversation(previous, row) : row;
      }));
      // La lista vuelve con el contacto unido. Si cambió su nombre o avatar,
      // refrescamos también el encabezado y la ficha abierta sin vaciar el
      // hilo ni obligar a seleccionar otra conversación.
      if (activeConversation) {
        const refreshed = loaded.find((c) => c.id === activeConversation.id);
        if (refreshed?.contact) {
          setActiveConversation((current) =>
            current?.id === refreshed.id
              ? { ...current, contact: refreshed.contact }
              : current,
          );
          setActiveContact(refreshed.contact);
        }
      }
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
        // La lista trae una página de conversaciones, no todas. Un enlace a
        // una charla vieja —que es justo lo que manda el detalle de
        // atribución— no la encontraba acá y no abría nada, en silencio: la
        // bandeja quedaba en la lista y parecía que el enlace estaba roto.
        // Se la pide por id y, cuando entra en la lista, este mismo camino
        // vuelve a correr y ya la encuentra. Una sola vez por id, para que
        // una conversación borrada no lo deje reintentando para siempre.
        if (
          !loaded.some((c) => c.id === deepLinkConvId) &&
          activeConversation?.id !== deepLinkConvId
        ) {
          if (hidratadaPorEnlaceRef.current !== deepLinkConvId) {
            hidratadaPorEnlaceRef.current = deepLinkConvId;
            autoSelectedForDeepLinkRef.current = deepLinkConvId;
            void abrirConversacionPorId(deepLinkConvId);
          }
          return;
        }
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
    [deepLinkConvId, activeConversation, abrirConversacionPorId]
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
    const latest = latestPreviewMessage(loaded);
    if (latest) {
      setConversations(current => current.map(c => previewFromMessage(c, latest)));
      setActiveConversation(current => current ? previewFromMessage(current, latest) : current);
    }
  }, []);

  const handleNewMessage = useCallback((msg: Message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
    setConversations(current => current.map(c => previewFromMessage(c, msg)));
    setActiveConversation(current => current ? previewFromMessage(current, msg) : current);
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
    const deleted = messages.find(m => m.id === id);
    if (deleted) setConversations(current => current.map(c =>
      c.id === deleted.conversation_id && Date.parse(c.last_message_at ?? '') === Date.parse(deleted.created_at)
        ? { ...c, last_message_at: undefined } : c));
    setMessages((prev) => prev.filter((m) => m.id !== id));
    // El DELETE también rebobina el resumen de la conversación. La
    // resincronización actualiza el preview incluso si Realtime está dormido.
    setResyncToken((n) => n + 1);
  }, [messages]);

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
    if (c.is_spam || conversationIsSnoozed(c, inboxNow)) continue;
    // Una conversación ya respondida no sigue pendiente aunque conserve el
    // contador histórico hasta que alguien abra el hilo.
    const unread = actionableUnreadCount(c);
    unreadByChannel[c.channel] = (unreadByChannel[c.channel] ?? 0) + unread;
    if (COMMENT_CHANNELS.includes(c.channel)) tabCounts.comments += unread;
    else if (MESSAGE_CHANNELS.includes(c.channel)) tabCounts.messages += unread;
  }
  // The "All" chip lives inside the active tab's filter row, so its count must
  // be the CURRENT tab's total — not the global sum across both tabs (that made
  // the Messages tab show comment unread too, and vice versa).
  unreadByChannel.all =
    inboxTab === "all"
      ? tabCounts.messages + tabCounts.comments
      : inboxTab === "comments"
        ? tabCounts.comments
        : tabCounts.messages;
  // Channels that belong to the current tab — drives which chips are
  // shown in the secondary filter row below the tabs. Long-standing channels
  // stay visible even without traffic; Zoho is personal and only appears for
  // the user who connected that mailbox in this workspace.
  const tabChannels = visibleChannelsForTab(inboxTab, connectedChannels);
  const visibleAvailableChannels = new Set<Channel>(tabChannels);
  // Memoize the filtered list so a single realtime UPDATE doesn't
  // rebuild the array (and force every ConversationItem to re-render)
  // on every render tick. Stable identity also lets React.memo on
  // ConversationItem actually do its job.
  const filteredConversations = useMemo(() => {
    let list = savedView ? conversations.filter(c => conversationMatchesView(c, savedView.config, savedView.userId, inboxNow))
      : search.active ? conversations : conversations.filter(c => !c.is_spam && !conversationIsSnoozed(c, inboxNow));
    // Búsqueda activa: sólo las que coinciden, en el orden de relevancia que
    // devolvió el servidor.
    if (search.active) {
      const rank = new Map(search.ids.map((id, i) => [id, i]));
      return list
        .filter((c) => rank.has(c.id))
        .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    }
    // Tab-level filter — "all" (modo unificado) no filtra por tab: muestra
    // mensajes y comentarios juntos.
    if (inboxTab === "comments") {
      list = list.filter((c) => COMMENT_CHANNELS.includes(c.channel));
    } else if (inboxTab === "messages") {
      list = list.filter((c) => MESSAGE_CHANNELS.includes(c.channel));
    }
    // Secondary filter (channel chips)
    if (channelFilter) {
      list = list.filter((c) => c.channel === channelFilter);
    }
    // Filtro terciario, sólo bajo Mercado Libre.
    if (channelFilter === "mercadolibre" && mlKindFilter !== "all") {
      list = list.filter(
        (c) => mlThreadKind(c.channel, c.thread_external_id) === mlKindFilter,
      );
    }
    // "Necesita humano": la IA escaló y dejó el hilo esperando a una persona.
    if (needsHumanOnly) {
      list = list.filter((c) => Boolean(c.needs_human_reason));
    }
    return list;
  }, [conversations, inboxTab, channelFilter, mlKindFilter, needsHumanOnly, search, savedView, inboxNow]);

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (!SHOW_RIVERZ_IMPROVEMENTS) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing = !!target?.closest('input,textarea,select,[contenteditable="true"]');
      const action = inboxShortcut(event, typing);
      if (!action || document.querySelector('[role="dialog"]')) return;
      if (action === 'reply' || action === 'search') {
        const field = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(action === 'reply' ? '[data-inbox-composer]' : '[data-inbox-search]');
        if (field && !field.disabled) { event.preventDefault(); field.focus(); }
        return;
      }
      const index = filteredConversations.findIndex(c => c.id === activeConversation?.id);
      const next = action === 'next' ? index + 1 : index < 0 ? filteredConversations.length - 1 : index - 1;
      if (filteredConversations[next]) { event.preventDefault(); handleSelectConversation(filteredConversations[next]); }
    }
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [filteredConversations, activeConversation?.id, handleSelectConversation]);

  // Cuántas esperan a una persona, sobre TODO lo cargado (no sobre la lista
  // ya filtrada) para que el contador no se vacíe al activar el propio filtro.
  const needsHumanCount = useMemo(
    () => conversations.filter((c) => !c.is_spam && Boolean(c.needs_human_reason)).length,
    [conversations],
  );

  // Counts for the ML sub-filter chips (question vs message), across all
  // loaded ML conversations regardless of the active sub-filter so the
  // chip totals stay stable while the user toggles between them.
  const mlCounts = useMemo(() => {
    let question = 0;
    let message = 0;
    let review = 0;
    const claimThreads = new Set<string>();
    for (const c of conversations) {
      const kind = mlThreadKind(c.channel, c.thread_external_id);
      if (kind === "question") question++;
      else if (kind === "message") message++;
      else if (kind === "review") review++;
      else if (kind === "claim") {
        claimThreads.add((c.thread_external_id ?? "").slice("claim:".length));
      }
    }
    return { question, message, review, claimThreads };
  }, [conversations]);

  // Reclamos ABIERTOS del workspace: los expedientes, que no son hilos y por
  // eso no viven en `conversations`. Se guardan los ids —y no sólo el total—
  // para no contar dos veces el reclamo que además tiene conversación.
  const [openClaimIds, setOpenClaimIds] = useState<string[]>([]);
  useEffect(() => {
    const wsId = workspace?.id;
    if (!wsId) return;
    let cancelled = false;
    void (async () => {
      const { data } = await createClient()
        .from("ml_claims")
        .select("claim_id")
        .eq("workspace_id", wsId)
        .neq("status", "closed");
      if (!cancelled) {
        setOpenClaimIds(((data ?? []) as Array<{ claim_id: string }>).map((r) => r.claim_id));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspace?.id]);

  // Un reclamo cuenta UNA vez, tenga expediente abierto, conversación, o las dos.
  const mlClaimCount = useMemo(
    () => new Set([...openClaimIds, ...mlCounts.claimThreads]).size,
    [openClaimIds, mlCounts.claimThreads],
  );

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
      // Recordar la pestaña/modo elegido: al recargar la bandeja vuelve tal
      // cual quedó (incluido el modo "Unificar" encendido o apagado).
      try {
        localStorage.setItem(INBOX_TAB_KEY, next);
      } catch {
        /* localStorage bloqueado (modo privado) — no es crítico */
      }
      setMlKindFilter("all");
      if (channelFilter && !channelBelongsToTab(channelFilter, next)) {
        setChannelFilter(null);
      }
      if (activeConversation) handleCloseConversation();
    },
    [inboxTab, channelFilter, activeConversation, handleCloseConversation],
  );

  // La altura la aporta el `main` del dashboard, que ya descuenta el header
  // móvil y cualquier aviso superior. Se suma sólo su padding, que las
  // márgenes negativas sacan visualmente; usar 100dvh aquí sumaba el aviso una
  // segunda vez y empujaba el compositor bajo el viewport.
  return (
    <div className="-m-4 flex h-[calc(100%_+_2rem)] min-h-0 flex-col overflow-hidden sm:-m-6 sm:h-[calc(100%_+_3rem)] lg:-m-8 lg:h-[calc(100%_+_4rem)]">
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

      <div className="flex min-h-0 flex-1 overflow-hidden">
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
            {/* Búsqueda del servidor. El componente y su endpoint existían
                desde la migración 029 y no los importaba nadie: la bandeja
                filtraba en memoria y sólo sobre el texto de la vista previa,
                así que buscar una palabra dicha adentro de una conversación
                no encontraba nada. */}
            {SHOW_RIVERZ_IMPROVEMENTS ? <div className="flex items-center border-b border-border"><div className="min-w-0 flex-1"><InboxSearchBox onResults={setSearch} /></div><TeamNotifications /></div> : <InboxSearchBox onResults={setSearch} />}
            {SHOW_RIVERZ_IMPROVEMENTS && <SavedViews onChange={applySavedView} />}
            {SHOW_RIVERZ_IMPROVEMENTS && <TeamCapacity />}
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
                counts={{
                  question: mlCounts.question,
                  message: mlCounts.message,
                  review: mlCounts.review,
                  claim: mlClaimCount,
                }}
              />
            )}
            {/* Si el último caso se resuelve mientras el filtro está activo, el
                control permanece visible para poder apagarlo. */}
            {(needsHumanCount > 0 || needsHumanOnly) && (
              <div
                className={cn(
                  "flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-medium transition-colors",
                  needsHumanOnly
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground",
                )}
              >
                <label
                  htmlFor="needs-human-filter"
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5"
                >
                  <UserRound className="h-3.5 w-3.5 shrink-0" />
                  <span>{t("inbox.needsHuman")}</span>
                  <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold tabular-nums">
                    {needsHumanCount}
                  </span>
                </label>
                <Switch
                  id="needs-human-filter"
                  checked={needsHumanOnly}
                  onCheckedChange={setNeedsHumanOnly}
                  aria-label={t("inbox.needsHuman")}
                />
              </div>
            )}
            <div className="flex-1 overflow-hidden">
              <div className="flex h-full flex-col">
              {/* Los expedientes de reclamo van arriba de las conversaciones:
                  no son hilos —son el estado, el motivo y el reloj, con enlace
                  a Mercado Libre— pero son lo más urgente del canal y quedaban
                  invisibles hasta entrar a su propia pastilla. La conversación
                  del reclamo, en cambio, sí está en la lista de abajo. */}
              {channelFilter === "mercadolibre" &&
                (mlKindFilter === "all" || mlKindFilter === "claim") && (
                <div className="max-h-48 shrink-0 overflow-y-auto border-b border-border">
                  <MlClaimsPanel workspaceId={workspace?.id ?? null} compact />
                </div>
              )}
              <div className="min-h-0 flex-1">
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
                searchActive={search.active}
                searchLoading={search.loading}
              />
              </div>
              </div>
            </div>
          </div>
        </ResizablePane>

        {/* Center panel: Message thread.
            Hidden on mobile when no conversation is selected so the
            list can occupy the full width. Always visible on lg+
            (shows its own empty-state if no thread is picked yet). */}
        <div
          className={cn(
            // `min-w-0` no es decorativo: sin él este panel es un elemento
            // flex con `min-width:auto`, o sea que no puede achicarse por
            // debajo de su contenido. En un teléfono, un mensaje con un
            // enlace largo estiraba el panel más allá de la pantalla y la
            // burbuja quedaba cortada por la derecha, con el encabezado
            // también fuera de vista.
            "flex h-full min-h-0 min-w-0 flex-1 lg:flex",
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
            anclarEn={
              deepLinkConvId && deepLinkConvId === activeConversation?.id
                ? deepLinkMomento
                : null
            }
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
                conversationId={activeConversation?.id}
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
                  conversationId={activeConversation?.id}
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
