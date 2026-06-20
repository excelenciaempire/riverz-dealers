"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  Loader2,
  RefreshCcw,
  Trash2,
  XCircle,
  AlertCircle,
  Copy,
  KeyRound,
  X,
  CreditCard,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { whatsappPaymentUrl } from "@/lib/whatsapp/billing";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import { useWorkspace } from "@/hooks/use-workspace";
import { useT } from "@/hooks/use-locale";
import type { Channel, ChannelConnection } from "@/types";
import { ChannelLogo } from "@/components/inbox/channel-logo";
import { WhatsAppEmbeddedSignup } from "@/components/settings/whatsapp-embedded-signup";
import { MetaBusinessLogin } from "@/components/settings/meta-business-login";
import { ShopifyCard } from "@/components/settings/shopify-card";
import { cn } from "@/lib/utils";

/**
 * One card per platform. Facebook and Instagram each cover two internal
 * channels (DMs + comments) but share a single page token, so the user
 * connects once and both light up — no separate Messenger / comments
 * connections to manage.
 */
interface ChannelGroup {
  key: string;
  label: string;
  description: string;
  /** Channel whose brand logo represents the group. */
  logoChannel: Channel;
  /** Optional explicit logo asset that overrides logoChannel (e.g. the Meta
   *  logo for the Facebook/Messenger group). */
  logoSrc?: string;
  /** Internal channels this group sets up. */
  members: Channel[];
  /** Channel passed to the connect flow (backend expands to siblings). */
  connectChannel: Channel;
}

const CHANNEL_GROUPS: ChannelGroup[] = [
  {
    key: "whatsapp",
    label: "WhatsApp",
    description:
      "Cloud API, WhatsApp Business o coexistencia.",
    logoChannel: "whatsapp",
    members: ["whatsapp"],
    connectChannel: "whatsapp",
  },
  {
    key: "facebook",
    label: "Meta",
    description:
      "Messenger y comentarios de tu página en una sola conexión.",
    logoChannel: "messenger",
    logoSrc: "/channels/meta.svg",
    members: ["messenger", "fb_comment"],
    connectChannel: "messenger",
  },
  {
    key: "instagram",
    label: "Instagram",
    description: "DMs y comentarios de Instagram en una sola conexión.",
    logoChannel: "instagram",
    members: ["instagram", "ig_comment"],
    connectChannel: "instagram",
  },
  {
    key: "gmail",
    label: "Gmail",
    description: "Cuentas @gmail o Google Workspace.",
    logoChannel: "gmail",
    members: ["gmail"],
    connectChannel: "gmail",
  },
  {
    key: "outlook",
    label: "Outlook",
    description: "Bandeja para Outlook, Hotmail y Microsoft 365.",
    logoChannel: "outlook",
    members: ["outlook"],
    connectChannel: "outlook",
  },
];

interface ProviderStatus {
  meta: boolean;
  google: boolean;
  microsoft: boolean;
  siteUrl: string;
}

type ManualChannel = Extract<
  Channel,
  "whatsapp" | "messenger" | "instagram" | "fb_comment" | "ig_comment"
>;

