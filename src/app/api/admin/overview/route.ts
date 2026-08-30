import { adminGet, rangeFromSearch } from '@/lib/admin/route';
import {
  getPlatformOverview,
  getActivitySeries,
  getCronHealth,
} from '@/lib/admin/queries';
import { SCHEDULED_JOBS, isStale } from '@/lib/cron/schedule';
import { schedulerStatus } from '@/lib/cron/scheduler';

export const dynamic = 'force-dynamic';

/** Dos minutos sin latir ya no es un retraso normal (ver /admin/operacion). */

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
 *
 * Los comercios rotos NO salen por acá: `collectPlatformIssues()` recorre todas
 * las cuentas y era lo único lento del `Promise.all`, así que los KPIs y las
 * sparklines —que ya estaban listos— esperaban por él. Vive aparte en
 * `/api/admin/overview/issues` y el home lo pide en paralelo.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const { from, to } = rangeFromSearch(url);

  return adminGet(
    request,
    { action: 'view.overview', meta: { from: from.toISOString(), to: to.toISOString() } },
    async () => {
      const [overview, series, crons] = await Promise.all([
        getPlatformOverview(from, to),
        getActivitySeries(from, to),
        getCronHealth(),
      ]);

      const lastRun = new Map(crons.map((c) => [c.name, c]));
      const cronsBroken = SCHEDULED_JOBS.filter((j) => {
        const run = lastRun.get(j.name);
        return run?.status === 'error' || isStale(j.schedule, run?.started_at ?? null);
      }).length;

      const beat = schedulerStatus();

      return {
        overview,
        series,
        ops: {
          cronsBroken,
          schedulerAlive: beat.alive,
          schedulerLastTickAt: beat.lastTickAt,
        },
        from: from.toISOString(),
        to: to.toISOString(),
      };
    },
  );
}
