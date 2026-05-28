"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, CheckCircle2, XCircle, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default function AcceptInvitePage({ params }: PageProps) {
  const { token } = use(params);
  const router = useRouter();
  const [state, setState] = useState<"loading" | "needs_login" | "ready" | "accepted" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    void (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setState("needs_login");
        return;
      }
      // Look up the invite to show the workspace name on the accept page.
      const { data: invite, error } = await supabase
        .from("workspace_invites")
        .select("workspace_id, email, role, expires_at, accepted_at, workspace:workspaces(name)")
        .eq("token", token)
        .maybeSingle();
      if (error || !invite) {
        setState("error");
        setErrorMsg("This invite is invalid or has already been used.");
        return;
      }
      if (invite.accepted_at) {
        setState("error");
        setErrorMsg("This invite has already been accepted.");
        return;
      }
      if (new Date(invite.expires_at).getTime() < Date.now()) {
        setState("error");
        setErrorMsg("This invite has expired. Ask your admin for a new one.");
        return;
      }
      const ws = Array.isArray(invite.workspace) ? invite.workspace[0] : invite.workspace;
      setWorkspaceName(ws?.name ?? "your team's workspace");
      setState("ready");
    })();
  }, [token]);

  const accept = async () => {
    setAccepting(true);
    const res = await fetch(`/api/workspace/accept-invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    setAccepting(false);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      toast.error(payload.error ?? "Failed to accept invite");
      return;
    }
    setState("accepted");
    setTimeout(() => router.replace("/inbox"), 1200);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8">
        {state === "loading" && (
          <div className="flex flex-col items-center gap-3 py-6">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading invite…</p>
          </div>
        )}

        {state === "needs_login" && (
          <div className="space-y-4 text-center">
            <Mail className="mx-auto h-8 w-8 text-accent-ink" />
            <h1 className="text-lg font-semibold text-foreground">You have an invite</h1>
            <p className="text-sm text-muted-foreground">
              Sign in first to accept this invitation. We'll bring you back to this page after.
            </p>
            <Link
              href={`/login?redirect=/invite/${token}`}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Sign in to continue
            </Link>
          </div>
        )}

        {state === "ready" && (
          <div className="space-y-4 text-center">
            <Mail className="mx-auto h-8 w-8 text-accent-ink" />
            <h1 className="text-lg font-semibold text-foreground">Join “{workspaceName}”</h1>
            <p className="text-sm text-muted-foreground">
              You've been invited to join this workspace. You'll share the inbox, contacts and channels with the team.
            </p>
            <Button
              onClick={accept}
              disabled={accepting}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {accepting ? <Loader2 className="size-4 animate-spin" /> : "Accept invite"}
            </Button>
          </div>
        )}

        {state === "accepted" && (
          <div className="space-y-3 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" />
            <h1 className="text-lg font-semibold text-foreground">You're in!</h1>
            <p className="text-sm text-muted-foreground">Redirecting to the inbox…</p>
          </div>
        )}

        {state === "error" && (
          <div className="space-y-3 text-center">
            <XCircle className="mx-auto h-8 w-8 text-red-400" />
            <h1 className="text-lg font-semibold text-foreground">Invite not valid</h1>
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
            >
              Back to dashboard
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
