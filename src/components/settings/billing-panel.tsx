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
 *
 * **No hay cupo de conversaciones.** Había una barra de "8 de 2000" que no
 * limitaba nada: pasarse no cortaba el servicio ni cobraba un peso, porque el
 * uso se paga del saldo. Un medidor que no mide nada sólo enseña a desconfiar
 * del resto de la pantalla.
 *
 * **La baja se hace en Stripe**, con el botón Administrar. Tener además un
 * "cancelar" propio significaba dos caminos para lo mismo, y el nuestro no
 * sabía de facturas pendientes ni de reembolsos. Uno solo, el que manda.
 */

interface Estado {
  estado: 'prueba' | 'activa' | 'vencida' | 'cancelada' | 'cortesia';
  modeloCobro: 'oficial' | 'saldo';
  plan: { nombre: string; slug: string } | null;
  acceso: { puede: boolean; diasDePrueba: number | null };
  cuenta: {
    uso: { contactos: number; conversaciones: number; respuestas: number };
    incluidas: number;
    excedidas: number;
    baseCentavos: number;
    excedenteCentavos: number;
    totalCentavos: number;
    moneda: string;
  };
  siguientesPlanes: { id: string; slug: string; incluidas: number; precioCentavos: number }[];
  tratoPropio: boolean;
  /** Lo que paga por mes, ya con el trato de esta cuenta. */
  precioCentavos: number;
  primerMes: { percent: number; centavos: number } | null;
  /** Cuándo se cobra de nuevo. Null mientras no haya suscripción viva. */
  periodoHasta: string | null;
  puedeSuscribirse: boolean;
  tienePortal: boolean;
  cancelarAlFinal: boolean;
}

interface UpgradeQuote {
  provider: 'stripe' | 'shopify' | 'trial';
  currency: string;
  monthlyCents: number;
  amountCents?: number;
  firstCycle?: boolean;
  quote?: string;
}

const plata = (centavos: number, moneda: string) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (moneda || 'usd').toUpperCase(),
    minimumFractionDigits: centavos % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(centavos / 100);

