'use client';

import { useCallback, useEffect, useState } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/hooks/use-locale';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { cn } from '@/lib/utils';

/**
 * El plan de la cuenta, y lo que va del período.
 *
 * Riverz no tenía dónde decirle a un comercio qué paga. Acá está lo único que
 * necesita saber: en qué estado está, cuántas conversaciones lleva contra su
 * cupo, y qué va a salir este mes.
 *
 * La cuenta de **cortesía** —los primeros comercios, a los que se les instala
 * gratis— ve que está sin cargo y no ve ningún botón de pagar. Es lo honesto:
 * ofrecerle poner una tarjeta a alguien que no la necesita es pedirle plata sin
 * decirlo.
 */

interface Estado {
  estado: 'prueba' | 'activa' | 'vencida' | 'cancelada' | 'cortesia';
  plan: { nombre: string; slug: string } | null;
  acceso: { puede: boolean; diasDePrueba: number | null };
  cuenta: {
    uso: { conversaciones: number; respuestas: number };
    incluidas: number;
    excedidas: number;
    baseCentavos: number;
    excedenteCentavos: number;
    totalCentavos: number;
    moneda: string;
  };
  tratoPropio: boolean;
  puedeSuscribirse: boolean;
  tienePortal: boolean;
  cancelarAlFinal: boolean;
}

const plata = (centavos: number, moneda: string) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (moneda || 'usd').toUpperCase(),
    maximumFractionDigits: 2,
  }).format(centavos / 100);

export function BillingPanel() {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [e, setE] = useState<Estado | null>(null);
  const [cargando, setCargando] = useState(true);
  const [yendo, setYendo] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/billing/estado', { cache: 'no-store' });
        setE(res.ok ? ((await res.json()) as Estado) : null);
      } catch {
        setE(null);
      } finally {
        setCargando(false);
      }
    })();
  }, []);

  const ir = useCallback(
    async (portal: boolean) => {
      setYendo(true);
      try {
        const res = await fetchWithCsrf('/api/billing/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ portal }),
        });
        const json = (await res.json()) as { url?: string; error?: string };
        if (json.url) window.location.href = json.url;
        else toast.error(json.error ?? 'No se pudo abrir el pago.');
      } catch {
        toast.error('No se pudo abrir el pago.');
      } finally {
        setYendo(false);
      }
    },
    [fetchWithCsrf],
  );

  if (cargando) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!e) return null;

  const dias = e.acceso.diasDePrueba;
  const aviso =
    e.estado === 'cortesia'
      ? t('settings.billingComped')
      : e.estado === 'activa'
        ? e.cancelarAlFinal
          ? t('settings.billingCancelAtEnd')
          : t('settings.billingActive')
        : e.estado === 'vencida'
          ? t('settings.billingPastDue')
          : e.estado === 'cancelada'
            ? t('settings.billingCanceled')
            : dias === null
              ? ''
              : dias <= 0
                ? t('settings.billingExpired')
                : dias === 1
                  ? t('settings.billingTrialLast')
                  : t('settings.billingTrial', { n: dias });

  const { cuenta } = e;
  const usado = cuenta.incluidas > 0
    ? Math.min(100, Math.round((cuenta.uso.conversaciones / cuenta.incluidas) * 100))
    : 0;

  return (
    <div className="max-w-xl space-y-5 rounded-xl border border-border p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {t('settings.billingTitle')}
          </h2>
          <p
            className={cn(
              'mt-0.5 text-sm',
              e.estado === 'vencida' || (dias !== null && dias <= 0)
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-muted-foreground',
            )}
          >
            {e.plan?.nombre ? `${e.plan.nombre} · ` : ''}
            {aviso}
          </p>
        </div>
        {/* Sin Stripe configurado, o en cortesía, no se ofrece un botón de pago:
            uno no puede funcionar y el otro pide plata que no se debe. */}
        {e.estado !== 'cortesia' && (e.puedeSuscribirse || e.tienePortal) && (
          <button
            type="button"
            disabled={yendo}
            onClick={() => void ir(e.tienePortal && e.estado === 'activa')}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {yendo ? <Loader2 className="size-3.5 animate-spin" /> : <CreditCard className="size-3.5" />}
            {e.tienePortal && e.estado === 'activa'
              ? t('settings.billingManage')
              : t('settings.billingSubscribe')}
          </button>
        )}
      </div>

      <div>
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-muted-foreground">{t('settings.billingThisPeriod')}</span>
          <span className="tabular-nums text-foreground">
            {t('settings.billingConversations', {
              n: cuenta.uso.conversaciones,
              total: cuenta.incluidas,
            })}
          </span>
        </div>
        <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted">
          <span
            className={cn(
              'block h-full rounded-full',
              cuenta.excedidas > 0 ? 'bg-amber-500' : 'bg-primary',
            )}
            style={{ width: `${cuenta.excedidas > 0 ? 100 : usado}%` }}
          />
        </span>
        {cuenta.excedidas > 0 && (
          <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">
            {t('settings.billingOver', { n: cuenta.excedidas })}
          </p>
        )}
      </div>

      {e.estado !== 'cortesia' && (
        <div className="flex items-baseline justify-between border-t border-border pt-3 text-sm">
          <span className="text-muted-foreground">{t('settings.billingTotal')}</span>
          <span className="tabular-nums font-medium text-foreground">
            {plata(cuenta.totalCentavos, cuenta.moneda)}
          </span>
        </div>
      )}
    </div>
  );
}
