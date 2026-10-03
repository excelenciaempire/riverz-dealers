'use client';

import { Suspense, useState, useSyncExternalStore } from 'react';
import Link from '@/components/i18n/locale-link';
import { useSearchParams } from 'next/navigation';
import { useT } from '@/hooks/use-locale';
import { LEGAL_VERSION } from '@/lib/legal/version';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ARTE, MarcoAuth, TituloAuth } from '@/components/auth/marco';
import { CampoTelefono } from '@/components/ui/campo-telefono';
import { CheckCircle, Eye, EyeOff } from 'lucide-react';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';

const subscribeReferral = () => () => {};
const serverReferral = () => null;
const readReferralCookie = () =>
  document.cookie.match(
    /(?:^|;\s*)riverz_affiliate_ref=([A-Z0-9]{8})(?:;|$)/
  )?.[1] ?? null;

function SignupForm() {
  const t = useT();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get('invite');
  const savedReferral = useSyncExternalStore(
    subscribeReferral,
    readReferralCookie,
    serverReferral
  );
  const referralCode = searchParams.get('ref') ?? savedReferral;
  const prefillEmail = searchParams.get('email');
  // Set by the Shopify OAuth callback when the merchant installed the app
  // from Shopify admin without having a Riverz account yet — the store is
  // parked and auto-connects right after this signup (dashboard claim).

  // Quien llega instalando desde una tienda de aplicaciones, o invitado al
  // equipo de un comercio, ya trae su invitación: no se le pide código. El
  // servidor comprueba las dos cosas por su cuenta — esto sólo decide si el
  // campo se dibuja.

  const pideCodigo = !inviteToken && !referralCode;

  const [inviteCode, setInviteCode] = useState(
    searchParams.get('codigo') ?? searchParams.get('code') ?? ''
  );
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState(prefillEmail ?? '');
  const [emailLocked] = useState(Boolean(inviteToken && prefillEmail));
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
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
      setError(t('auth.passwordMin6'));
      return;
    }

    // El teléfono es por dónde llega el aviso cuando el asistente necesita una
    // decisión. Uno que WhatsApp no pueda marcar deja esos avisos perdiéndose
    // en silencio, así que se valida acá y no después.
    const cleanPhone = sanitizePhoneForMeta(phone.trim());
    if (!isValidE164(cleanPhone)) {
      setError(t('auth.phoneInvalid'));
      return;
    }

    if (!accepted) {
      setError(t('auth.mustAcceptTerms'));
      return;
    }

    setLoading(true);

    // When the user came in from an invite link, route them back to
    // the accept page after the email-confirmation callback so the
    // email-match gate can finalise membership.
    const nextPath = inviteToken
      ? `/invitacion/${encodeURIComponent(inviteToken)}`
      : '/panel';
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        full_name: fullName,
        phone: cleanPhone,
        accept_terms: accepted,
        terms_version: LEGAL_VERSION,
        invite_code: inviteCode.trim(),
        invite_token: inviteToken ?? undefined,
        referral_code: referralCode ?? undefined,
        redirect_to: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
      }),
    });
    const payload = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 429) {
        const retry = res.headers.get('Retry-After') ?? '60';
        setError(t('auth.tooManyAttempts', { retry }));
      } else {
        setError(payload.error ?? t('auth.signupError'));
      }
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <MarcoAuth arte={ARTE.llega}>
        <div className="bg-primary/10 mb-6 flex h-12 w-12 items-center justify-center rounded-xl">
          <CheckCircle className="text-accent-ink h-6 w-6" />
        </div>
        <TituloAuth
          titulo={t('auth.checkYourEmail')}
          bajada={
            <>
              {t('auth.signupInstructionsSent')}{' '}
              <span className="text-foreground">{email}</span>.
            </>
          }
        />
        <Link href="/ingresar">
          <Button
            variant="outline"
            className="border-border text-foreground hover:bg-accent hover:text-foreground w-full"
          >
            {t('auth.backToLogin')}
          </Button>
        </Link>
      </MarcoAuth>
    );
  }

  return (
    <MarcoAuth arte={ARTE.nace}>
      <TituloAuth
        titulo={t('auth.signupTitle')}

      />
      <form onSubmit={handleSignup} className="flex flex-col gap-4">
        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {pideCodigo && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="inviteCode" className="text-foreground">
              {t('auth.inviteCodeLabel')}
            </Label>
            <Input
              id="inviteCode"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              required
              className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20 font-mono tracking-[0.12em] uppercase placeholder:font-sans placeholder:tracking-normal"
            />
            <p className="text-muted-foreground text-xs">
              {t('auth.inviteCodeHint')}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="fullName" className="text-foreground">
            {t('auth.fullNameLabel')}
          </Label>
          <Input
            id="fullName"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="email" className="text-foreground">
            {t('auth.emailLabel')}
          </Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            readOnly={emailLocked}
            aria-readonly={emailLocked}
            className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
          />
          {emailLocked && (
            <p className="text-muted-foreground text-xs">
              {t('auth.inviteEmailLocked')}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="phone" className="text-foreground">
            {t('auth.phoneLabel')}
          </Label>
          <CampoTelefono
            id="phone"
            value={phone}
            onChange={setPhone}
            required
          />
          <p className="text-muted-foreground text-xs">{t('auth.phoneHint')}</p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="password" className="text-foreground">
            {t('auth.passwordLabel')}
          </Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20 pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={
                showPassword ? t('auth.hidePassword') : t('auth.showPassword')
              }
              className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex w-10 items-center justify-center"
            >
              {showPassword ? (
                <EyeOff className="size-4" aria-hidden />
              ) : (
                <Eye className="size-4" aria-hidden />
              )}
            </button>
          </div>
        </div>

        {/* Sin htmlFor: la casilla vive DENTRO de la etiqueta, asi que
                sobra — y hacia que un solo clic llegara duplicado. */}
        <label className="text-muted-foreground flex items-start gap-2.5 text-sm">
          <input
            id="accept"
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            required
            className="border-border accent-primary mt-0.5 h-5 w-5 shrink-0 rounded md:h-4 md:w-4"
          />
          <span>
            {t('auth.acceptPrefix')}{' '}
            <Link
              href="/terminos"
              target="_blank"
              className="text-accent-ink hover:text-accent-ink/80"
            >
              {t('auth.termsLink')}
            </Link>{' '}
            {t('auth.acceptAnd')}{' '}
            <Link
              href="/privacidad"
              target="_blank"
              className="text-accent-ink hover:text-accent-ink/80"
            >
              {t('auth.privacyLink')}
            </Link>
            .
          </span>
        </label>

        <Button
          type="submit"
          disabled={loading || !accepted}
          className="bg-primary text-primary-foreground hover:bg-primary/90 mt-2 h-10 w-full disabled:opacity-50"
        >
          {loading ? t('auth.creatingAccount') : t('auth.createAccount')}
        </Button>
      </form>

      <p className="text-muted-foreground mt-7 text-sm">
        {t('auth.haveAccount')}{' '}
        <Link href="/ingresar" className="text-accent-ink hover:underline">
          {t('auth.signInLink')}
        </Link>
      </p>
    </MarcoAuth>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}
