'use client';

import Link from '@/components/i18n/locale-link';
import { useT } from '@/hooks/use-locale';
import { cn } from '@/lib/utils';
import { primaryBlocker, VOICE_BLOCKED_KEY } from '@/lib/voice/labels';
import type { VoiceReadinessView } from '@/hooks/use-voice-readiness';

/**
 * Si el teléfono puede sonar, en un renglón.
 *
 * La pantalla de Llamadas mostraba cada cosa que faltaba junto a la tarjeta
 * donde se arregla — bien para configurar, inútil para la pregunta que el
 * comercio hace de verdad, que es «¿esto está andando?». Había que leer tres
 * tarjetas y deducirlo. Y era deducible mal: el agente de Pilar estuvo borrado
 * seis días sin que ninguna pantalla lo dijera.
 *
 * Se muestra UN motivo, el primero según `BLOCKER_ORDER`, porque una lista de
 * cinco cosas que faltan no dice por dónde empezar. Los demás siguen viéndose
 * en su tarjeta.
 */
export function VoiceStatusLine({
  readiness,
  loading,
  className,
}: {
  readiness: VoiceReadinessView | null;
  loading?: boolean;
  className?: string;
}) {
  const t = useT();

  // Mientras no se sabe no se dice nada: un «no puede llamar» que aparece medio
  // segundo y se corrige solo asusta más de lo que informa.
  if (loading && !readiness) return null;
  if (!readiness) return null;

  const bloqueo = primaryBlocker(readiness.blockers);
  const aviso = primaryBlocker(readiness.warnings);
  const item = bloqueo ?? aviso;
  const tono = bloqueo ? 'blocked' : aviso ? 'warn' : 'ok';

  return (
    <p
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-sm',
        tono === 'blocked' &&
          'border-destructive/40 bg-destructive/5 text-destructive',
        tono === 'warn' &&
          'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400',
        tono === 'ok' &&
          'border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400',
        className
      )}
    >
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          tono === 'blocked' && 'bg-destructive',
          tono === 'warn' && 'bg-amber-500',
          tono === 'ok' && 'animate-pulse bg-emerald-500'
        )}
      />

      {tono === 'ok' ? (
        <>
          <span>
            {readiness.phoneNumber
              ? t('voice.canCallFrom', { number: readiness.phoneNumber })
              : t('voice.canCall')}
          </span>
          {readiness.agents.length === 1 ? (
            <span className="text-muted-foreground">
              {t('voice.answeredBy', { name: readiness.agents[0].name })}
            </span>
          ) : readiness.agents.length > 1 ? (
            <span className="text-muted-foreground">
              {t('voice.answeredByMany', {
                count: String(readiness.agents.length),
              })}
            </span>
          ) : null}
        </>
      ) : (
        <>
          <span className="font-medium">
            {bloqueo ? t('voice.cannotCall') : t('voice.callsWarning')}
          </span>
          <span>
            {t(VOICE_BLOCKED_KEY[item!.code], { name: item!.agentName ?? '' })}
          </span>
          {item!.fixHref && (
            <Link href={item!.fixHref} className="underline underline-offset-2">
              {t('voice.blockedFix')}
            </Link>
          )}
        </>
      )}
    </p>
  );
}
