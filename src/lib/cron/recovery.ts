import type { ScheduledJob } from './schedule';

/** Una repetición rápida; después manda el ritmo normal del trabajo. */
export const JOB_RECOVERY_DELAY_MS = 2_000;
/** Un trabajo largo no se repite entero: podría seguir activo tras un timeout. */
export const JOB_RECOVERY_MAX_FIRST_RUN_MS = 60_000;
/** Una falla aislada que no pudo reintentarse deja de ser ruido pasado este plazo. */
export const CRON_ERROR_GRACE_MS = 20 * 60_000;

export type CompletedCronRun = {
  status?: string;
  started_at?: string | null;
};

/**
 * Sólo se repite una respuesta completa y recuperable. Una excepción de red no
 * se repite acá porque el handler HTTP podría seguir ejecutándose aunque se
 * haya cortado la conexión con el scheduler.
 */
export function shouldRetryScheduledResponse(args: {
  job: ScheduledJob;
  status: number;
  durationMs: number;
  attempt: number;
}): boolean {
  if (!args.job.retryOnFailure || args.attempt > 1) return false;
  if (args.durationMs > JOB_RECOVERY_MAX_FIRST_RUN_MS) return false;
  return args.status === 207 || args.status === 429 || args.status >= 500;
}

/**
 * El administrador recibe sólo fallos confirmados: dos corridas consecutivas
 * en error, o una que siguió sin recuperarse después del margen. La colección
 * debe venir de más nueva a más vieja.
 */
export function isActionableCronFailure(
  runs: CompletedCronRun[],
  now = Date.now()
): boolean {
  const completed = runs.filter(
    (run) => run.status === 'ok' || run.status === 'error'
  );
  const latest = completed[0];
  if (latest?.status !== 'error') return false;
  if (completed[1]?.status === 'error') return true;

  const startedAt = Date.parse(latest.started_at ?? '');
  return Number.isFinite(startedAt) && now - startedAt >= CRON_ERROR_GRACE_MS;
}
