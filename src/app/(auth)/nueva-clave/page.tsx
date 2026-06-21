"use client";

import { useEffect, useState } from "react";
import { useLocalizedRouter } from "@/hooks/use-localized-router";
import Link from "@/components/i18n/locale-link";
import { useT } from "@/hooks/use-locale";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CheckCircle } from "lucide-react";

export default function NewPasswordPage() {
  const t = useT();
  const router = useLocalizedRouter();
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Legacy implicit flow lands here with `#access_token=...&type=recovery`
    // in the URL fragment. supabase-js parses that automatically on the
    // first `getSession()` call and sets the recovery session; we just
    // need to wait for it before showing the form.
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        // PKCE flow exchange happens in /auth/callback, so by the time
        // the user lands here a session should already exist. If not,
        // the link probably expired.
        setError(t("auth.linkExpired"));
      }
      setReady(true);
    })();
  }, [supabase, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError(t("auth.passwordMin8"));
      return;
    }
    if (password !== confirm) {
      setError(t("auth.passwordsDontMatch"));
      return;
    }

    setLoading(true);
    const { error: updErr } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updErr) {
      setError(updErr.message);
      return;
    }
    setDone(true);
    setTimeout(() => router.push("/panel"), 1500);
  };

  if (done) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md border-border bg-card">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <CheckCircle className="h-6 w-6 text-accent-ink" />
            </div>
            <CardTitle className="text-xl text-foreground">
              {t("auth.passwordUpdated")}
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
          <span className="mb-3 text-[26px] font-semibold lowercase leading-none tracking-[0.04em] text-accent-ink">
            riverz
          </span>
          <CardTitle className="text-xl text-foreground">
            {t("auth.newPasswordTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="password" className="text-foreground">
                {t("auth.newPasswordLabel")}
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                disabled={!ready}
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="confirm" className="text-foreground">
                {t("auth.confirmPasswordLabel")}
              </Label>
              <Input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
                disabled={!ready}
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <Button
              type="submit"
              disabled={loading || !ready}
              className="mt-2 h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? t("auth.saving") : t("auth.savePassword")}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            <Link
              href="/ingresar"
              className="text-accent-ink hover:text-accent-ink/80"
            >
              {t("auth.backToLogin")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
