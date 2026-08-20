'use client';

import { useEffect, useState } from 'react';
import Link from "@/components/i18n/locale-link";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Inbox,
  RefreshCw,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useSetupStatus } from '@/hooks/use-setup-status';
import { useRiverz2 } from '@/hooks/use-feature-flags';
import { useT } from '@/hooks/use-locale';

// El merchant puede ocultar el checklist aunque no lo haya completado; la
// preferencia se guarda por navegador (reaparece igual solo, no molesta).
const DISMISS_KEY = 'riverz.setupChecklistDismissed';

/**
 * Stepper guiado de onboarding en /panel. Lleva al merchant nuevo por el
 * camino mínimo para salir en vivo: conectar un canal, crear un producto y
 * activar el asistente de IA.
 *
 * Cada paso destaca su estado (hecho / actual / pendiente). Solo el paso
 * actual muestra el botón principal con el deep-link exacto a la acción, así
 * no hay que adivinar a dónde ir. Cuando todo está listo, la tarjeta se
 * reemplaza por un banner breve de éxito y luego desaparece.
 *
 * El workspace se autocrea, por eso no aparece como paso accionable.
 */
export function SetupChecklist() {
  const status = useSetupStatus();
  const riverz2 = useRiverz2();
  const t = useT();

  // Leído en un efecto (no en el initializer) a propósito: servidor y cliente
  // arrancan en `false` y recién tras montar el efecto oculta el checklist si
  // estaba descartado, evitando una desalineación de hidratación.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY) === '1') {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- lectura client-only post-montaje (hidratación segura)
        setDismissed(true);
      }
    } catch {
      /* localStorage bloqueado: mostramos el checklist igual */
    }
  }, []);
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* no-op */
    }
    setDismissed(true);
  };

  if (status.loading || dismissed) return null;

  const steps: Array<{
    label: string;
    description: string;
    done: boolean;
    href: string;
    cta: string;
  }> = [
    {
      label: t('dashboard.stepConnectChannel'),
      description: t('dashboard.stepConnectChannelDesc'),
      done: status.any_channel_connected,
      href: '/integraciones',
      cta: t('dashboard.stepConnectChannelCta'),
    },
    {
      label: t('dashboard.stepCreateProduct'),
      description: t('dashboard.stepCreateProductDesc'),
      done: status.has_product,
      href: '/productos?new=1',
      cta: t('dashboard.stepCreateProductCta'),
    },
    {
      label: t('dashboard.stepActivateAssistant'),
      description: t('dashboard.stepActivateAssistantDesc'),
      // Alcanzable, no solo encendido: un asistente cuyo alcance no cubre
      // ningun canal conectado no contesta a nadie, y marcarlo como listo
      // manda al comercio a esperar respuestas que no van a llegar.
      done: status.has_agent && status.agent_reachable,
      href: '/asistente',
      cta: t('dashboard.stepActivateAssistantCta'),
    },
    {
      // El unico paso que PRUEBA que la cadena entera funciona. Los tres de
      // arriba son configuracion; este es el hecho.
      label: t('dashboard.stepFirstReply'),
      description: t('dashboard.stepFirstReplyDesc'),
      done: status.agent_replied,
      href: '/asistente',
      cta: t('dashboard.stepFirstReplyCta'),
    },
  ];

  const completed = steps.filter((s) => s.done).length;
  const allDone = completed === steps.length;

  // Estado de éxito: cuando los tres pasos están listos mostramos un banner
  // breve en vez del checklist. Al recargar, `ready` esconde toda la tarjeta.
  if (allDone) {
    return (
      <section className="rounded-xl border border-primary/30 bg-primary/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <CheckCircle2 className="size-5" aria-hidden />
            </span>
            <div>
              <p className="app-eyebrow">{t('dashboard.setupComplete')}</p>
              <h2 className="mt-1 text-base font-semibold text-foreground">
                {t('dashboard.youAreLive')}
              </h2>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button render={<Link href="/bandeja" />} size="sm" variant="default">
              <Inbox className="size-3.5" aria-hidden />
              {t('dashboard.openInbox')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={dismiss}
              className="text-muted-foreground"
              aria-label={t('dashboard.hideChecklist')}
              title={t('dashboard.hideChecklist')}
            >
              <X className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      </section>
    );
  }

  // Índice del paso actual: el primero sin completar.
  const currentIndex = steps.findIndex((s) => !s.done);

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="app-eyebrow">{t('dashboard.getAccountRunning')}</p>
          <h2 className="mt-1 text-base font-semibold text-foreground">
            {completed === 0
              ? t('dashboard.stepsToLive', { total: steps.length })
              : t('dashboard.stepsReady', { completed, total: steps.length })}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('dashboard.followOrder')}
          </p>
          {/* La única entrada al asistente de activación en toda la aplicación.
              Vive acá y no en el menú porque es de una sola vez: quien todavía
              tiene pasos pendientes es exactamente quien lo necesita, y el
              camino manual sigue estando al lado. */}
          {riverz2 && (
            <Button
              render={<Link href="/operacion/activar" />}
              size="xs"
              variant="ghost"
              className="mt-2 -ml-2 text-primary"
            >
              {t('dashboard.setupWithAssistant')}
              <ArrowRight className="size-3" aria-hidden />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1" aria-hidden>
            {steps.map((s, i) => (
              <span
                key={i}
                className={cn(
                  'h-1.5 w-6 rounded-full transition-colors',
                  s.done
                    ? 'bg-primary'
                    : i === currentIndex
                      ? 'bg-primary/40'
                      : 'bg-muted',
                )}
              />
            ))}
          </div>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => status.refresh()}
            className="text-muted-foreground"
          >
            <RefreshCw className="size-3" aria-hidden />
            {t('dashboard.refreshStatus')}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={dismiss}
            className="text-muted-foreground"
            aria-label={t('dashboard.hideChecklist')}
            title={t('dashboard.hideChecklist')}
          >
            <X className="size-3.5" aria-hidden />
          </Button>
        </div>
      </header>

      <ol className="mt-4 flex flex-col gap-2">
        {steps.map((step, i) => {
          const isCurrent = i === currentIndex;
          return (
            <li
              key={step.href}
              className={cn(
                'flex flex-col gap-3 rounded-lg border p-3.5 sm:flex-row sm:items-center sm:justify-between',
                step.done
                  ? 'border-primary/30 bg-primary/5'
                  : isCurrent
                    ? 'border-primary/40 bg-primary/[0.04] ring-1 ring-primary/20'
                    : 'border-border bg-muted/20',
              )}
            >
              <div className="flex items-start gap-3">
                <StepBadge
                  done={step.done}
                  current={isCurrent}
                  index={i + 1}
                />
                <div>
                  <span
                    className={cn(
                      'text-sm font-medium',
                      step.done || isCurrent
                        ? 'text-foreground'
                        : 'text-muted-foreground',
                    )}
                  >
                    {step.label}
                  </span>
                  <p
                    className={cn(
                      'mt-0.5 text-[11px] leading-snug',
                      isCurrent
                        ? 'text-muted-foreground'
                        : 'text-muted-foreground/80',
                    )}
                  >
                    {step.description}
                  </p>
                </div>
              </div>

              <div className="shrink-0 pl-9 sm:pl-0">
                {step.done ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary">
                    <Check className="size-3.5" aria-hidden />
                    {t('dashboard.done')}
                  </span>
                ) : isCurrent ? (
                  <Button
                    render={<Link href={step.href} />}
                    size="sm"
                    variant="default"
                  >
                    {step.cta}
                    <ArrowRight className="size-3.5" aria-hidden />
                  </Button>
                ) : (
                  <span className="text-[11px] text-muted-foreground/70">
                    {t('dashboard.later')}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Marcador circular de paso: check si está hecho, número si es el actual o
 *  está pendiente. El actual se resalta con el color primario. */
function StepBadge({
  done,
  current,
  index,
}: {
  done: boolean;
  current: boolean;
  index: number;
}) {
  return (
    <span
      className={cn(
        'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
        done
          ? 'bg-primary text-primary-foreground'
          : current
            ? 'bg-primary/15 text-primary ring-1 ring-primary/30'
            : 'bg-muted text-muted-foreground',
      )}
      aria-hidden
    >
      {done ? <Check className="size-3.5" /> : index}
    </span>
  );
}
