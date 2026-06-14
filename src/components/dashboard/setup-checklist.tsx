'use client';

import Link from 'next/link';
import { ArrowRight, CheckCircle2, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSetupStatus } from '@/hooks/use-setup-status';

/**
 * Tarjeta de onboarding que aparece en /panel hasta que el merchant
 * haya conectado WhatsApp + Shopify + creado un agente IA activo.
 * Si los tres están listos no se renderiza — el dashboard vuelve a
 * mostrar las métricas sin ruido.
 *
 * Cada paso es un Link directo al lugar donde se completa: nada de
 * "andá a Ajustes y buscá la tab Canales". Un click te lleva al
 * connect.
 */
export function SetupChecklist() {
  const status = useSetupStatus();
  if (status.loading || status.ready) return null;

  const steps: Array<{
    label: string;
    description: string;
    done: boolean;
    href: string;
    cta: string;
  }> = [
    {
      label: 'Conecta WhatsApp Cloud API',
      description:
        'Necesario para recibir mensajes en la Bandeja y mandar campañas.',
      done: status.whatsapp_connected,
      href: '/integraciones',
      cta: 'Conectar WhatsApp',
    },
    {
      label: 'Conecta tu tienda Shopify',
      description:
        'Sincroniza productos, pedidos y carritos para la IA y los flujos.',
      done: status.shopify_connected,
      href: '/integraciones',
      cta: 'Conectar Shopify',
    },
    {
      label: 'Activa tu primer Asistente IA',
      description:
        'El asistente contesta las preguntas básicas usando tu catálogo.',
      done: status.has_agent,
      href: '/asistente',
      cta: 'Crear asistente',
    },
  ];

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="app-eyebrow">Configuración inicial</p>
          <h2 className="mt-1 text-base font-semibold text-foreground">
            {status.completed === 0
              ? 'Empieza aquí'
              : `${status.completed} de ${steps.length} pasos listos`}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Con estos tres pasos tu inbox, tu bot y tus campañas funcionan.
          </p>
        </div>
        <div className="flex items-center gap-1">
          {steps.map((s, i) => (
            <span
              key={i}
              className={cn(
                'h-1.5 w-6 rounded-full',
                s.done ? 'bg-primary' : 'bg-muted',
              )}
              aria-hidden
            />
          ))}
        </div>
      </header>

      <ul className="mt-4 grid gap-2 sm:grid-cols-3">
        {steps.map((step) => (
          <li
            key={step.href + step.cta}
            className={cn(
              'flex flex-col gap-2 rounded-lg border p-3',
              step.done
                ? 'border-primary/30 bg-primary/5'
                : 'border-border bg-muted/20',
            )}
          >
            <div className="flex items-center gap-2">
              {step.done ? (
                <CheckCircle2 className="size-4 text-primary" aria-hidden />
              ) : (
                <Circle className="size-4 text-muted-foreground" aria-hidden />
              )}
              <span className="text-sm font-medium text-foreground">
                {step.label}
              </span>
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              {step.description}
            </p>
            {!step.done && (
              <Link
                href={step.href}
                className="mt-auto inline-flex items-center gap-1 text-[11px] font-medium text-foreground hover:text-accent-ink"
              >
                {step.cta}
                <ArrowRight className="size-3" />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
