'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import Link from '@/components/i18n/locale-link';
import { useT } from '@/hooks/use-locale';
import { signupsOpen } from '@/lib/auth/signups';
import { safeNextPath } from '@/lib/auth/redirect';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ARTE, MarcoAuth, TituloAuth } from '@/components/auth/marco';

export default function LoginPage() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok || payload.ok !== true) {
        if (res.status === 429) {
          const retry = res.headers.get('Retry-After') ?? '60';
          setError(t('auth.tooManyAttempts', { retry }));
        } else {
          // `error` is an internal code; use the server's localized message.
          setError(payload.message ?? t('auth.loginError'));
        }
        return;
      }

      // Hard navigation so the browser picks up the freshly set session
      // cookies and the dashboard hydrates with a logged-in user.
      window.location.href = safeNextPath(new URLSearchParams(window.location.search).get('next'));
    } catch {
      setError(t('auth.loginConnectionError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <MarcoAuth arte={ARTE.plena}>
      <TituloAuth titulo={t('auth.loginTitle')} />
      <form onSubmit={handleLogin} className="flex flex-col gap-4">
        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

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
            className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-foreground">
              {t('auth.passwordLabel')}
            </Label>
            <Link
              href="/recuperar-clave"
              className="text-accent-ink hover:text-accent-ink/80 text-sm"
            >
              {t('auth.forgotPassword')}
            </Link>
          </div>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="border-border bg-muted pr-10 text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
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

        <Button
          type="submit"
          disabled={loading}
          className="bg-primary text-primary-foreground hover:bg-primary/90 mt-2 h-10 w-full disabled:opacity-50"
        >
          {loading ? t('auth.signingIn') : t('auth.signIn')}
        </Button>
      </form>

      {/* Pre-launch: sign-ups are closed, so no "create account" link. */}
      {signupsOpen() && (
        <p className="text-muted-foreground mt-7 text-sm">
          {t('auth.noAccount')}{' '}
          <Link href="/crear" className="text-accent-ink hover:underline">
            {t('auth.createAccount')}
          </Link>
        </p>
      )}
    </MarcoAuth>
  );
}
