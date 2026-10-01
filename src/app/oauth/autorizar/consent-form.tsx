'use client';

import { useState } from 'react';
import { KeyRound, Loader2, Check, X } from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import { Button } from '@/components/ui/button';

/**
 * El botón que concede el acceso.
 *
 * Dice qué va a poder hacer el programa ANTES de los botones, y en dos líneas:
 * leer siempre, escribir sólo si lo pidió. La diferencia importa —una es
 * consultar, la otra le escribe a un cliente real— y esconderla detrás de un
 * "autorizar" genérico es cómo se consiguen permisos que nadie recuerda haber
 * dado.
 *
 * Rechazar también avisa al cliente, con el error que el spec espera. Cerrar la
 * pestaña lo dejaría colgado esperando.
 */
export function ConsentForm({
  clientName,
  workspaceName,
  userEmail,
  restricted,
  escribe,
  params,
}: {
  clientName: string;
  workspaceName: string;
  userEmail: string;
  restricted: boolean;
  escribe: boolean;
  params: Record<string, string>;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const autorizar = async () => {
    setBusy(true);
    setError(null);
    try {
      const csrf = await fetch('/api/csrf').then((r) => r.json());
      const res = await fetch('/api/oauth/authorize', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf?.token ? { 'x-csrf-token': csrf.token } : {}),
        },
        body: JSON.stringify(params),
      });
      const json = await res.json();
      if (!res.ok || !json.redirect_to) {
        setError(t('oauth.failed'));
        setBusy(false);
        return;
      }
      window.location.href = json.redirect_to as string;
    } catch {
      setError(t('oauth.failed'));
      setBusy(false);
    }
  };

  const rechazar = () => {
    const url = new URL(params.redirect_uri);
    url.searchParams.set('error', 'access_denied');
    if (params.state) url.searchParams.set('state', params.state);
    window.location.href = url.toString();
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-5 rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-muted-foreground" />
          <span className="text-[18px] font-semibold lowercase tracking-[0.04em] text-accent-ink">
            riverz
          </span>
        </div>

        <div className="space-y-1">
          <h1 className="text-base font-semibold text-foreground">
            {t('oauth.title', { client: clientName })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('oauth.onAccount', { workspace: workspaceName })}
          </p>
          <p className="text-sm text-muted-foreground">{userEmail}</p>
        </div>

        <ul className="space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <li className="flex items-start gap-2">
            <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span className="text-foreground">{t(restricted ? 'oauth.restrictedRead' : 'oauth.canRead')}</span>
          </li>
          <li className="flex items-start gap-2">
            {escribe ? (
              <Check className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            ) : (
              <X className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className={escribe ? 'text-foreground' : 'text-muted-foreground'}>
              {t(escribe ? 'oauth.canWrite' : 'oauth.cannotWrite')}
            </span>
          </li>
        </ul>

        <p className="text-xs text-muted-foreground">{t('oauth.revokeHint')}</p>
        <p className="text-xs text-muted-foreground">{t('oauth.teamPermissions')}</p>

        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={rechazar} disabled={busy}>
            {t('oauth.deny')}
          </Button>
          <Button className="flex-1" onClick={autorizar} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : t('oauth.allow')}
          </Button>
        </div>
      </div>
    </div>
  );
}