export function ChannelsPanel() {
  const { workspace, isAdmin, loading } = useWorkspace();
  const [connections, setConnections] = useState<ChannelConnection[]>([]);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<ProviderStatus | null>(null);
  const [manualOpen, setManualOpen] = useState<ManualChannel | null>(null);

  useEffect(() => {
    fetch("/api/connections/status")
      .then((r) => r.json())
      .then((j: ProviderStatus) => setProviders(j))
      .catch(() => setProviders({ meta: false, google: false, microsoft: false, siteUrl: "" }));
  }, []);

  const isProviderReady = (channel: Channel): boolean => {
    if (!providers) return false;
    if (channel === "gmail") return providers.google;
    if (channel === "outlook") return providers.microsoft;
    return providers.meta;
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copiado`);
    } catch {
      toast.error("No se pudo copiar");
    }
  };

  const fetchConnections = useCallback(async () => {
    if (!workspace) return;
    const supabase = createClient();
    // Explicit non-secret columns only. The encrypted `secrets` and
    // `webhook_secret` columns must never reach the browser; migration 078
    // also REVOKEs them at the column level so a crafted member query can't
    // read the ciphertext either.
    const { data } = await supabase
      .from("channel_connections")
      .select(
        "id, workspace_id, channel, label, status, external_account_id, config, last_error, created_at, updated_at",
      )
      .eq("workspace_id", workspace.id)
      // Las conexiones desconectadas no se muestran: al desconectar, la fila
      // debe desaparecer de la tarjeta (el registro queda en BD por si se
      // reconecta, y el router de webhooks ya las ignora).
      .neq("status", "disconnected")
      .order("created_at", { ascending: false });
    setConnections((data ?? []) as ChannelConnection[]);
  }, [workspace]);

  useEffect(() => {
    void fetchConnections();
  }, [fetchConnections]);

  const handleConnect = useCallback(
    (channel: Channel) => {
      if (!workspace) return;
      setBusy(true);
      const provider = providerForChannel(channel);
      const url = `/api/connections/${provider}/oauth/start?workspace_id=${workspace.id}&channel=${channel}`;
      window.location.assign(url);
    },
    [workspace],
  );

  // A Facebook / Instagram card maps to two member connections (DMs +
  // comments) that share one account, so these take an array of ids and
  // mutate them in a single batched query. We also update local state
  // optimistically so the row vanishes immediately; the earlier
  // per-id forEach fired N parallel refetches that raced and could leave a
  // just-deleted row on screen until a manual reload.
  const handleDisconnect = useCallback(
    async (ids: string[]) => {
      if (!ids.length || !confirm("¿Desconectar este canal?")) return;
      const supabase = createClient();
      const { error } = await supabase
        .from("channel_connections")
        .update({ status: "disconnected" })
        .in("id", ids);
      if (error) {
        toast.error(error.message);
        return;
      }
      // Quitar de la vista al instante (no solo marcar disconnected): el
      // usuario espera que la fila desaparezca al desconectar.
      setConnections((prev) => prev.filter((c) => !ids.includes(c.id)));
      toast.success("Canal desconectado");
      void fetchConnections();
    },
    [fetchConnections],
  );

  const handleDelete = useCallback(
    async (ids: string[]) => {
      if (!ids.length || !confirm("¿Eliminar esta conexión?")) return;
      const supabase = createClient();
      const { error } = await supabase
        .from("channel_connections")
        .delete()
        .in("id", ids);
      if (error) {
        toast.error(error.message);
        return;
      }
      setConnections((prev) => prev.filter((c) => !ids.includes(c.id)));
      toast.success("Conexión eliminada");
      void fetchConnections();
    },
    [fetchConnections],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        No se encontró tu espacio de trabajo.
      </div>
    );
  }

  const connectionsByChannel = new Map<Channel, ChannelConnection[]>();
  for (const c of connections) {
    const list = connectionsByChannel.get(c.channel) ?? [];
    list.push(c);
    connectionsByChannel.set(c.channel, list);
  }
  const connectedCount = connections.filter((c) => c.status === "connected").length;

  const anyProviderMissing =
    providers && (!providers.meta || !providers.google || !providers.microsoft);

  return (
    <div className="space-y-4">
      {/* Provider config banner */}
      {anyProviderMissing && isAdmin && providers && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0 flex-1 space-y-2">
              <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                Faltan apps OAuth por registrar
              </h3>
              <ul className="space-y-1 text-xs text-amber-100/70">
                <li>
                  <span className={providers.meta ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-300"}>
                    {providers.meta ? "✓" : "✗"}
                  </span>{" "}
                  <strong>Meta App</strong> — developers.facebook.com → My Apps → Create App
                  → Business. Variables: <code>META_APP_ID</code>, <code>META_APP_SECRET</code>
                </li>
                <li>
                  <span className={providers.google ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-300"}>
                    {providers.google ? "✓" : "✗"}
                  </span>{" "}
                  <strong>Google OAuth Client</strong> — console.cloud.google.com →
                  APIs & Services → Credentials. Variables: <code>GOOGLE_CLIENT_ID</code>,
                  <code>GOOGLE_CLIENT_SECRET</code>
                </li>
                <li>
                  <span className={providers.microsoft ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-300"}>
                    {providers.microsoft ? "✓" : "✗"}
                  </span>{" "}
                  <strong>Microsoft Azure App</strong> — portal.azure.com → App registrations
                  → New registration. Variables: <code>MICROSOFT_CLIENT_ID</code>,
                  <code>MICROSOFT_CLIENT_SECRET</code>
                </li>
              </ul>
              {providers.siteUrl && (
                <div className="mt-2 rounded-md bg-muted/50 p-2 text-xs">
                  <p className="mb-1 text-amber-800 dark:text-amber-200">
                    Redirect URIs a pegar en cada consola:
                  </p>
                  <div className="space-y-1 font-mono">
                    {(["meta", "google", "microsoft"] as const).map((p) => {
                      const url = `${providers.siteUrl}/api/connections/${p}/oauth/callback`;
                      return (
                        <div key={p} className="flex items-center justify-between gap-2">
                          <span className="truncate text-foreground">{url}</span>
                          <button
                            onClick={() => copyToClipboard(url, p)}
                            className="shrink-0 rounded p-1 flex items-center justify-center min-h-9 min-w-9 sm:min-h-0 sm:min-w-0 text-muted-foreground hover:bg-accent hover:text-foreground"
                            title="Copiar"
                          >
                            <Copy className="size-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <h2 className="text-xl font-bold text-foreground">Canales</h2>
        <div className="hidden shrink-0 text-right sm:block">
          <p className="text-3xl font-bold text-foreground">{connectedCount}</p>
          <p className="text-xs text-muted-foreground">
            {connectedCount === 1 ? "canal activo" : "canales activos"}
          </p>
        </div>
      </div>
      {!isAdmin && (
        <p className="text-xs text-muted-foreground">Solo lectura.</p>
      )}

      {manualOpen && workspace && (
        <ManualTokenModal
          channel={manualOpen}
          workspaceId={workspace.id}
          onClose={() => setManualOpen(null)}
          onSaved={async () => {
            setManualOpen(null);
            await fetchConnections();
          }}
        />
      )}

      {/* Grid de canales — una tarjeta por plataforma. */}
      {/* items-start: cada tarjeta toma la altura de su contenido y NO se
          estira a la más alta de la fila (antes, una cuenta con muchas
          páginas inflaba a WhatsApp/Instagram con espacio vacío). */}
      <ul className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CHANNEL_GROUPS.map((g) => {
          // Aggregate connections across the group's member channels,
          // then collapse to one row per connected account (page / IG /
          // mailbox / phone) so Messenger + comments show as a single
          // "Facebook" connection rather than two redundant rows.
          const memberConns = g.members.flatMap(
            (m) => connectionsByChannel.get(m) ?? [],
          );
          const byAccount = new Map<string, ChannelConnection[]>();
          for (const c of memberConns) {
            const key = c.external_account_id ?? c.id;
            const arr = byAccount.get(key) ?? [];
            arr.push(c);
            byAccount.set(key, arr);
          }
          const accounts = [...byAccount.values()];
          const anyConnected = memberConns.some((c) => c.status === "connected");
          const ready = isProviderReady(g.connectChannel);
          const isMeta =
            g.connectChannel === "whatsapp" ||
            g.connectChannel === "messenger" ||
            g.connectChannel === "instagram";
          return (
            <li
              key={g.key}
              className={cn(
                "group flex flex-col gap-3 overflow-hidden rounded-xl border bg-card p-4 transition-all",
                anyConnected
                  ? "border-emerald-500/40 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.1)]"
                  : "border-border hover:border-foreground/30",
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "flex size-11 shrink-0 items-center justify-center rounded-xl p-2 shadow-sm ring-1 ring-border",
                    // El logo de Meta es azul sobre transparente: va en una
                    // caja blanca para que contraste con la tarjeta oscura.
                    g.logoSrc ? "bg-white" : "bg-card",
                  )}
                >
                  <ChannelLogo channel={g.logoChannel} src={g.logoSrc} size={28} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{g.label}</p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                    {g.description}
                  </p>
                </div>
              </div>

              {/* One row per connected account. Con muchas cuentas la lista
                  hace scroll en vez de estirar la tarjeta sin límite. */}
              {accounts.length > 0 && (
                <ul className="max-h-80 space-y-1 overflow-y-auto">
                  {accounts.map((conns) => {
                    const primary =
                      conns.find((c) => c.status === "connected") ?? conns[0];
                    const ids = conns.map((c) => c.id);
                    const errText =
                      primary.status === "error"
                        ? (primary as ChannelConnection & { last_error?: string }).last_error
                        : null;
                    return (
                      <li
                        key={primary.id}
                        className="rounded-md bg-muted/60 px-2 py-1.5 ring-1 ring-border/50"
                      >
                        <div className="flex items-center gap-2">
                          <StatusIcon status={primary.status} />
                          <span className="flex-1 truncate text-xs text-foreground">
                            {primary.label ?? primary.external_account_id ?? "Sin etiqueta"}
                          </span>
                          {isAdmin && (
                            <>
                              {primary.status === "connected" && (
                                <button
                                  onClick={() => handleDisconnect(ids)}
                                  title="Desconectar"
                                  className="rounded p-1 flex items-center justify-center min-h-10 min-w-10 sm:min-h-0 sm:min-w-0 text-muted-foreground hover:bg-accent hover:text-amber-400"
                                >
                                  <RefreshCcw className="size-3.5" />
                                </button>
                              )}
                              <button
                                onClick={() => handleDelete(ids)}
                                title="Eliminar"
                                className="rounded p-1 flex items-center justify-center min-h-10 min-w-10 sm:min-h-0 sm:min-w-0 text-muted-foreground hover:bg-accent hover:text-red-400"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                        {errText && (
                          <p className="mt-1 pl-6 text-[10px] leading-snug text-red-600 dark:text-red-400">
                            {errText}
                          </p>
                        )}
                        {/* WhatsApp business-initiated sends (plantillas) need a
                            valid payment method on the WABA, or Meta blocks them
                            (error 141006). Surface a direct link so the merchant
                            can add/fix it in WhatsApp Manager. */}
                        {g.connectChannel === "whatsapp" &&
                          primary.status === "connected" && (
                            <a
                              href={whatsappPaymentUrl(
                                primary.config?.waba_id as string | undefined,
                              )}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="WhatsApp Manager → Configuración → Métodos de pago"
                              className="mt-1 flex items-center gap-1 pl-6 text-[10px] font-medium text-muted-foreground hover:text-foreground"
                            >
                              <CreditCard className="size-3" />
                              Configurar medio de pago
                            </a>
                          )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* CTA */}
              {isAdmin && (
                <div className="mt-auto space-y-1.5">
                  {/* WhatsApp is one-per-workspace: once a number is
                      connected, hide the connect CTAs and tell the admin to
                      disconnect first to switch numbers. */}
                  {g.connectChannel === "whatsapp" && anyConnected ? (
                    <p className="text-center text-[10px] leading-snug text-muted-foreground">
                      Un WhatsApp por cuenta. Desconéctalo para cambiar de número.
                    </p>
                  ) : /* WhatsApp: Embedded Signup (Coexistence/new number) is
                      the primary path WHEN configured; otherwise fall through
                      to the manual paste button so the WhatsApp card still
                      lets the admin connect any number via token paste. */
                  g.connectChannel === "whatsapp" &&
                  ready &&
                  process.env.NEXT_PUBLIC_META_ES_CONFIG_ID ? (
                    <>
                      <WhatsAppEmbeddedSignup
                        workspaceId={workspace.id}
                        onConnected={() => void fetchConnections()}
                      />
                      <button
                        onClick={() => setManualOpen("whatsapp")}
                        className="w-full text-center text-[10px] leading-snug text-muted-foreground hover:text-foreground hover:underline"
                      >
                        <KeyRound className="mr-1 inline-block size-2.5" />
                        o conectar pegando un token manualmente
                      </button>
                    </>
                  ) : /* Facebook / Instagram: Facebook Login for Business via
                      the JS SDK (FB.login with config_id). Facebook rejects
                      config_id on the bare server redirect, so the SDK is the
                      working path. Manual token paste stays as a fallback. */
                  isMeta &&
                    g.connectChannel !== "whatsapp" &&
                    ready &&
                    process.env.NEXT_PUBLIC_META_LOGIN_CONFIG_ID ? (
                    <>
                      <MetaBusinessLogin
                        workspaceId={workspace.id}
                        channel={g.connectChannel as "messenger" | "instagram"}
                        anyConnected={anyConnected}
                        logoChannel={g.logoChannel as "messenger" | "instagram"}
                        onConnected={() => void fetchConnections()}
                      />
                      <button
                        onClick={() => setManualOpen(g.connectChannel as ManualChannel)}
                        className="w-full text-center text-[10px] leading-snug text-muted-foreground hover:text-foreground hover:underline"
                      >
                        <KeyRound className="mr-1 inline-block size-2.5" />
                        o conectar pegando un token manualmente
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          if (!ready) {
                            toast.error(
                              g.connectChannel === "gmail"
                                ? "Configura Google Cloud OAuth Client primero (ver banner amarillo)"
                                : g.connectChannel === "outlook"
                                  ? "Configura Microsoft Azure App primero (ver banner amarillo)"
                                  : "Configura la Meta App primero (ver banner amarillo)",
                            );
                            return;
                          }
                          // Meta page channels: use the real OAuth / Facebook
                          // Login for Business flow when a login configuration
                          // is set (required for App Review — the reviewer must
                          // see Meta's consent screen). Without a config_id the
                          // classic dialog won't load for a Business app, so we
                          // fall back to manual token paste.
                          if (isMeta && !process.env.NEXT_PUBLIC_META_LOGIN_CONFIG_ID) {
                            setManualOpen(g.connectChannel as ManualChannel);
                            return;
                          }
                          handleConnect(g.connectChannel);
                        }}
                        disabled={busy}
                        className={cn(
                          "flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                          !ready
                            ? "cursor-not-allowed border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/15"
                            : anyConnected
                              ? "border border-border bg-muted/50 text-foreground hover:bg-accent"
                              : "bg-primary text-primary-foreground hover:bg-primary/90",
                        )}
                      >
                        {!ready ? (
                          <>
                            <AlertCircle className="size-4" />
                            Configura el proveedor
                          </>
                        ) : (
                          <>
                            <ChannelLogo channel={g.logoChannel} size={16} />
                            {anyConnected ? "Añadir otra cuenta" : "Conectar"}
                          </>
                        )}
                      </button>
                      {/* Meta: keep manual token paste available as a secondary
                          path once OAuth is the primary (config_id set). */}
                      {isMeta &&
                        ready &&
                        process.env.NEXT_PUBLIC_META_LOGIN_CONFIG_ID && (
                          <button
                            onClick={() =>
                              setManualOpen(g.connectChannel as ManualChannel)
                            }
                            className="w-full text-center text-[10px] leading-snug text-muted-foreground hover:text-foreground hover:underline"
                          >
                            <KeyRound className="mr-1 inline-block size-2.5" />
                            o conectar pegando un token manualmente
                          </button>
                        )}
                    </>
                  )}

                  {/* Botón grande y claro para desconectar. El ícono ↻ por
                      fila es fácil de no ver; este desconecta todas las
                      cuentas de la tarjeta de una. */}
                  {anyConnected && (
                    <button
                      onClick={() => {
                        const ids = accounts.flatMap((conns) =>
                          conns.map((c) => c.id),
                        );
                        if (
                          ids.length > 1 &&
                          !window.confirm(
                            `¿Desconectar las ${ids.length} cuentas de ${g.label}?`,
                          )
                        )
                          return;
                        handleDisconnect(ids);
                      }}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-500/15 dark:text-red-400"
                    >
                      <RefreshCcw className="size-4" />
                      {accounts.length > 1 ? "Desconectar todas" : "Desconectar"}
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
        <ShopifyCard />
      </ul>
    </div>
  );
}

function StatusIcon({ status }: { status: ChannelConnection["status"] }) {
  const classes = "size-3.5";
  if (status === "connected") return <CheckCircle2 className={cn(classes, "text-emerald-700 dark:text-emerald-400")} />;
  if (status === "error") return <AlertCircle className={cn(classes, "text-red-600 dark:text-red-400")} />;
  if (status === "pending") return <Loader2 className={cn(classes, "animate-spin text-amber-600 dark:text-amber-400")} />;
  return <XCircle className={cn(classes, "text-muted-foreground")} />;
}

const MANUAL_HINT: Record<ManualChannel, { label: string; tip: string }> = {
  whatsapp: {
    label: "WhatsApp",
    tip: "Pega un System User Token (whatsapp_business_messaging + whatsapp_business_management) + el phone_number_id y waba_id. Importante: el número debe estar registrado en Cloud API y NO estar en uso en la app de WhatsApp Business del celular (coexistencia), o no recibirá mensajes.",
  },
  messenger: {
    label: "Facebook Messenger",
    tip: "Pega un Page Access Token de la página (Business Settings → System Users → Generar identificador con permiso pages_messaging + pages_show_list).",
  },
  instagram: {
    label: "Instagram DMs",
    tip: "Pega el Page Access Token de la página que tiene la cuenta IG Profesional vinculada. Necesita permisos instagram_basic + instagram_manage_messages.",
  },
  fb_comment: {
    label: "Comentarios FB",
    tip: "Pega el Page Access Token con permisos pages_read_engagement + pages_manage_engagement.",
  },
  ig_comment: {
    label: "Comentarios IG",
    tip: "Pega el Page Access Token de la página que gestiona la cuenta IG con instagram_manage_comments.",
  },
};

function ManualTokenModal({
  channel,
  workspaceId,
  onClose,
  onSaved,
}: {
  channel: ManualChannel;
  workspaceId: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const meta = MANUAL_HINT[channel];
  // Las etiquetas de marca quedan tal cual; solo los dos canales de
  // comentarios (no son nombres de marca) se traducen según el idioma.
  const metaLabel =
    channel === "fb_comment"
      ? t("common.channelFbComments")
      : channel === "ig_comment"
        ? t("common.channelIgComments")
        : meta.label;
  const [token, setToken] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!token.trim()) {
      toast.error("Pega un token");
      return;
    }
    if (channel === "whatsapp" && (!phoneNumberId.trim() || !wabaId.trim())) {
      toast.error("WhatsApp necesita phone_number_id y waba_id");
      return;
    }
    setSaving(true);
    try {
      const res = await fetchWithCsrf("/api/connections/meta/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channel,
          token: token.trim(),
          workspace_id: workspaceId,
          phone_number_id: phoneNumberId.trim() || undefined,
          waba_id: wabaId.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; label?: string };
      if (!res.ok) {
        toast.error(json.error ?? "No se pudo guardar el token");
        return;
      }
      toast.success(`Conectado: ${json.label ?? channel}`);
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Conectar {metaLabel} con token
            </h3>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{meta.tip}</p>
          </div>
          <button
            onClick={onClose}
            className="-mr-1 -mt-1 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Cerrar"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="block text-[11px] font-medium text-foreground">
              Access token
            </span>
            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="EAA..."
              rows={4}
              className="mt-1 block w-full rounded-md border border-border bg-muted px-2.5 py-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </label>
          {channel === "whatsapp" && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[11px] font-medium text-foreground">
                  phone_number_id
                </span>
                <input
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  placeholder="1166510229869969"
                  className="mt-1 block w-full rounded-md border border-border bg-muted px-2.5 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] font-medium text-foreground">
                  waba_id
                </span>
                <input
                  value={wabaId}
                  onChange={(e) => setWabaId(e.target.value)}
                  placeholder="2771752166515024"
                  className="mt-1 block w-full rounded-md border border-border bg-muted px-2.5 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
              </label>
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving && <Loader2 className="size-3 animate-spin" />}
            Guardar y conectar
          </button>
        </div>
      </div>
    </div>
  );
}

function providerForChannel(channel: Channel): string {
  if (
    channel === "whatsapp" ||
    channel === "instagram" ||
    channel === "messenger" ||
    channel === "fb_comment" ||
    channel === "ig_comment"
  )
    return "meta";
  if (channel === "gmail") return "google";
  if (channel === "outlook") return "microsoft";
  return channel;
}
