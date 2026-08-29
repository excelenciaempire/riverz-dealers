'use client';

import { useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import Link from '@/components/i18n/locale-link';
import { useT } from '@/hooks/use-locale';

/**
 * El cartel que aparece cuando alguien pide algo de IA y no hay saldo.
 *
 * Lo automático se calla sin decir nada: no hay nadie mirando, y el cliente del
 * comercio no tiene por qué enterarse de que su proveedor se quedó sin saldo.
 * Pero cuando una persona aprieta un botón y no pasa nada, esa persona merece
 * saber por qué y qué hacer — si no, prueba otra vez, y otra, y termina
 * escribiendo para preguntar si la app está rota.
 *
 * Escucha un evento y no un contexto a propósito: lo dispara el envoltorio de
 * `fetch` por el que ya pasan todas las acciones que gastan IA, así que ninguna
 * pantalla nueva tiene que acordarse de nada.
 */
export function SinSaldoDialog() {
  const t = useT();
  const [motivo, setMotivo] = useState<string | null>(null);

  useEffect(() => {
    const alSaltar = (e: Event) => {
      setMotivo(String((e as CustomEvent).detail ?? 'sin_saldo'));
    };
    window.addEventListener('riverz:sin-saldo', alSaltar);
    return () => window.removeEventListener('riverz:sin-saldo', alSaltar);
  }, []);

  if (!motivo) return null;

  const vencida = motivo === 'suscripcion_vencida';
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-5 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={() => setMotivo(null)}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-border bg-card p-5 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-muted">
          <Wallet className="size-5 text-muted-foreground" />
        </div>
        <h2 className="mt-4 text-base font-semibold text-foreground">
          {vencida ? t('settings.sinSaldoPlanTitulo') : t('settings.sinSaldoTitulo')}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {vencida ? t('settings.sinSaldoPlanCuerpo') : t('settings.sinSaldoCuerpo')}
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setMotivo(null)}
            className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            {t('settings.sinSaldoCerrar')}
          </button>
          <Link
            href={vencida ? '/ajustes?tab=billing' : '/ajustes?tab=saldo'}
            onClick={() => setMotivo(null)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {vencida ? t('settings.sinSaldoPlanCta') : t('settings.sinSaldoCta')}
          </Link>
        </div>
      </div>
    </div>
  );
}
