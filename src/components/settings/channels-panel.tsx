"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  Loader2,
  Unplug,
  XCircle,
  AlertCircle,
  Copy,
  X,
  CreditCard,
  ShieldCheck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { whatsappPaymentUrl } from "@/lib/whatsapp/billing";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import { useWorkspace } from "@/hooks/use-workspace";
import { useT } from "@/hooks/use-locale";
import type { Channel, ChannelConnection } from "@/types";
import { channelLabel } from "@/lib/channels/display";
import { ChannelLogo } from "@/components/inbox/channel-logo";
import { WhatsAppEmbeddedSignup } from "@/components/settings/whatsapp-embedded-signup";
import { MetaBusinessLogin } from "@/components/settings/meta-business-login";
import { ShopifyCard } from "@/components/settings/shopify-card";
import { StoreCard } from "@/components/settings/store-card";
import { MercadoPagoCard } from "@/components/settings/mercadopago-card";
import { KlaviyoCard } from "@/components/settings/klaviyo-card";
import { MetaPixelCard } from "@/components/settings/meta-pixel-card";
import { MercadoLibreConnect } from "@/components/settings/mercadolibre-connect";
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
  /** i18n key (settings.*) for the card description, resolved at render. */
  descriptionKey: string;
  /** Channel whose brand logo represents the group. */
  logoChannel: Channel;
  /** Optional explicit logo asset that overrides logoChannel. */
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
    descriptionKey: "settings.whatsappCardDescription",
    logoChannel: "whatsapp",
    members: ["whatsapp"],
    connectChannel: "whatsapp",
  },
  {
    key: "facebook",
    label: "Facebook",
    descriptionKey: "settings.facebookCardDescription",
    logoChannel: "messenger",
    logoSrc: "/channels/facebook.svg",
    members: ["messenger", "fb_comment"],
    connectChannel: "messenger",
  },
  {
    key: "instagram",
    label: "Instagram",
    descriptionKey: "settings.instagramCardDescription",
    logoChannel: "instagram",
    members: ["instagram", "ig_comment"],
    connectChannel: "instagram",
  },
  {
    key: "gmail",
    label: "Gmail",
    descriptionKey: "settings.gmailCardDescription",
    logoChannel: "gmail",
    members: ["gmail"],
    connectChannel: "gmail",
  },
  {
    key: "outlook",
    label: "Outlook",
    descriptionKey: "settings.outlookCardDescription",
    logoChannel: "outlook",
    members: ["outlook"],
    connectChannel: "outlook",
  },
  {
    key: "mercadolibre",
    label: "Mercado Libre",
    descriptionKey: "settings.mercadolibreCardDescription",
    logoChannel: "mercadolibre",
    // El isotipo oficial es amarillo con anillo azul: va en caja blanca
    // para que el azul contraste con la tarjeta oscura.
    logoSrc: "/channels/mercadolibre.svg",
    members: ["mercadolibre"],
    connectChannel: "mercadolibre",
  },
  {
    key: "tiktok",
    label: "TikTok",
    descriptionKey: "settings.tiktokCardDescription",
    logoChannel: "tiktok_comment",
    logoSrc: "/channels/tiktok.svg",
    members: ["tiktok_comment"],
    connectChannel: "tiktok_comment",
  },
];

interface ProviderStatus {
  meta: boolean;
  google: boolean;
  microsoft: boolean;
  mercadolibre: boolean;
  tiktok: boolean;
  siteUrl: string;
}

type ManualChannel = Extract<
  Channel,
  "whatsapp" | "messenger" | "instagram" | "fb_comment" | "ig_comment"
>;

