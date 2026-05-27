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
  Sparkles,
  Copy,
  ExternalLink,
  KeyRound,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/hooks/use-workspace";
import type { Channel, ChannelConnection } from "@/types";
import { CHANNEL_DISPLAY } from "@/lib/channels/display";
import { ChannelLogo } from "@/components/inbox/channel-logo";
import { cn } from "@/lib/utils";

const CHANNEL_DESCRIPTION: Record<Channel, string> = {
  whatsapp: "Mensajes 1-a-1 con tus clientes. Funciona con Coexistencia (escaneo de QR) o número nuevo.",
  instagram: "Recibe y responde DMs de Instagram desde la misma bandeja.",
  messenger: "Conversaciones directas de Facebook Messenger.",
  gmail: "Lee y responde correos como si fueran mensajes. Funciona con tu @gmail o Workspace.",
  outlook: "Bandeja para Outlook, Hotmail y Microsoft 365.",
  fb_comment: "Modera y responde comentarios de anuncios y posts en Facebook.",
  ig_comment: "Comentarios en posts orgánicos y anuncios de Instagram.",
};

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
    const { data } = await supabase
      .from("channel_connections")
      .select("*")
      .eq("workspace_id", workspace.id)
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

  const handleDisconnect = useCallback(
    async (id: string) => {
      if (!confirm("¿Desconectar este canal? El historial de conversaciones se conserva.")) return;
      const supabase = createClient();
      const { error } = await supabase
        .from("channel_connections")
        .update({ status: "disconnected" })
        .eq("id", id);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Canal desconectado");
      await fetchConnections();
    },
    [fetchConnections],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm("¿Eliminar esta conexión definitivamente? El historial de conversaciones se conserva.")) return;
      const supabase = createClient();
      const { error } = await supabase.from("channel_connections").delete().eq("id", id);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Conexión eliminada");
      await fetchConnections();
    },
    [fetchConnections],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-slate-500" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">
        No se encontró el workspace.
      </div>
    );
  }

  const channels = Object.values(CHANNEL_DISPLAY);
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
            <AlertCircle className="size-5 shrink-0 text-amber-400" />
            <div className="min-w-0 flex-1 space-y-2">
              <h3 className="text-sm font-semibold text-amber-200">
                Faltan apps OAuth por registrar
              </h3>
              <p className="text-xs leading-relaxed text-amber-100/80">
                Para que los botones <strong>Conectar</strong> funcionen necesitas registrar
                las apps de OAuth en cada proveedor (Meta para WhatsApp/IG/Messenger/FB,
                Google para Gmail, Microsoft para Outlook) y pegar sus claves en las
                variables de entorno de Render.
              </p>
              <ul className="space-y-1 text-xs text-amber-100/70">
                <li>
                  <span className={providers.meta ? "text-emerald-400" : "text-amber-300"}>
                    {providers.meta ? "✓" : "✗"}
                  </span>{" "}
                  <strong>Meta App</strong> — developers.facebook.com → My Apps → Create App
                  → Business. Variables: <code>META_APP_ID</code>, <code>META_APP_SECRET</code>
                </li>
                <li>
                  <span className={providers.google ? "text-emerald-400" : "text-amber-300"}>
                    {providers.google ? "✓" : "✗"}
                  </span>{" "}
                  <strong>Google OAuth Client</strong> — console.cloud.google.com →
                  APIs & Services → Credentials. Variables: <code>GOOGLE_CLIENT_ID</code>,
                  <code>GOOGLE_CLIENT_SECRET</code>
                </li>
                <li>
                  <span className={providers.microsoft ? "text-emerald-400" : "text-amber-300"}>
                    {providers.microsoft ? "✓" : "✗"}
                  </span>{" "}
                  <strong>Microsoft Azure App</strong> — portal.azure.com → App registrations
                  → New registration. Variables: <code>MICROSOFT_CLIENT_ID</code>,
                  <code>MICROSOFT_CLIENT_SECRET</code>
                </li>
              </ul>
              {providers.siteUrl && (
                <div className="mt-2 rounded-md bg-slate-950/50 p-2 text-xs">
                  <p className="mb-1 text-amber-200">
                    Redirect URIs a pegar en cada consola:
                  </p>
                  <div className="space-y-1 font-mono">
                    {(["meta", "google", "microsoft"] as const).map((p) => {
                      const url = `${providers.siteUrl}/api/connections/${p}/oauth/callback`;
                      return (
                        <div key={p} className="flex items-center justify-between gap-2">
                          <span className="truncate text-slate-300">{url}</span>
                          <button
                            onClick={() => copyToClipboard(url, p)}
                            className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
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

      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-primary/10 p-6">
        <div className="absolute -top-12 -right-12 size-48 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
              <Sparkles className="size-3.5" />
              Bandeja unificada
            </div>
            <h2 className="mt-1 text-xl font-bold text-white">Conecta tus canales</h2>
            <p className="mt-1 max-w-xl text-sm text-slate-300">
              WhatsApp, Instagram, Messenger, Gmail, Outlook y comentarios de anuncios — todo en
              una sola bandeja. Conexiones oficiales con un clic vía OAuth.
            </p>
          </div>
          <div className="hidden shrink-0 text-right sm:block">
            <p className="text-3xl font-bold text-white">{connectedCount}</p>
            <p className="text-xs text-slate-400">
              {connectedCount === 1 ? "canal activo" : "canales activos"}
            </p>
          </div>
        </div>
        {!isAdmin && (
          <p className="relative mt-3 text-xs text-slate-500">
            Solo lectura · los admins gestionan las conexiones.
          </p>
        )}
      </div>

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

      {/* Grid de canales */}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {channels.map((d) => {
          const list = connectionsByChannel.get(d.channel) ?? [];
          const anyConnected = list.some((c) => c.status === "connected");
          return (
            <li
              key={d.channel}
              className={cn(
                "group flex flex-col gap-3 overflow-hidden rounded-xl border bg-slate-900 p-4 transition-all",
                anyConnected
                  ? "border-emerald-500/40 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.1)]"
                  : "border-slate-800 hover:border-slate-700",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-3">
                  <div
                    className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white p-2 shadow-sm ring-1 ring-slate-800"
                  >
                    <ChannelLogo channel={d.channel} size={28} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{d.label}</p>
                    <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-400">
                      {CHANNEL_DESCRIPTION[d.channel]}
                    </p>
                  </div>
                </div>
              </div>

              {/* Connection rows */}
              {list.length > 0 && (
                <ul className="space-y-1">
                  {list.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center gap-2 rounded-md bg-slate-950/60 px-2 py-1.5 ring-1 ring-slate-800/50"
                    >
                      <StatusIcon status={c.status} />
                      <span className="flex-1 truncate text-xs text-slate-300">
                        {c.label ?? c.external_account_id ?? "Sin etiqueta"}
                      </span>
                      {isAdmin && (
                        <>
                          {c.status === "connected" && (
                            <button
                              onClick={() => handleDisconnect(c.id)}
                              title="Desconectar"
                              className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-amber-400"
                            >
                              <RefreshCcw className="size-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(c.id)}
                            title="Eliminar"
                            className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-red-400"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {/* CTA */}
              {isAdmin && (() => {
                const ready = isProviderReady(d.channel);
                const isMeta =
                  d.channel === "whatsapp" ||
                  d.channel === "messenger" ||
                  d.channel === "instagram" ||
                  d.channel === "fb_comment" ||
                  d.channel === "ig_comment";
                return (
                  <div className="mt-auto space-y-1.5">
                    <button
                      onClick={() => {
                        if (!ready) {
                          toast.error(
                            d.channel === "gmail"
                              ? "Configura Google Cloud OAuth Client primero (ver banner amarillo)"
                              : d.channel === "outlook"
                                ? "Configura Microsoft Azure App primero (ver banner amarillo)"
                                : "Configura la Meta App primero (ver banner amarillo)",
                          );
                          return;
                        }
                        // Meta apps with use-cases blocked the classic OAuth
                        // dialog, so the only reliable connect path for Meta
                        // channels is pasting a system-user / page token.
                        // Gmail and Outlook still use real OAuth.
                        if (isMeta) {
                          setManualOpen(d.channel as ManualChannel);
                          return;
                        }
                        handleConnect(d.channel);
                      }}
                      disabled={busy}
                      className={cn(
                        "flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        !ready
                          ? "cursor-not-allowed border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15"
                          : anyConnected
                            ? "border border-slate-700 bg-slate-800/50 text-slate-200 hover:bg-slate-800"
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
                          <ChannelLogo channel={d.channel} size={16} />
                          {anyConnected ? "Añadir otra cuenta" : "Conectar"}
                        </>
                      )}
                    </button>
                    {isMeta && ready && (
                      <p className="text-center text-[10px] leading-snug text-slate-500">
                        <KeyRound className="mr-1 inline-block size-2.5" />
                        Conexión via Page/System User token
                      </p>
                    )}
                  </div>
                );
              })()}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StatusIcon({ status }: { status: ChannelConnection["status"] }) {
  const classes = "size-3.5";
  if (status === "connected") return <CheckCircle2 className={cn(classes, "text-emerald-400")} />;
  if (status === "error") return <AlertCircle className={cn(classes, "text-red-400")} />;
  if (status === "pending") return <Loader2 className={cn(classes, "animate-spin text-amber-400")} />;
  return <XCircle className={cn(classes, "text-slate-500")} />;
}

const MANUAL_HINT: Record<ManualChannel, { label: string; tip: string }> = {
  whatsapp: {
    label: "WhatsApp",
    tip: "Pega un System User Token con whatsapp_business_messaging + whatsapp_business_management. Necesitas además el phone_number_id y waba_id.",
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
  const meta = MANUAL_HINT[channel];
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
      const res = await fetch("/api/connections/meta/manual", {
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
        className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white">
              Conectar {meta.label} con token
            </h3>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{meta.tip}</p>
          </div>
          <button
            onClick={onClose}
            className="-mr-1 -mt-1 rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-white"
            aria-label="Cerrar"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="block text-[11px] font-medium text-slate-300">
              Access token
            </span>
            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="EAA..."
              rows={4}
              className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 font-mono text-[11px] text-slate-100 placeholder:text-slate-600 focus:border-primary focus:outline-none"
            />
          </label>
          {channel === "whatsapp" && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[11px] font-medium text-slate-300">
                  phone_number_id
                </span>
                <input
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  placeholder="1166510229869969"
                  className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:border-primary focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] font-medium text-slate-300">
                  waba_id
                </span>
                <input
                  value={wabaId}
                  onChange={(e) => setWabaId(e.target.value)}
                  placeholder="2771752166515024"
                  className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:border-primary focus:outline-none"
                />
              </label>
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
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
