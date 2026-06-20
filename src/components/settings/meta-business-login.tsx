"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { ChannelLogo } from "@/components/inbox/channel-logo";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";

/**
 * Facebook Login for Business launcher for Messenger / Instagram. Uses the
 * JS SDK FB.login with our login config_id — Facebook accepts config_id
 * through FB.login but REJECTS it on the bare server-side dialog/oauth
 * redirect ("config_id is required"), which is why the old redirect flow
 * failed. Mirrors the working WhatsApp Embedded Signup.
 *
 * Requires NEXT_PUBLIC_META_APP_ID + NEXT_PUBLIC_META_LOGIN_CONFIG_ID.
 */

declare global {
  interface Window {
    FB?: {
      init: (params: Record<string, unknown>) => void;
      login: (
        cb: (resp: { authResponse?: { code?: string }; status?: string }) => void,
        opts: Record<string, unknown>,
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

const APP_ID = process.env.NEXT_PUBLIC_META_APP_ID;
const CONFIG_ID = process.env.NEXT_PUBLIC_META_LOGIN_CONFIG_ID;

export function MetaBusinessLogin({
  workspaceId,
  channel,
  anyConnected,
  logoChannel,
  onConnected,
}: {
  workspaceId: string;
  /** "messenger" (Facebook card) or "instagram". */
  channel: "messenger" | "instagram";
  anyConnected: boolean;
  logoChannel: "messenger" | "instagram";
  onConnected: () => void;
}) {
  const [sdkReady, setSdkReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const fetchWithCsrf = useFetchWithCsrf();

  useEffect(() => {
    if (!APP_ID || !CONFIG_ID) return;
    if (window.FB) {
      setSdkReady(true);
      return;
    }
    // Chain (don't clobber) fbAsyncInit so multiple instances on the page
    // (Facebook + Instagram cards) each init. Then POLL window.FB as a
    // fallback: whichever instance's fbAsyncInit was last set wins the
    // callback, so without this the other instance's button would stay
    // permanently disabled.
    const prev = window.fbAsyncInit;
    window.fbAsyncInit = () => {
      prev?.();
      try {
        window.FB?.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: false, version: "v22.0" });
      } catch {
        /* init is idempotent; ignore double-init */
      }
      setSdkReady(true);
    };
    const id = "facebook-jssdk";
    if (!document.getElementById(id)) {
      const js = document.createElement("script");
      js.id = id;
      js.src = "https://connect.facebook.net/en_US/sdk.js";
      js.async = true;
      js.defer = true;
      document.body.appendChild(js);
    }
    const poll = setInterval(() => {
      if (window.FB) {
        setSdkReady(true);
        clearInterval(poll);
      }
    }, 300);
    return () => clearInterval(poll);
  }, []);

  const finish = useCallback(
    async (payload: { access_token?: string; code?: string }) => {
      setBusy(true);
      try {
        const r = await fetchWithCsrf("/api/connections/meta/sdk-connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, channel, workspace_id: workspaceId }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          toast.error(j.error || "No se pudo conectar");
          return;
        }
        toast.success(`Conectado: ${j.saved ?? 0} cuenta(s)`);
        onConnected();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error de red");
      } finally {
        setBusy(false);
      }
    },
    [workspaceId, channel, onConnected, fetchWithCsrf],
  );

  const launch = useCallback(() => {
    if (!window.FB || !CONFIG_ID) return;
    // Config de identificador de USUARIO → FB.login devuelve el token de
    // acceso directo en authResponse.accessToken (sin code-exchange, así no
    // hay redirect_uri que cuadrar — el code-exchange del SDK daba 400
    // error_subcode 36008). Si por config llegara un `code`, lo mandamos
    // igual y el server hace el canje como fallback.
    window.FB.login(
      (resp) => {
        // El tipo global de FB.login (compartido con WhatsApp ES) solo
        // declara `code`; en el flujo de token también viene accessToken.
        const ar = resp.authResponse as
          | { code?: string; accessToken?: string }
          | undefined;
        const token = ar?.accessToken;
        const code = ar?.code;
        if (token) void finish({ access_token: token });
        else if (code) void finish({ code });
        else toast.error("Conexión cancelada");
      },
      { config_id: CONFIG_ID },
    );
  }, [finish]);

  if (!APP_ID || !CONFIG_ID) return null;

  return (
    <button
      onClick={launch}
      disabled={!sdkReady || busy}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <ChannelLogo channel={logoChannel} size={16} />
      )}
      {anyConnected ? "Añadir otra cuenta" : "Conectar"}
    </button>
  );
}
