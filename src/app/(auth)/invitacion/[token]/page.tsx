"use client";

import { use, useEffect, useState } from "react";
import { useLocalizedRouter } from "@/hooks/use-localized-router";
import Link from "@/components/i18n/locale-link";
import { Loader2, CheckCircle2, XCircle, Mail } from "lucide-react";
import { useT } from "@/hooks/use-locale";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default function AcceptInvitePage({ params }: PageProps) {
  const { token } = use(params);
  const t = useT();
  const router = useLocalizedRouter();
  const [state, setState] = useState<"loading" | "ready" | "accepted" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    void (async () => {
      const supabase = createClient();
      // Look up the invite first so we can prefill the signup email if
      // the visitor is not yet signed in.
      const { data: invite, error } = await supabase
        .from("workspace_invites")
        .select("workspace_id, email, role, expires_at, accepted_at, workspace:workspaces(name)")
        .eq("token", token)
        .maybeSingle();
      if (error || !invite) {
        setState("error");
        setErrorMsg(t("auth.inviteInvalid"));
        return;
      }
      if (invite.accepted_at) {
        setState("error");
        setErrorMsg(t("auth.inviteAlreadyUsed"));
        return;
      }
      if (new Date(invite.expires_at).getTime() < Date.now()) {
        setState("error");
        setErrorMsg(t("auth.inviteExpired"));
        return;
      }

      const ws = Array.isArray(invite.workspace) ? invite.workspace[0] : invite.workspace;
      setWorkspaceName(ws?.name ?? t("auth.yourTeamFallback"));
      setInviteEmail(invite.email ?? "");

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        // Not signed in: push them to registro with the invited email
        // prefilled. After signup + email verification the auth
        // callback brings them back here to accept.
        const params = new URLSearchParams({
          invite: token,
          email: invite.email ?? "",
        });
        router.replace(`/registro?${params.toString()}`);
        return;
      }
      setState("ready");
    })();
  }, [token, router, t]);

  const accept = async () => {
    setAccepting(true);
    // Seed the csrf cookie before the POST — this page lives outside the
    // dashboard CsrfProvider, so we ask the server for a token inline,
    // then read it back from document.cookie on the next request.
    const tokenRes = await fetch("/api/csrf", {
      credentials: "same-origin",
      cache: "no-store",
    });
    const csrfToken = ((await tokenRes.json().catch(() => null)) as
      | { token?: string }
      | null)?.token;
    const res = await fetch(`/api/workspace/accept-invite`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
      },
      body: JSON.stringify({ token }),
    });
    setAccepting(false);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      const msg = payload.error ?? t("auth.acceptInviteError");
      toast.error(msg);
      setState("error");
      setErrorMsg(msg);
      return;
    }
    toast.success(t("auth.inviteAccepted"));
    setState("accepted");
    setTimeout(() => router.replace("/bandeja"), 1200);
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8">
        {state === "loading" && (
          <div className="flex flex-col items-center gap-3 py-6">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t("auth.loadingInvite")}</p>
          </div>
        )}

        {state === "ready" && (
          <div className="space-y-4 text-center">
            <Mail className="mx-auto h-8 w-8 text-accent-ink" />
            <h1 className="text-lg font-semibold text-foreground">{t("auth.joinWorkspace", { name: workspaceName })}</h1>
            {inviteEmail && (
              <p className="text-sm text-muted-foreground">
                {t("auth.inviteForPrefix")} <span className="text-foreground">{inviteEmail}</span>.
              </p>
            )}
            <Button
              onClick={accept}
              disabled={accepting}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {accepting ? <Loader2 className="size-4 animate-spin" /> : t("auth.acceptInvite")}
            </Button>
          </div>
        )}

        {state === "accepted" && (
          <div className="space-y-3 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-700 dark:text-emerald-400" />
            <h1 className="text-lg font-semibold text-foreground">{t("auth.inviteAcceptedTitle")}</h1>
            <p className="text-sm text-muted-foreground">{t("auth.takingYouToInbox")}</p>
          </div>
        )}

        {state === "error" && (
          <div className="space-y-3 text-center">
            <XCircle className="mx-auto h-8 w-8 text-red-600 dark:text-red-400" />
            <h1 className="text-lg font-semibold text-foreground">{t("auth.inviteInvalidTitle")}</h1>
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
            <Link
              href="/panel"
              className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
            >
              {t("auth.backToDashboard")}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
