'use client';

import { useState } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';
import { useT } from '@/hooks/use-locale';

/**
 * Pantalla completa cuando se acabaron las 48 horas y el cobro sigue sin
 * entrar.
 *
 * Es distinta de la suspensión que aplica el equipo: esto lo resuelve el
 * comercio solo, en un minuto, con una tarjeta.
 *
 * El botón lleva DIRECTO a Stripe y no a Ajustes a propósito: esta pantalla
 * tapa toda la aplicación, así que mandarlo a una pantalla de adentro sería
 * mandarlo contra esta misma pared. Pide el checkout acá y sale.
 *
 * No cierra la sesión: en cuanto Stripe confirme, la cuenta vuelve sola.
 */
export function ImpagoGate() {
  const t = useT();
  const [yendo, setYendo] = useState(false);
  const [error, setError] = useState(false);

  const pagar = async () => {
    setYendo(true);
    setError(false);
    try {
      // Lee la cookie del doble envío directo: este componente vive FUERA del
      // shell, así que no tiene el proveedor de CSRF arriba.
      const csrf =
        document.cookie
          .split(';')
          .map((p) => p.trim().split('='))
          .find(([k]) => k === 'csrf')?.[1] ?? '';
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as { url?: string };
      if (json.url) window.location.href = json.url;
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setYendo(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background px-5">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-muted">
          <CreditCard className="size-5 text-muted-foreground" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-foreground">
          {t('settings.impagoTitle')}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t('settings.impagoBody')}
        </p>
        <button
          type="button"
          onClick={() => void pagar()}
          disabled={yendo}
          className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {yendo && <Loader2 className="size-4 animate-spin" />}
          {t('settings.impagoCta')}
        </button>
        {error && (
          <p className="mt-3 text-sm text-destructive">{t('settings.impagoError')}</p>
        )}
      </div>
    </div>
  );
}