export function BillingPanel() {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [e, setE] = useState<Estado | null>(null);
  const [cargando, setCargando] = useState(true);
  const [yendo, setYendo] = useState(false);
  const [mejorando, setMejorando] = useState(false);
  const [planElegido, setPlanElegido] = useState('');
  const [cotizacion, setCotizacion] = useState<UpgradeQuote | null>(null);

  const recargar = useCallback(async () => {
    const res = await fetch('/api/billing/estado', { cache: 'no-store' });
    if (res.ok) setE((await res.json()) as Estado);
  }, []);

  const cotizar = useCallback(async (planId: string) => {
    if (!planId) return;
    setMejorando(true);
    try {
      const res = await fetchWithCsrf('/api/billing/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, preview: true }),
      });
      const json = await res.json() as UpgradeQuote & { error?: string };
      if (!res.ok) throw new Error(json.error ?? t('settings.billingUpgradeFailed'));
      setCotizacion(json);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.billingUpgradeFailed'));
    } finally {
      setMejorando(false);
    }
  }, [fetchWithCsrf, t]);

  const mejorar = useCallback(async (planId: string) => {
    if (!planId || !cotizacion) return;
    setMejorando(true);
    try {
      const res = await fetchWithCsrf('/api/billing/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, quote: cotizacion.quote }),
      });
      const json = await res.json() as { error?: string; url?: string; pending?: boolean };
      if (!res.ok) {
        if (res.status === 409) setCotizacion(null);
        throw new Error(json.error ?? t('settings.billingUpgradeFailed'));
      }
      if (json.url) {
        window.location.href = json.url;
        return;
      }
      await recargar();
      setPlanElegido('');
      setCotizacion(null);
      toast.success(t(json.pending ? 'settings.billingUpgradePending' : 'settings.billingUpgradeSuccess'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.billingUpgradeFailed'));
    } finally {
      setMejorando(false);
    }
  }, [cotizacion, fetchWithCsrf, recargar, t]);

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
        else toast.error(json.error ?? t('settings.billingPaymentFailed'));
      } catch {
        toast.error(t('settings.billingPaymentFailed'));
      } finally {
        setYendo(false);
      }
    },
    [fetchWithCsrf, t],
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
  const planNombre = e.plan?.slug === 'contactos-500'
    ? t('settings.billingPlan500')
    : e.plan?.slug === 'contactos-2000'
      ? t('settings.billingPlan2000')
      : e.plan?.slug === 'contactos-5000'
        ? t('settings.billingPlan5000')
        : e.plan?.slug === 'contactos-10000'
          ? t('settings.billingPlan10000')
          : e.plan?.nombre;
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
            {planNombre ? `${planNombre} · ` : ''}
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

      {(e.estado !== 'cortesia' || e.modeloCobro === 'oficial') && <div className="space-y-2 border-t border-border pt-3 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-muted-foreground">{t('settings.billingModelLabel')}</span>
          <span className="font-medium text-foreground">
            {t(e.modeloCobro === 'oficial' ? 'settings.billingAllIncluded' : 'settings.billingBalanceModel')}
          </span>
        </div>
        {e.modeloCobro === 'oficial' && cuenta.incluidas > 0 && (
          <>
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-muted-foreground">{t('settings.billingServedContacts')}</span>
              <span className="tabular-nums text-foreground">
                {t('settings.billingContactsOf', { n: cuenta.uso.contactos, total: cuenta.incluidas })}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={t('settings.billingServedContacts')}
              aria-valuenow={Math.min(cuenta.uso.contactos, cuenta.incluidas)}
              aria-valuemin={0}
              aria-valuemax={cuenta.incluidas}
              className="h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, cuenta.uso.contactos * 100 / cuenta.incluidas)}%` }} />
            </div>
            {cuenta.uso.contactos >= cuenta.incluidas && (
              <p className="text-amber-600 dark:text-amber-400">
                {t('settings.billingVolumeExceeded')}
              </p>
            )}
            {cuenta.uso.contactos >= Math.ceil(cuenta.incluidas * 0.8) && cuenta.uso.contactos < cuenta.incluidas && (
              <p className="text-amber-600 dark:text-amber-400">{t('settings.billingNearLimit')}</p>
            )}
            {e.siguientesPlanes?.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <select
                  aria-label={t('settings.billingUpgradePlan')}
                  value={planElegido || e.siguientesPlanes[0].id}
                  onChange={(event) => {
                    setPlanElegido(event.target.value);
                    setCotizacion(null);
                  }}
                  className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                >
                  {e.siguientesPlanes.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {t('settings.billingUpgradeOption', { n: plan.incluidas, price: plata(plan.precioCentavos, cuenta.moneda) })}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={mejorando}
                  onClick={() => void (cotizacion
                    ? mejorar(planElegido || e.siguientesPlanes[0].id)
                    : cotizar(planElegido || e.siguientesPlanes[0].id))}
                  className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {mejorando ? <Loader2 className="size-4 animate-spin" /> : t(cotizacion ? 'settings.billingUpgradeConfirm' : 'settings.billingUpgradePreview')}
                </button>
                {cotizacion && (
                  <div className="w-full rounded-lg border border-border bg-muted/30 p-3 text-sm">
                    <p className="font-medium text-foreground">
                      {cotizacion.provider === 'stripe'
                        ? t('settings.billingUpgradeDueNow', { amount: plata(cotizacion.amountCents ?? 0, cotizacion.currency) })
                        : cotizacion.provider === 'shopify'
                          ? t('settings.billingUpgradeShopify')
                          : t('settings.billingUpgradeTrial')}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {t('settings.billingUpgradeNext', { amount: plata(cotizacion.monthlyCents, cotizacion.currency) })}
                    </p>
                    {cotizacion.provider === 'stripe' && (
                      <p className="mt-1 text-muted-foreground">{t('settings.billingUpgradeNoRetroactive')}</p>
                    )}
                    {cotizacion.provider === 'stripe' && cotizacion.firstCycle && (
                      <p className="mt-1 text-muted-foreground">{t('settings.billingUpgradeFirstMonth')}</p>
                    )}
                  </div>
                )}
              </div>
            )}
            {e.siguientesPlanes?.length === 0 && cuenta.uso.contactos >= cuenta.incluidas && (
              <a href="mailto:riverzoficial@gmail.com" className="inline-block font-medium underline underline-offset-2">
                {t('settings.billingContactForUpgrade')}
              </a>
            )}
          </>
        )}
      </div>}

      {e.estado !== 'cortesia' && (
        <div className="space-y-2 border-t border-border pt-3 text-sm">
          {e.primerMes && (
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">
                {t('settings.billingFirstMonthDiscount', { percent: e.primerMes.percent })}
              </span>
              <span className="tabular-nums font-medium text-foreground">
                {plata(e.primerMes.centavos, cuenta.moneda)}
              </span>
            </div>
          )}
          <div className="flex items-baseline justify-between">
            <span className="text-muted-foreground">{t(e.primerMes ? 'settings.billingAfterFirstMonth' : 'settings.billingPerMonth')}</span>
            <span className="tabular-nums font-medium text-foreground">
              {plata(e.precioCentavos, cuenta.moneda)}
            </span>
          </div>
          {e.periodoHasta && (
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground">
                {e.cancelarAlFinal
                  ? t('settings.billingEndsOn')
                  : t('settings.billingRenewsOn')}
              </span>
              <span className="tabular-nums text-foreground">
                {new Date(e.periodoHasta).toLocaleDateString()}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
