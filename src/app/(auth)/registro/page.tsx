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
import { CheckCircle, Eye, EyeOff } from "lucide-react";
import { sanitizePhoneForMeta, isValidE164 } from "@/lib/whatsapp/phone-utils";

function SignupForm() {
  const t = useT();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");
  const prefillEmail = searchParams.get("email");
  // Set by the Shopify OAuth callback when the merchant installed the app
  // from Shopify admin without having a Riverz account yet — the store is
  // parked and auto-connects right after this signup (dashboard claim).
  const pendingShop =
    searchParams.get("shopify") === "pending" ? searchParams.get("shop") : null;

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState(prefillEmail ?? "");
  const [emailLocked] = useState(Boolean(inviteToken && prefillEmail));
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  // Un solo campo de contraseña con ojo en vez de pedirla dos veces: se ve lo
  // que se escribió, que es lo que la confirmación intentaba lograr, y el
  // formulario queda con un campo menos justo donde más gente abandona.
  const [showPassword, setShowPassword] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError(t("auth.passwordMin6"));
      return;
    }

    // El teléfono es por dónde llega el aviso cuando el asistente necesita una
    // decisión. Uno que WhatsApp no pueda marcar deja esos avisos perdiéndose
    // en silencio, así que se valida acá y no después.
    const cleanPhone = sanitizePhoneForMeta(phone.trim());
    if (!isValidE164(cleanPhone)) {
      setError(t("auth.phoneInvalid"));
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
        phone: cleanPhone,
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
          {pendingShop && (
            <CardDescription className="text-muted-foreground">
              {t("auth.shopifyPendingNotice", { shop: pendingShop })}
            </CardDescription>
          )}
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
              <Label htmlFor="phone" className="text-foreground">
                {t("auth.phoneLabel")}
              </Label>
              <Input
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder={t("auth.phonePlaceholder")}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
              <p className="text-xs text-muted-foreground">{t("auth.phoneHint")}</p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password" className="text-foreground">
                {t("auth.passwordLabel")}
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder=""
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="border-border bg-muted pr-10 text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={
                    showPassword ? t("auth.hidePassword") : t("auth.showPassword")
                  }
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" aria-hidden />
                  ) : (
                    <Eye className="size-4" aria-hidden />
                  )}
                </button>
              </div>
            </div>

            {/* Sin htmlFor: la casilla vive DENTRO de la etiqueta. Con las dos
                cosas, el navegador dispara el clic en la casilla y ademas la
                etiqueta le reenvia otro, se anulan entre si y la casilla
                nunca queda marcada — nadie podia aceptar los terminos. */}
            <label className="flex items-start gap-2.5 text-sm text-muted-foreground">
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
