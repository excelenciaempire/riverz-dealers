"use client";

import { useEffect, useState } from "react";
import { useLocalizedRouter } from "@/hooks/use-localized-router";
import { Mail, CheckCircle, Loader2 } from "lucide-react";
import { useT } from "@/hooks/use-locale";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function VerifyEmailPage() {
  const t = useT();
  const router = useLocalizedRouter();
  const supabase = createClient();
  const [email, setEmail] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        router.replace("/ingresar");
        return;
      }
      if (user.email_confirmed_at || user.confirmed_at) {
        setConfirmed(true);
        setTimeout(() => router.replace("/panel"), 600);
        return;
      }
      setEmail(user.email ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, supabase]);

  const handleResend = async () => {
    if (!email) return;
    setSending(true);
    setError(null);
    const { error: rErr } = await supabase.auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/panel`,
      },
    });
    setSending(false);
    if (rErr) {
      setError(rErr.message);
      return;
    }
    setSent(true);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/ingresar";
  };

  if (confirmed) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md border-border bg-card">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <CheckCircle className="h-6 w-6 text-accent-ink" />
            </div>
            <CardTitle className="text-xl text-foreground">
              {t("auth.emailVerified")}
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {t("auth.redirectingToDashboard")}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Mail className="h-6 w-6 text-accent-ink" />
          </div>
          <CardTitle className="text-xl text-foreground">
            {t("auth.verifyEmailTitle")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("auth.verifyEmailDescription")}{" "}
            <span className="text-foreground">{email ?? t("auth.yourEmailFallback")}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
          {sent && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400">
              {t("auth.linkResent")}
            </div>
          )}
          <Button
            onClick={handleResend}
            disabled={sending || !email}
            className="h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              t("auth.resendLink")
            )}
          </Button>
          <Button
            onClick={handleSignOut}
            variant="outline"
            className="h-10 w-full border-border text-foreground hover:bg-accent hover:text-foreground"
          >
            {t("auth.signOut")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
