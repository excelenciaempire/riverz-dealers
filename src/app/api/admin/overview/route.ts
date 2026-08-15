import { adminGet, rangeFromSearch } from '@/lib/admin/route';
import {
  getPlatformOverview,
  getActivitySeries,
  getCronHealth,
} from '@/lib/admin/queries';
import { SCHEDULED_JOBS, isStale } from '@/lib/cron/schedule';
import { schedulerStatus } from '@/lib/cron/scheduler';
import { collectPlatformIssues } from '@/lib/health/issues';
import { supabaseAdmin } from '@/lib/channels/admin-client';

export const dynamic = 'force-dynamic';

/** Dos minutos sin latir ya no es un retraso normal (ver /admin/operacion). */
const BEAT_STALE_MS = 2 * 60_000;

/**
 * Resumen de plataforma + serie diaria para las sparklines de /admin.
 *
 * `overview.crons_error` del RPC cuenta los trabajos cuya ÚLTIMA corrida quedó
 * en error — y ese número no sirve para la alerta del home, porque un trabajo
 * que dejó de correr no escribe filas nuevas: su última fila se queda en 'ok'
 * para siempre. Con el reloj entero muerto el contador daba 0 y la pantalla
 * decía "todo en orden" mientras hacía horas que no salía una campaña.
 *
 * Por eso el home recibe además `ops`, que cruza el catálogo real con
 * `cron_runs` (mismo cálculo que /admin/operacion) y trae el latido del reloj.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const { from, to } = rangeFromSearch(url);

  return adminGet(
    request,
    { action: 'view.overview', meta: { from: from.toISOString(), to: to.toISOString() } },
    async () => {
      const [overview, series, crons, issues] = await Promise.all([
        getPlatformOverview(from, to),
        getActivitySeries(from, to),
        getCronHealth(),
        collectPlatformIssues(supabaseAdmin()),
      ]);

      const lastRun = new Map(crons.map((c) => [c.name, c]));
      const cronsBroken = SCHEDULED_JOBS.filter((j) => {
        const run = lastRun.get(j.name);
        return run?.status === 'error' || isStale(j.schedule, run?.started_at ?? null);
      }).length;

      const beat = schedulerStatus();
      const beatAgeMs = beat.lastTickAt ? Date.now() - Date.parse(beat.lastTickAt) : null;

      // Cuántos comercios tienen algo roto AHORA. Es lo que faltaba para que el
      // home dejara de decir "todo en orden" mientras el cron diario le mandaba
      // a un comercio un correo con seis problemas.
      const critical = [...issues.values()].filter((list) =>
        list.some((i) => i.severity === 'critical'),
      ).length;

      return {
        overview,
        series,
        ops: {
          cronsBroken,
          schedulerAlive:
            beat.started && beatAgeMs !== null && beatAgeMs < BEAT_STALE_MS,
          schedulerLastTickAt: beat.lastTickAt,
          workspacesWithIssues: issues.size,
          workspacesCritical: critical,
        },
        from: from.toISOString(),
        to: to.toISOString(),
      };
    },
  );
}
