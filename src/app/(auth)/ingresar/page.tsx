"use client";

import { useState } from "react";
import Link from "@/components/i18n/locale-link";
import { useT } from "@/hooks/use-locale";
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

export default function LoginPage() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const payload = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 429) {
        const retry = res.headers.get("Retry-After") ?? "60";
        setError(t("auth.tooManyAttempts", { retry }));
      } else {
        setError(payload.error ?? t("auth.loginError"));
      }
      setLoading(false);
      return;
    }

    // Hard navigation so the browser picks up the freshly set session
    // cookies and the dashboard hydrates with a logged-in user.
    window.location.href = "/panel";
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <span className="mb-3 text-[26px] font-semibold lowercase leading-none tracking-[0.04em] text-accent-ink">
            riverz
          </span>
          <CardTitle className="text-xl text-foreground">{t("auth.loginTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="email" className="text-foreground">
                {t("auth.emailLabel")}
              </Label>
              <Input
                id="email"
                type="email"
                placeholder={t("auth.emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-foreground">
                  {t("auth.passwordLabel")}
                </Label>
                <Link
                  href="/recuperar-clave"
                  className="text-sm text-accent-ink hover:text-accent-ink/80"
                >
                  {t("auth.forgotPassword")}
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                placeholder=""
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="mt-2 h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? t("auth.signingIn") : t("auth.signIn")}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {t("auth.noAccount")}{" "}
            <Link
              href="/registro"
              className="text-accent-ink hover:text-accent-ink/80"
            >
              {t("auth.createAccount")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
