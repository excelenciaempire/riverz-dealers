"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { ChannelLogo } from "@/components/inbox/channel-logo";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import { useT } from "@/hooks/use-locale";

/**
 * WhatsApp Embedded Signup launcher. Opens Meta's official onboarding
 * popup (the two-option screen: "Connect your existing WhatsApp Business
 * app" = Coexistence, or "Start with a new number"). Meta renders that
 * UI; we just launch FB.login with our config and process the result.
 *
 * Requires:
 *   - NEXT_PUBLIC_META_APP_ID
 *   - NEXT_PUBLIC_META_ES_CONFIG_ID  (Embedded Signup configuration id,
 *     created in App Dashboard → WhatsApp → Configuration, with the
 *     Coexistence feature enabled)
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
const CONFIG_ID = process.env.NEXT_PUBLIC_META_ES_CONFIG_ID;

export function WhatsAppEmbeddedSignup({
  workspaceId,
  onConnected,
  mode = "default",
}: {
  workspaceId: string;
  onConnected: () => void;
  /** "coexistence" forces Meta's "connect my existing WhatsApp Business app"
   *  (QR-linking) onboarding instead of the default new-number flow. */
  mode?: "default" | "coexistence";
}) {
  const [sdkReady, setSdkReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const fetchWithCsrf = useFetchWithCsrf();
  const t = useT();
  // Latched from the WA_EMBEDDED_SIGNUP message event — carries the
  // waba_id + phone_number_id Meta assigns during onboarding.
  const sessionInfo = useRef<{ waba_id?: string; phone_number_id?: string }>({});

  // Load the Facebook JS SDK once.
  useEffect(() => {
    if (!APP_ID || !CONFIG_ID) return;
    if (window.FB) {
      setSdkReady(true);
      return;
    }
    window.fbAsyncInit = () => {
      window.FB?.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: false, version: "v22.0" });
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
  }, []);

  // Capture the embedded-signup session info (waba/phone ids).
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (!event.origin.endsWith("facebook.com")) return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        // "FINISH" = default new-number flow; "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"
        // = coexistence (the merchant kept their WhatsApp Business app). Both carry
        // the waba_id + phone_number_id we need.
        if (
          data?.type === "WA_EMBEDDED_SIGNUP" &&
          (data?.event === "FINISH" ||
            data?.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING")
        ) {
          sessionInfo.current = {
            waba_id: data.data?.waba_id,
            phone_number_id: data.data?.phone_number_id,
          };
        }
      } catch {
        // non-JSON postMessage, ignore
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const finish = useCallback(
    async (code: string) => {
      const { waba_id, phone_number_id } = sessionInfo.current;
      if (!waba_id || !phone_number_id) {
        toast.error(t("settings.whatsappAccountNotReceived"));
        return;
      }
      setBusy(true);
      try {
        const r = await fetchWithCsrf("/api/connections/whatsapp/embedded-signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, waba_id, phone_number_id, workspace_id: workspaceId }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          toast.error(j.error || t("settings.whatsappConnectError"));
          return;
        }
        toast.success(
          j.coexistence
            ? t("settings.whatsappConnectedCoexistence", { label: j.label })
            : t("settings.whatsappConnectedLabel", { label: j.label }),
        );
        onConnected();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("settings.networkError"));
      } finally {
        setBusy(false);
      }
    },
    [workspaceId, onConnected, fetchWithCsrf, t],
  );

  const launch = useCallback(() => {
    if (!window.FB || !CONFIG_ID) return;
    sessionInfo.current = {};
    window.FB.login(
      (resp) => {
        const code = resp.authResponse?.code;
        if (code) void finish(code);
        else toast.error(t("settings.whatsappOnboardingCancelled"));
      },
      {
        config_id: CONFIG_ID,
        response_type: "code",
        override_default_response_type: true,
        // featureType 'whatsapp_business_app_onboarding' (v3 name; was
        // 'coexistence') switches the popup to the QR-linking flow that keeps
        // the merchant's WhatsApp Business app working alongside the API.
        extras:
          mode === "coexistence"
            ? {
                setup: {},
                featureType: "whatsapp_business_app_onboarding",
                sessionInfoVersion: "3",
              }
            : { setup: {}, sessionInfoVersion: "3" },
      },
    );
  }, [finish, t, mode]);

  // Without the env config we can't launch the popup — render nothing
  // so the parent falls back to the manual-paste connect button.
  if (!APP_ID || !CONFIG_ID) return null;

  const coexistence = mode === "coexistence";
  return (
    <button
      onClick={launch}
      disabled={!sdkReady || busy}
      className={
        coexistence
          ? "flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-transparent px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
          : "flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
      }
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <ChannelLogo channel="whatsapp" size={16} />
      )}
      {coexistence
        ? t("settings.connectWhatsappCoexistence")
        : t("settings.connectWhatsappNewNumber")}
    </button>
  );
}
