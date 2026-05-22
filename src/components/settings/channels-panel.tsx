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

export function ChannelsPanel() {
  const { workspace, isAdmin, loading } = useWorkspace();
  const [connections, setConnections] = useState<ChannelConnection[]>([]);
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="space-y-4">
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
              {isAdmin && (
                <button
                  onClick={() => handleConnect(d.channel)}
                  disabled={busy}
                  className={cn(
                    "mt-auto flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    anyConnected
                      ? "border border-slate-700 bg-slate-800/50 text-slate-200 hover:bg-slate-800"
                      : "bg-primary text-primary-foreground hover:bg-primary/90",
                  )}
                >
                  <ChannelLogo channel={d.channel} size={16} />
                  {anyConnected ? "Añadir otra cuenta" : "Conectar"}
                </button>
              )}
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
