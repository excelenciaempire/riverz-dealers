'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Inbox,
  LineChart,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useSetupStatus } from '@/hooks/use-setup-status';

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

  if (status.loading) return null;

  const steps: Array<{
    label: string;
    description: string;
    done: boolean;
    href: string;
    cta: string;
  }> = [
    {
      label: 'Conecta un canal',
      description:
        'WhatsApp, Instagram o Facebook. Es por donde recibes y respondes mensajes.',
      done: status.any_channel_connected,
      href: '/integraciones',
      cta: 'Conectar canal',
    },
    {
      label: 'Crea tu producto',
      description:
        'Funciona sin Shopify. Conectar Shopify es opcional y mejora al asistente.',
      done: status.has_product,
      href: '/productos?new=1',
      cta: 'Crear producto',
    },
    {
      label: 'Activa tu asistente de IA',
      description:
        'Responde con tu catálogo y tu marca, las 24 horas, en cada canal.',
      done: status.has_agent,
      href: '/asistente',
      cta: 'Activar asistente',
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
              <p className="app-eyebrow">Configuración completa</p>
              <h2 className="mt-1 text-base font-semibold text-foreground">
                Ya estás en vivo
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Tu canal, tu producto y tu asistente están listos para atender.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button render={<Link href="/bandeja" />} size="sm" variant="default">
              <Inbox className="size-3.5" aria-hidden />
              Abrir bandeja
            </Button>
            <Button render={<Link href="/metricas" />} size="sm" variant="outline">
              <LineChart className="size-3.5" aria-hidden />
              Ver métricas
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
          <p className="app-eyebrow">Pon en marcha tu cuenta</p>
          <h2 className="mt-1 text-base font-semibold text-foreground">
            {completed === 0
              ? 'Tres pasos para salir en vivo'
              : `${completed} de ${steps.length} pasos listos`}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Sigue el orden. Cada paso te lleva directo a donde se completa.
          </p>
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
            Actualizar estado
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
                    Listo
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
                    Más adelante
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