export function ChannelsPanel() {
  const t = useT();
  const { workspace, isAdmin, loading } = useWorkspace();
  const [connections, setConnections] = useState<ChannelConnection[]>([]);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<ProviderStatus | null>(null);
  const [manualOpen, setManualOpen] = useState<ManualChannel | null>(null);

  useEffect(() => {
    fetch("/api/connections/status")
      .then((r) => r.json())
      .then((j: ProviderStatus) => setProviders(j))
      .catch(() =>
        setProviders({
          meta: false,
          google: false,
          microsoft: false,
          mercadolibre: false,
          tiktok: false,
          siteUrl: "",
        }),
      );
  }, []);

  /**
   * El navegador salta al `#canal-…` sólo si el elemento ya existe, y acá las
   * tarjetas se pintan después de cargar el workspace: sin esto, el link del
   * aviso abría la página arriba de todo, como si el ancla no existiera.
   */
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id || loading) return;
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: "center" });
    });
  }, [loading]);

  const isProviderReady = (channel: Channel): boolean => {
    if (!providers) return false;
    if (channel === "gmail") return providers.google;
    if (channel === "outlook") return providers.microsoft;
    if (channel === "mercadolibre") return providers.mercadolibre;
    if (channel === "tiktok_comment") return providers.tiktok;
    return providers.meta;
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("settings.copiedToClipboard", { label }));
    } catch {
      toast.error(t("settings.couldNotCopy"));
    }
  };

  const fetchConnections = useCallback(async () => {
    if (!workspace) return;
    const supabase = createClient();
    // Explicit non-secret columns only. The encrypted `secrets` and
    // `webhook_secret` columns must never reach the browser; migration 078
    // also REVOKEs them at the column level so a crafted member query can't
    // read the ciphertext either.
    const { data, error } = await supabase
      .from("channel_connections")
      .select(
        "id, workspace_id, channel, label, status, external_account_id, config, last_error, created_at, updated_at, messaging_limit_tier, quality_rating, health_can_send, health_review_status, health_blockers, health_checked_at",
      )
      .eq("workspace_id", workspace.id)
      // Las conexiones desconectadas no se muestran: al desconectar, la fila
      // debe desaparecer de la tarjeta (el registro queda en BD por si se
      // reconecta, y el router de webhooks ya las ignora).
      .neq("status", "disconnected")
      .order("created_at", { ascending: false });
    // Un error acá no puede pasar en silencio: la tarjeta quedaría igual que
    // "sin conectar" y el comercio pensaría que perdió sus canales. Pasó de
    // verdad — la 078 revoca el SELECT de tabla y otorga por columna, así que
    // una columna nueva sin grant (42501) vacía TODA la consulta.
    if (error) {
      console.error("channel_connections select failed", error);
      toast.error(t("settings.connectionsLoadError"));
      return;
    }
    setConnections((data ?? []) as ChannelConnection[]);
  }, [workspace, t]);

  useEffect(() => {
    void fetchConnections();
  }, [fetchConnections]);

  const handleConnect = useCallback(
    (channel: Channel) => {
      if (!workspace) return;
      setBusy(true);
      // TikTok usa su ruta dedicada (la URL registrada en la app de TikTok).
      if (channel === "tiktok_comment") {
        window.location.assign(`/api/tiktok/oauth/start?workspace_id=${workspace.id}`);
        return;
      }
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
      if (!ids.length || !confirm(t("settings.disconnectChannelConfirm"))) return;
      const supabase = createClient();
      const { error } = await supabase
        .from("channel_connections")
        .update({ status: "disconnected" })
        .in("id", ids);
      if (error) {
        toast.error(t("settings.genericError"));
        return;
      }
      // Quitar de la vista al instante (no solo marcar disconnected): el
      // usuario espera que la fila desaparezca al desconectar.
      setConnections((prev) => prev.filter((c) => !ids.includes(c.id)));
      toast.success(t("settings.channelDisconnected"));
      void fetchConnections();
    },
    [fetchConnections, t],
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
        {t("settings.workspaceNotFound")}
      </div>
    );
  }

  const connectionsByChannel = new Map<Channel, ChannelConnection[]>();
  for (const c of connections) {
    const list = connectionsByChannel.get(c.channel) ?? [];
    list.push(c);
    connectionsByChannel.set(c.channel, list);
  }

  // Las aplicaciones de OAuth son de Riverz, no del comercio: sus variables
  // de entorno y sus URLs de retorno se configuran una vez para toda la
  // plataforma. El cartel con META_APP_ID / GOOGLE_CLIENT_ID y las URLs para
  // pegar es documentación interna, y al dueño de una tienda le llega como
  // una tarea suya que no puede hacer — encima arriba de todo, antes de lo
  // único que sí puede hacer, que es conectar. La tarjeta afectada ya dice
  // "Próximamente" por su cuenta.
  const anyProviderMissing = false;

  return (
    <div className="space-y-4">
      {/* Provider config banner */}
      {anyProviderMissing && isAdmin && providers && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0 flex-1 space-y-2">
              <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                {t("settings.oauthAppsMissing")}
              </h3>
              <ul className="space-y-1 text-xs text-amber-800/80 dark:text-amber-100/70">
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
                    {t("settings.redirectUrisToPaste")}
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
                            title={t("settings.copy")}
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

      {/* La página ya se titula "Integraciones": un segundo título encima de
          la misma grilla no agrega información. */}
      {!isAdmin && (
        <p className="text-xs text-muted-foreground">{t("settings.readOnly")}</p>
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

      {/* Canales — una tarjeta por plataforma, TODAS del mismo alto por fila
          (`items-stretch`) y con el CTA anclado abajo (mt-auto) para que los
          botones queden alineados. Una tarjeta con poco contenido (p.ej. Gmail
          sin conectar) muestra algo de espacio antes del botón: es el costo de
          que todos los contenedores midan igual. */}
      <ul className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          // En Meta, comentarios y mensajes comparten una misma cuenta, pero
          // son capacidades distintas. Que los comentarios sigan activos no
          // puede tapar que Messenger o Instagram ya perdieron su token.
          const anyConnected = memberConns.some(
            (c) => c.channel === g.connectChannel && c.status === "connected",
          );
          const ready = isProviderReady(g.connectChannel);
          const isMeta =
            g.connectChannel === "whatsapp" ||
            g.connectChannel === "messenger" ||
            g.connectChannel === "instagram";
          return (
            <li
              key={g.key}
              // Ancla del aviso "Necesita tu atención": el link lleva a la
              // tarjeta del canal caído, no al principio de la página.
              id={`canal-${g.key}`}
              className={cn(
                "group flex scroll-mt-24 flex-col gap-3 overflow-hidden rounded-xl border bg-card p-4 transition-all",
                anyConnected
                  ? "border-emerald-500/40 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.1)]"
                  : "border-border hover:border-foreground/30",
              )}
            >
              <div className="flex items-start gap-3">
                {/* Todos los logos van sobre blanco: son marcas de colores
                    sobre fondo transparente y en modo oscuro se pierden. */}
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white p-2 shadow-sm ring-1 ring-border">
                  <ChannelLogo channel={g.logoChannel} src={g.logoSrc} size={28} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{g.label}</p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                    {t(g.descriptionKey)}
                  </p>
                  {/* TikTok gestiona comentarios por API solo en cuentas
                      Business; el switch es gratis e instantáneo. Se avisa
                      antes de conectar para que el comercio no se atore. */}
                  {g.connectChannel === "tiktok_comment" && accounts.length === 0 && (
                    <p className="mt-1 text-[11px] leading-snug text-accent-ink">
                      {t("settings.tiktokBusinessNote")}
                    </p>
                  )}
                </div>
              </div>

              {/* One row per connected account. Con muchas cuentas la lista
                  hace scroll en vez de estirar la tarjeta sin límite. */}
              {accounts.length > 0 && (
                <ul className="max-h-80 space-y-1 overflow-y-auto">
                  {accounts.map((conns) => {
                    // La fila representa el canal que esta tarjeta conecta.
                    // Elegir el hermano que aún funciona (p. ej. comentarios)
                    // escondía el error del canal de mensajes y mostraba una
                    // marca verde junto a un aviso de reconexión.
                    const primary =
                      conns.find((c) => c.channel === g.connectChannel) ?? conns[0];
                    const ids = conns.map((c) => c.id);
                    const errText =
                      primary.status === "error"
                        ? (primary as ChannelConnection & { last_error?: string })
                            .last_error
                        : null;
                    const accountLabel =
                      g.connectChannel === "instagram"
                        ? primary.label?.replace(/\s+\(Instagram\)$/u, "")
                        : primary.label;
                    return (
                      <li
                        key={primary.id}
                        className="rounded-md bg-muted/60 px-2 py-1.5 ring-1 ring-border/50"
                      >
                        <div className="flex items-center gap-2">
                          <StatusIcon status={primary.status} />
                          <span className="flex-1 truncate text-xs text-foreground">
                            {accountLabel ??
                              primary.external_account_id ??
                              t("settings.noLabel")}
                          </span>
                          {/* Una sola acción por cuenta. Antes había dos
                              iconos —"desconectar" y "eliminar"— que para
                              quien mira hacen lo mismo: la fila desaparece
                              y hay que volver a conectar. La diferencia era
                              interna (marcar vs borrar la fila), no algo
                              que el comercio pueda decidir con criterio. */}
                          {isAdmin && (
                            <button
                              onClick={() => handleDisconnect(ids)}
                              title={t("settings.disconnectAction")}
                              className="rounded p-1 flex items-center justify-center min-h-10 min-w-10 sm:min-h-0 sm:min-w-0 text-muted-foreground hover:bg-accent hover:text-red-700 dark:hover:text-red-400"
                            >
                              <Unplug className="size-3.5" />
                            </button>
                          )}
                        </div>
                        {errText && (
                          <p className="mt-1 pl-6 text-[10px] leading-snug text-red-600 dark:text-red-400">
                            {errText}
                          </p>
                        )}
                        {/* Estado de entrega de WhatsApp: puede-enviar / cupo /
                            calidad + nota honesta de verificación. Lo que Meta
                            expone y antes se leía una vez y se tiraba. */}
                        {g.connectChannel === "whatsapp" &&
                          primary.status === "connected" && (
                            <WhatsAppHealth connection={primary} />
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
                              title={t("settings.whatsappManagerPaymentTooltip")}
                              className="mt-1 flex items-center gap-1 pl-6 text-[10px] font-medium text-muted-foreground hover:text-foreground"
                            >
                              <CreditCard className="size-3" />
                              {t("settings.configurePaymentMethod")}
                            </a>
                          )}
                        {/* El pie del correo. Sólo en los buzones: en chat el
                            nombre está arriba y una firma por mensaje sería
                            ruido. */}
                        {(g.connectChannel === "gmail" ||
                          g.connectChannel === "outlook") &&
                          primary.status === "connected" &&
                          isAdmin && <FirmaDeCorreo connection={primary} />}
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
                      {t("settings.oneWhatsappPerAccount")}
                    </p>
                  ) : /* WhatsApp: Embedded Signup (Coexistence/new number) is
                      the primary path WHEN configured; otherwise fall through
                      to the manual paste button so the WhatsApp card still
                      lets the admin connect any number via token paste. */
                  g.connectChannel === "whatsapp" &&
                  ready &&
                  process.env.NEXT_PUBLIC_META_ES_CONFIG_ID ? (
                    <div className="space-y-1.5">
                      {/* One entry point → Meta's "Select your setup" screen,
                          which offers both a new number and coexistence (keep
                          the WhatsApp Business app on the phone, same number). */}
                      <WhatsAppEmbeddedSignup
                        workspaceId={workspace.id}
                        onConnected={() => void fetchConnections()}
                      />
                      <p className="text-center text-[10px] leading-snug text-muted-foreground">
                        {t("settings.whatsappCoexistenceHint")}
                      </p>
                    </div>
                  ) : /* Facebook / Instagram: Facebook Login for Business via
                      the JS SDK (FB.login with config_id). Facebook rejects
                      config_id on the bare server redirect, so the SDK is the
                      working path. Manual token paste stays as a fallback. */
                  isMeta &&
                    g.connectChannel !== "whatsapp" &&
                    ready &&
                    process.env.NEXT_PUBLIC_META_LOGIN_CONFIG_ID ? (
                    <MetaBusinessLogin
                      workspaceId={workspace.id}
                      channel={g.connectChannel as "messenger" | "instagram"}
                      anyConnected={anyConnected}
                      logoChannel={g.logoChannel as "messenger" | "instagram"}
                      // El mismo logo que la tarjeta mantiene una sola marca
                      // visual durante todo el flujo.
                      logoSrc={g.logoSrc}
                      onConnected={() => void fetchConnections()}
                    />
                  ) : g.connectChannel === "mercadolibre" ? (
                    // ML es por país: el vendedor elige su país (una sola app
                    // autoriza a todos) y se loguea en el dominio correcto.
                    <MercadoLibreConnect
                      workspaceId={workspace.id}
                      ready={ready}
                      anyConnected={anyConnected}
                      busy={busy}
                    />
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          // Sin aplicación configurada no hay nada que
                          // intentar: el botón queda inerte en vez de tirar
                          // un error que le pide al comercio algo que no
                          // depende de él.
                          if (!ready) return;
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
                        disabled={busy || !ready}
                        className={cn(
                          "flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                          // Un solo botón de acción para todas las tarjetas, con
                          // el mismo color: conectar y añadir otra cuenta son lo
                          // mismo, y el gris hacía ver la tarjeta ya conectada
                          // como si estuviera a medias.
                          !ready
                            ? "cursor-not-allowed border border-border bg-muted/40 text-muted-foreground"
                            : "bg-primary text-primary-foreground hover:bg-primary/90",
                        )}
                      >
                        {!ready ? (
                          // Falta la aplicación del lado de Riverz, no del
                          // comercio: nadie puede resolverlo desde acá, así
                          // que se dice lo único cierto y accionable — todavía
                          // no está. "Configura el proveedor" mandaba a
                          // buscar una pantalla que no existe.
                          <>{t("settings.comingSoon")}</>
                        ) : (
                          <>
                            <ChannelLogo channel={g.logoChannel} size={16} />
                            {anyConnected
                              ? t("settings.addAnotherAccount")
                              : t("settings.connect")}
                          </>
                        )}
                      </button>
                    </>
                  )}

                  {/* Solo con varias cuentas: ahí sí agrega algo, porque
                      las desconecta todas de una. Con una sola cuenta era
                      un segundo botón para lo mismo que el icono de arriba. */}
                  {anyConnected && accounts.length > 1 && (
                    <button
                      onClick={() => {
                        const ids = accounts.flatMap((conns) =>
                          conns.map((c) => c.id),
                        );
                        if (
                          ids.length > 1 &&
                          !window.confirm(
                            t("settings.disconnectAllAccountsConfirm", {
                              n: ids.length,
                              label: g.label,
                            }),
                          )
                        )
                          return;
                        handleDisconnect(ids);
                      }}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-500/15 dark:text-red-400"
                    >
                      <Unplug className="size-4" />
                      {t("settings.disconnectAllN", { n: accounts.length })}
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
        <ShopifyCard />
        <StoreCard platform="tiendanube" />
        <StoreCard platform="woocommerce" />
        <MercadoPagoCard />
        <MetaPixelCard />
        <KlaviyoCard />
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

// i18n keys per manual channel. The brand labels (whatsapp/messenger/instagram)
// resolve to a settings.* key; the two comment channels use channelLabel(). Tips
// are settings.* keys resolved at render in ManualTokenModal.
const MANUAL_HINT: Record<
  ManualChannel,
  { labelKey: string; tipKey: string }
> = {
  whatsapp: {
    labelKey: "settings.manualLabelWhatsapp",
    tipKey: "settings.manualTipWhatsapp",
  },
  messenger: {
    labelKey: "settings.manualLabelMessenger",
    tipKey: "settings.manualTipMessenger",
  },
  instagram: {
    labelKey: "settings.manualLabelInstagram",
    tipKey: "settings.manualTipInstagram",
  },
  fb_comment: {
    labelKey: "settings.manualLabelFbComment",
    tipKey: "settings.manualTipFbComment",
  },
  ig_comment: {
    labelKey: "settings.manualLabelIgComment",
    tipKey: "settings.manualTipIgComment",
  },
};

/** Cupo del WABA legible: TIER_1K → "1K". */
function tierLabel(tier?: string | null): string | null {
  if (!tier) return null;
  const map: Record<string, string> = {
    TIER_50: "50",
    TIER_250: "250",
    TIER_1K: "1K",
    TIER_10K: "10K",
    TIER_100K: "100K",
    TIER_UNLIMITED: "∞",
  };
  return map[tier] ?? tier.replace(/^TIER_/, "");
}

/**
 * Estado de entrega de WhatsApp para la tarjeta del canal. Muestra, en el
 * idioma del comercio y de forma minimalista, lo que Meta expone y Riverz antes
 * descartaba: puede-enviar (AVAILABLE/LIMITED/BLOCKED), cupo, calidad del número,
 * y una nota HONESTA sobre verificar el negocio (sube el cupo, no destraba la
 * entrega a números fríos). Sin snapshot todavía, no renderiza nada.
 */
function WhatsAppHealth({ connection }: { connection: ChannelConnection }) {
  const t = useT();
  const canSend = connection.health_can_send;
  const tier = tierLabel(connection.messaging_limit_tier);
  const quality = connection.quality_rating;
  if (!canSend && !tier && !quality) return null;

  const sendMeta =
    canSend === "AVAILABLE"
      ? { label: t("settings.healthAvailable"), dot: "bg-emerald-500" }
      : canSend === "LIMITED"
        ? { label: t("settings.healthLimited"), dot: "bg-amber-500" }
        : canSend === "BLOCKED"
          ? { label: t("settings.healthBlocked"), dot: "bg-red-500" }
          : null;

  const qualityDot =
    quality === "GREEN"
      ? "bg-emerald-500"
      : quality === "YELLOW"
        ? "bg-amber-500"
        : quality === "RED"
          ? "bg-red-500"
          : null;

  // Nota de verificación: si el número está LIMITED/BLOCKED, verificar el
  // negocio sube el cupo (pero NO destraba la entrega a fríos — honestidad).
  const showVerify = canSend === "LIMITED" || canSend === "BLOCKED";

  return (
    <div className="mt-1 pl-6 space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
        {sendMeta && (
          <span className="inline-flex items-center gap-1">
            <span className={cn("size-1.5 rounded-full", sendMeta.dot)} />
            {sendMeta.label}
          </span>
        )}
        {tier && <span>{t("settings.healthTier", { tier })}</span>}
        {qualityDot && (
          <span className="inline-flex items-center gap-1">
            <span className={cn("size-1.5 rounded-full", qualityDot)} />
            {t("settings.healthQuality")}
          </span>
        )}
      </div>
      {showVerify && (
        <a
          href="https://business.facebook.com/settings/security-center"
          target="_blank"
          rel="noopener noreferrer"
          title={t("settings.healthVerifyNote")}
          className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
        >
          <ShieldCheck className="size-3" />
          {t("settings.verifyBusiness")}
        </a>
      )}
    </div>
  );
}

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
      ? channelLabel("fb_comment", t)
      : channel === "ig_comment"
        ? channelLabel("ig_comment", t)
        : t(meta.labelKey);
  const [token, setToken] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!token.trim()) {
      toast.error(t("settings.pasteAToken"));
      return;
    }
    if (channel === "whatsapp" && (!phoneNumberId.trim() || !wabaId.trim())) {
      toast.error(t("settings.whatsappNeedsIds"));
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
        toast.error(json.error ?? t("settings.couldNotSaveToken"));
        return;
      }
      toast.success(t("settings.connectedLabel", { label: json.label ?? channel }));
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
              {t("settings.connectWithToken", { label: metaLabel })}
            </h3>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t(meta.tipKey)}</p>
          </div>
          <button
            onClick={onClose}
            className="-mr-1 -mt-1 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t("settings.close")}
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
            {t("settings.cancel")}
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving && <Loader2 className="size-3 animate-spin" />}
            {t("settings.saveAndConnect")}
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

/**
 * El pie que se agrega al final de cada correo que sale de ESTE buzón.
 *
 * Vacío por defecto y vacío significa "sin firma": el correo sale como salía.
 * No se inventa una con el nombre del negocio — firmar en nombre de alguien es
 * decisión suya, no nuestra.
 */
function FirmaDeCorreo({ connection }: { connection: ChannelConnection }) {
  const t = useT();
  const inicial = String(
    (connection.config as Record<string, unknown> | null)?.signature ?? "",
  );
  const [valor, setValor] = useState(inicial);
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    if (valor.trim() === inicial.trim()) return;
    setGuardando(true);
    try {
      const res = await fetch("/api/channels/firma", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connection_id: connection.id, signature: valor }),
      });
      if (!res.ok) throw new Error(String(res.status));
      toast.success(t("settings.signatureSaved"));
    } catch {
      toast.error(t("settings.signatureFailed"));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="mt-1 pl-6">
      <textarea
        className="w-full resize-y rounded-md border border-border bg-background px-2 py-1 text-[11px] leading-snug"
        rows={2}
        maxLength={400}
        value={valor}
        disabled={guardando}
        placeholder={t("settings.signaturePlaceholder")}
        onChange={(e) => setValor(e.target.value)}
        onBlur={guardar}
      />
    </div>
  );
}
