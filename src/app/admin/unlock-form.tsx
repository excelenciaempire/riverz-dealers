'use client';

import { useT } from '@/hooks/use-locale';

import { useEffect, useState } from 'react';
import { Loader2, Lock } from 'lucide-react';

/**
 * Pantalla de la segunda llave. No dice qué hay del otro lado ni quién es el
 * usuario: si alguien llegó hasta acá sin la contraseña, no se lleva ni un
 * dato más de los que ya tenía.
 */
export function UnlockForm({ configured }: { configured: boolean }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [csrf, setCsrf] = useState<string | null>(null);

  /**
   * El token CSRF se pide acá y no se toma del provider: esta pantalla es lo
   * PRIMERO que ve el navegador en admin.riverz.co, un origen donde todavía no
   * hay ninguna cookie nuestra. Sin esto, el primer intento moría con
   * `csrf_mismatch` y había que recargar para poder entrar.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/csrf', { cache: 'no-store' });
        const json = (await res.json()) as { token?: string };
        if (!cancelled && json.token) setCsrf(json.token);
      } catch {
        /* sin token el envío falla y lo dice */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const t = useT();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/unlock', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(json?.error ?? t('admin.unlockFailed'));
        return;
      }
      window.location.reload();
    } catch {
      setError(t('admin.unlockNetwork'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6"
      >
        <div className="flex items-center gap-2">
          <Lock className="size-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold text-foreground">{t('admin.unlockTitle')}</h1>
        </div>

        {configured ? (
          <>
            <input
              type="password"
              autoFocus
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('admin.unlockPlaceholder')}
              className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={busy || !password.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t('admin.unlockSubmit')}
            </button>
          </>
        ) : (
          <p className="text-xs leading-snug text-muted-foreground">
            {t('admin.unlockNotConfigured')}
          </p>
        )}
      </form>
    </div>
  );
}
