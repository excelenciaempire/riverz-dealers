"use client";

import { Suspense, useState } from "react";
import Link from "@/components/i18n/locale-link";
import { useSearchParams } from "next/navigation";
import { useT } from "@/hooks/use-locale";
import { LEGAL_VERSION } from "@/lib/legal/version";
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

function SignupForm() {
  const t = useT();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");
  const prefillEmail = searchParams.get("email");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState(prefillEmail ?? "");
  const [emailLocked] = useState(Boolean(inviteToken && prefillEmail));
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t("auth.passwordsDontMatch"));
      return;
    }

    if (password.length < 6) {
      setError(t("auth.passwordMin6"));
      return;
    }

    if (!accepted) {
      setError(t("auth.mustAcceptTerms"));
      return;
    }

    setLoading(true);

    // When the user came in from an invite link, route them back to
    // the accept page after the email-confirmation callback so the
    // email-match gate can finalise membership.
    const nextPath = inviteToken
      ? `/invitacion/${encodeURIComponent(inviteToken)}`
      : "/panel";
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        full_name: fullName,
        accept_terms: accepted,
        terms_version: LEGAL_VERSION,
        redirect_to: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
      }),
    });
    const payload = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 429) {
        const retry = res.headers.get("Retry-After") ?? "60";
        setError(t("auth.tooManyAttempts", { retry }));
      } else {
        setError(payload.error ?? t("auth.signupError"));
      }
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md border-border bg-card">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <CheckCircle className="h-6 w-6 text-accent-ink" />
            </div>
            <CardTitle className="text-xl text-foreground">
              {t("auth.checkYourEmail")}
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {t("auth.confirmationLinkSent")}{" "}
              <span className="text-foreground">{email}</span>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/ingresar">
              <Button
                variant="outline"
                className="w-full border-border text-foreground hover:bg-accent hover:text-foreground"
              >
                {t("auth.backToLogin")}
              </Button>
            </Link>
          </CardContent>
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
          <CardTitle className="text-xl text-foreground">{t("auth.signupTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignup} className="flex flex-col gap-4">
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="fullName" className="text-foreground">
                {t("auth.fullNameLabel")}
              </Label>
              <Input
                id="fullName"
                type="text"
                placeholder=""
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

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
                readOnly={emailLocked}
                aria-readonly={emailLocked}
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
              {emailLocked && (
                <p className="text-xs text-muted-foreground">
                  {t("auth.inviteEmailLocked")}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password" className="text-foreground">
                {t("auth.passwordLabel")}
              </Label>
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

            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmPassword" className="text-foreground">
                {t("auth.confirmPasswordLabel")}
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder=""
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <label
              htmlFor="accept"
              className="flex items-start gap-2.5 text-sm text-muted-foreground"
            >
              <input
                id="accept"
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                required
                className="mt-0.5 h-5 w-5 md:h-4 md:w-4 shrink-0 rounded border-border accent-primary"
              />
              <span>
                {t("auth.acceptPrefix")}{" "}
                <Link
                  href="/terminos"
                  target="_blank"
                  className="text-accent-ink hover:text-accent-ink/80"
                >
                  {t("auth.termsLink")}
                </Link>{" "}
                {t("auth.acceptAnd")}{" "}
                <Link
                  href="/privacidad"
                  target="_blank"
                  className="text-accent-ink hover:text-accent-ink/80"
                >
                  {t("auth.privacyLink")}
                </Link>
                .
              </span>
            </label>

            <Button
              type="submit"
              disabled={loading || !accepted}
              className="mt-2 h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? t("auth.creatingAccount") : t("auth.createAccount")}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {t("auth.haveAccount")}{" "}
            <Link
              href="/ingresar"
              className="text-accent-ink hover:text-accent-ink/80"
            >
              {t("auth.signInLink")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}
