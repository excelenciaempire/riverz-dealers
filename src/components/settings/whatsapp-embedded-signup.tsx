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
  /**
   * Donde aterriza la conexion. 'workspace' es la de un comercio; 'platform'
   * es el numero de Riverz, que vive en los ajustes de plataforma y no en un
   * inquilino. El popup de Meta es exactamente el mismo — lo unico que cambia
   * es el endpoint que recibe el codigo.
   */
  target = 'workspace',
  label,
}: {
  workspaceId: string;
  onConnected: () => void;
  target?: 'workspace' | 'platform';
  label?: string;
}) {
  const [sdkReady, setSdkReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const fetchWithCsrf = useFetchWithCsrf();
  const t = useT();
  // Latched from the WA_EMBEDDED_SIGNUP message event — carries the
  // waba_id + phone_number_id Meta assigns during onboarding.
  const sessionInfo = useRef<{
    waba_id?: string;
    phone_number_id?: string;
    flujo?: "coexistencia" | "nuevo";
  }>({});

  // Load the Facebook JS SDK once.
  useEffect(() => {
    if (!APP_ID || !CONFIG_ID) return;
    if (window.FB) {
      setSdkReady(true);
      return;
    }
    window.fbAsyncInit = () => {
      // v25.0: MISMA versión que usa bitbybit. Es crítico para coexistencia:
      // con SDK viejo (v22) la pantalla de selección de WABA NO se reemplaza
      // por la de "conectar tu WhatsApp Business App existente", aunque se pase
      // featureType=whatsapp_business_app_onboarding. Sin ese reemplazo, el
      // número se onboardea por el flujo GENÉRICO (número nuevo / asset) en
      // vez de coexistencia pura, y queda en un estado que Meta bloquea con
      // 131031. Doc: developers.facebook.com/docs/whatsapp/embedded-signup/
      // custom-flows/onboarding-business-app-users — "if the WABA selection
      // screen has been replaced ... the feature is enabled".
      window.FB?.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: false, version: "v25.0" });
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
            // El servidor lo usa cuando Meta no dice si el número está en la
            // app: define si hay que registrarlo en Cloud API o no.
            flujo: data.event === "FINISH" ? "nuevo" : "coexistencia",
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
      const { waba_id, phone_number_id, flujo } = sessionInfo.current;
      if (!waba_id || !phone_number_id) {
        toast.error(t("settings.whatsappAccountNotReceived"));
        return;
      }
      setBusy(true);
      try {
        const endpoint =
          target === 'platform'
            ? "/api/admin/whatsapp/embedded-signup"
            : "/api/connections/whatsapp/embedded-signup";
        const r = await fetchWithCsrf(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, waba_id, phone_number_id, workspace_id: workspaceId, flujo }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          toast.error(j.error || t("settings.whatsappConnectError"));
          return;
        }
        // Tres desenlaces:
        //  - can_send=false → Meta rechazó/bloqueó el envío o falló /register.
        //    Es un aviso (la recepción sí funciona), no un error.
        //  - review_pending → conectado y YA puede enviar; Meta revisa el
        //    negocio en segundo plano (hasta 24 h). Mensaje positivo, no alarma.
        //  - resto → conectado y habilitado.
        if (target === 'platform') {
          toast.success(t("settings.whatsappConnectedLabel", { label: j.displayPhoneNumber ?? "" }));
        } else if (j.can_send === false) {
          toast.warning(t("settings.whatsappConnectedCannotSend"), {
            duration: 12000,
          });
        } else if (j.review_pending) {
          toast.success(t("settings.whatsappConnectedInReview"), {
            duration: 10000,
          });
        } else {
          toast.success(
            j.coexistence
              ? t("settings.whatsappConnectedCoexistence", { label: j.label })
              : t("settings.whatsappConnectedLabel", { label: j.label }),
          );
        }
        onConnected();
      } catch (err) {
        toast.error(t("settings.networkError"));
      } finally {
        setBusy(false);
      }
    },
    [workspaceId, onConnected, fetchWithCsrf, t, target],
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
        // 'coexistence') opens Meta's "Select your setup" screen, which offers
        // BOTH "connect my existing WhatsApp Business app" (coexistence, QR
        // linking) AND "start with a new number" — one entry point, both paths.
        extras: {
          setup: {},
          featureType: "whatsapp_business_app_onboarding",
          sessionInfoVersion: "3",
        },
      },
    );
  }, [finish, t]);

  // Without the env config we can't launch the popup — render nothing
  // so the parent falls back to the manual-paste connect button.
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
        <ChannelLogo channel="whatsapp" size={16} />
      )}
      {label ?? t("settings.connectWhatsapp")}
    </button>
  );
}
