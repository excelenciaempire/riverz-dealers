"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { ChannelLogo } from "@/components/inbox/channel-logo";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import { useT } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  const t = useT();

  // Held between the discovery (list_only) call and the persist call so the
  // picker can connect the chosen accounts without re-running FB.login.
  const [cred, setCred] = useState<{ access_token?: string; code?: string } | null>(null);
  const [accounts, setAccounts] = useState<{ id: string; label: string }[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);

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

  // Persist the chosen accounts. `pageIds` empty/absent = let the server
  // decide (single-account fast path passes the one id explicitly).
  const persist = useCallback(
    async (payload: { access_token?: string; code?: string }, pageIds: string[]) => {
      setBusy(true);
      try {
        const r = await fetchWithCsrf("/api/connections/meta/sdk-connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            channel,
            workspace_id: workspaceId,
            page_ids: pageIds,
          }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          toast.error(j.error || t("settings.metaConnectError"));
          return;
        }
        toast.success(t("settings.metaConnectedAccounts", { n: j.saved ?? 0 }));
        setPickerOpen(false);
        setCred(null);
        onConnected();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("settings.networkError"));
      } finally {
        setBusy(false);
      }
    },
    [workspaceId, channel, onConnected, fetchWithCsrf, t],
  );

  // Step 1: discover the accounts the token can manage (no persistence).
  // 0 → error · 1 → connect it directly · >1 → open the picker.
  const discover = useCallback(
    async (payload: { access_token?: string; code?: string }) => {
      setBusy(true);
      try {
        const r = await fetchWithCsrf("/api/connections/meta/sdk-connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            channel,
            workspace_id: workspaceId,
            list_only: true,
          }),
        });
        const j = (await r.json().catch(() => ({}))) as {
          accounts?: { id: string; label: string }[];
          error?: string;
        };
        if (!r.ok) {
          toast.error(j.error || t("settings.metaConnectError"));
          return;
        }
        const found = j.accounts ?? [];
        if (found.length === 0) {
          toast.error(t("settings.metaNoAccounts"));
          return;
        }
        if (found.length === 1) {
          await persist(payload, [found[0].id]);
          return;
        }
        setCred(payload);
        setAccounts(found);
        setChecked(new Set(found.map((a) => a.id)));
        setPickerOpen(true);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("settings.networkError"));
      } finally {
        setBusy(false);
      }
    },
    [workspaceId, channel, fetchWithCsrf, persist, t],
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
        if (token) void discover({ access_token: token });
        else if (code) void discover({ code });
        else toast.error(t("settings.metaConnectionCancelled"));
      },
      { config_id: CONFIG_ID },
    );
  }, [discover, t]);

  if (!APP_ID || !CONFIG_ID) return null;

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
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
        {anyConnected ? t("settings.addAnotherAccount") : t("common.connect")}
      </button>

      <Dialog
        open={pickerOpen}
        onOpenChange={(o) => {
          // Don't drop the held credential mid-request; only reset on close.
          setPickerOpen(o);
          if (!o) setCred(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("settings.chooseAccountsToConnect")}</DialogTitle>
          </DialogHeader>

          <ul className="-mx-1 flex max-h-72 flex-col gap-1 overflow-y-auto">
            {accounts.map((a) => (
              <li key={a.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={checked.has(a.id)}
                    onChange={() => toggle(a.id)}
                  />
                  <span className="flex items-center gap-2 text-sm">
                    <ChannelLogo channel={logoChannel} size={16} />
                    {a.label}
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <DialogFooter showCloseButton>
            <Button
              onClick={() => cred && void persist(cred, [...checked])}
              disabled={busy || checked.size === 0}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t("settings.connectSelected", { n: checked.size })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
