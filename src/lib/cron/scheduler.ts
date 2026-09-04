import { getLogger } from '@/lib/log/logger';
import { supabaseAdmin } from '@/lib/channels/admin-client';

import {
  DEFAULT_TIMEOUT_MS,
  dueJobs,
  expectedIntervalMs,
  isStale,
  SCHEDULED_JOBS,
  type ScheduledJob,
} from './schedule';
import {
  JOB_RECOVERY_DELAY_MS,
  shouldRetryScheduledResponse,
} from './recovery';

const log = getLogger('scheduler');

/**
 * Reloj interno de los trabajos periódicos.
 *
 * Arranca desde `instrumentation.ts` y despierta una vez por minuto. Los
 * trabajos se disparan por HTTP contra la propia instancia (127.0.0.1) en
 * lugar de importar los handlers, para que sigan pasando por `withCronRun` y
 * queden registrados en `cron_runs` exactamente igual que cuando los llamaba
 * un cron de Render.
 *
 * El estado vive en `globalThis` y NO en variables de módulo. Medido en prod
 * 2026-08-04: `instrumentation.ts` y el route handler de `/api/cron/tick`
 * cargan copias distintas del módulo, cada una con su propio `let started`,
 * así que el guard no se veía entre ellas y quedaban varios relojes latiendo a
 * la vez — los trabajos de cada minuto se dispararon 2,7 veces por minuto
 * durante 17 h. Una sola instancia del servicio no garantiza un solo módulo.
 *
 * Ese guard resuelve el caso DENTRO de un proceso. Entre procesos no puede: si
 * algún día el servicio corre en dos instancias, cada una tiene su propio
 * `globalThis` y las dos dispararían todo. Por eso, además, cada minuto se pide
 * el turno en la base (`claim_scheduler_tick`, migración 157) y sólo dispara
 * quien lo obtiene. Es barato —una fila por minuto— y hoy, con una sola
 * instancia, es un no-op que siempre concede.
 */

type SchedulerState = {
  timer: ReturnType<typeof setTimeout> | null;
  lastTickAt: Date | null;
  /** Trabajos con una corrida todavía en vuelo; no se relanzan encima. */
  inFlight: Set<string>;
  /**
   * La instancia se está apagando. Deja de tomar trabajo nuevo aunque el reloj
   * alcance a despertar una vez más.
   */
  draining: boolean;
};

/** No reanudamos cuarenta procesos a la vez después de un despliegue largo. */
const MAX_RECOVERY_JOBS_PER_TICK = 6;

const STATE_KEY = '__riverzScheduler';

function state(): SchedulerState {
  const g = globalThis as typeof globalThis & { [STATE_KEY]?: SchedulerState };
  if (!g[STATE_KEY]) {
    g[STATE_KEY] = {
      timer: null,
      lastTickAt: null,
      inFlight: new Set(),
      draining: false,
    };
  }
  return g[STATE_KEY];
}

function baseUrl(): string {
  const port = process.env.PORT ?? '3000';
  return `http://127.0.0.1:${port}`;
}

async function runJob(
  job: ScheduledJob,
  secret: string,
): Promise<void> {
  const s = state();
  // Un trabajo que todavía corre no se vuelve a lanzar: meta-dm-backfill tarda
  // ~22 min y con schedule horario se apilaba encima de sí mismo.
  if (s.inFlight.has(job.name)) {
    log.warn('job skipped (still running)', { job: job.name });
    return;
  }
  s.inFlight.add(job.name);
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const startedAt = Date.now();
      const res = await fetch(baseUrl() + job.path, {
        method: 'GET',
        headers: { 'x-cron-secret': secret },
        signal: AbortSignal.timeout(job.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      const ms = Date.now() - startedAt;
      // 207 es 2xx pero los sincronizadores lo usan para "falló una cuenta".
      if (res.ok && res.status !== 207) {
        log.info('job ok', { job: job.name, status: res.status, ms, attempt });
        return;
      }
      if (shouldRetryScheduledResponse({ job, status: res.status, durationMs: ms, attempt })) {
        log.warn('job failed; automatic recovery queued', {
          job: job.name,
          status: res.status,
          ms,
        });
        await res.body?.cancel().catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, JOB_RECOVERY_DELAY_MS));
        continue;
      }
      log.warn('job failed', { job: job.name, status: res.status, ms, attempt });
      return;
    }
  } catch (err) {
    log.error('job threw', {
      job: job.name,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    s.inFlight.delete(job.name);
  }
}

/**
 * Quién es esta instancia, para poder leer en la tabla quién tomó cada minuto.
 * Render expone el id de la instancia; si no está, alcanza con el pid.
 */
function holder(): string {
  return (
    process.env.RENDER_INSTANCE_ID ??
    process.env.HOSTNAME ??
    `pid-${process.pid}`
  );
}

/**
 * ¿Le toca a esta instancia disparar este minuto?
 *
 * Fail-open a propósito: si la base no contesta, se dispara igual. Con una sola
 * instancia —lo que corre hoy— fallar cerrado convertiría un hipo de red en
 * campañas que no salen y carritos que no se recuperan, que es mucho peor que
 * el riesgo teórico de un disparo doble.
 */
async function claimTick(at: Date): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin().rpc('claim_scheduler_tick', {
      p_minute: at.toISOString(),
      p_holder: holder(),
    });
    if (error) throw new Error(error.message);
    return data !== false;
  } catch (err) {
    log.warn('no se pudo pedir el turno; se dispara igual', {
      error: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
}

/**
 * Trabajos que quedaron pendientes porque el proceso se reinició o la instancia
 * estuvo fuera de rotación. La misma tabla que mira el panel decide qué falta;
 * un trabajo que sigue en ejecución tiene fila `running` fresca y no se duplica.
 */
async function recoveryJobs(now: Date): Promise<ScheduledJob[]> {
  try {
    const { data, error } = await supabaseAdmin().rpc('admin_cron_health');
    if (error) throw new Error(error.message);
    const latest = new Map(
      ((data ?? []) as Array<{ name: string; started_at: string | null }>).map(
        (run) => [run.name, run.started_at]
      )
    );
    const overdue = SCHEDULED_JOBS.filter(
      (job) =>
        !job.parent &&
        isStale(job.schedule, latest.get(job.name) ?? null, now.getTime())
    );
    const overdueFactor = (job: ScheduledJob): number => {
      const last = latest.get(job.name);
      const age = last
        ? now.getTime() - Date.parse(last)
        : Number.POSITIVE_INFINITY;
      return age / (expectedIntervalMs(job.schedule) ?? 60_000);
    };
    return overdue
      .sort((a, b) => overdueFactor(b) - overdueFactor(a))
      .slice(0, MAX_RECOVERY_JOBS_PER_TICK);
  } catch (err) {
    // Si la salud no se puede leer, el horario normal sigue funcionando. No se
    // inventa una cola de recuperación con datos incompletos.
    log.warn('recovery health check failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

function uniqueJobs(jobs: ScheduledJob[]): ScheduledJob[] {
  return [...new Map(jobs.map((job) => [job.name, job])).values()];
}

function tick(secret: string): void {
  const s = state();
  if (s.draining) return;
  const now = new Date();
  s.lastTickAt = now;

  // Las llaves que se cargaron desde el panel, al entorno del proceso.
  //
  // Va acá arriba, antes del corte por "no hay trabajos": es lo que hace que
  // cambiar una clave en /admin/proveedores valga en TODAS las instancias en
  // menos de un minuto, sin redeploy y sin tocar ningún `process.env.X` de los
  // que ya existen. Sin await ni manejo de error: es una consulta chica a una
  // tabla chica, y si falla el proceso sigue con lo que ya tenía puesto.
  void import('@/lib/admin/claves')
    .then((m) => m.hidratarClaves())
    .catch(() => {});

  void (async () => {
    // El turno se pide DESPUÉS de un salto asíncrono, así que hay que volver a
    // mirar: la instancia pudo entrar en drenaje mientras tanto.
    if (state().draining) return;
    if (!(await claimTick(now))) {
      log.info('otro proceso tomó este minuto', { jobs: dueJobs(now).length });
      return;
    }
    const jobs = uniqueJobs([...dueJobs(now), ...(await recoveryJobs(now))]);
    if (jobs.length === 0) return;
    // Sin await: un trabajo lento no debe correr el tick del minuto siguiente.
    // Cada uno registra su propio resultado.
    for (const job of jobs) {
      void runJob(job, secret);
    }
  })();
}

/** Programa el próximo tick justo en el segundo 0 del minuto siguiente. */
function scheduleNextTick(secret: string): void {
  const now = Date.now();
  const delay = 60_000 - (now % 60_000);
  const t = setTimeout(() => {
    scheduleNextTick(secret);
    try {
      tick(secret);
    } catch (err) {
      log.error('tick threw', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, delay);
  // No mantener vivo el proceso sólo por este timer.
  t.unref?.();
  state().timer = t;
}

/**
 * Después de un arranque no esperamos al próximo borde del minuto: una
 * interrupción de despliegue ya pudo dejar trabajo vencido. La espera corta da
 * tiempo a que el servidor acepte el fetch local que usa `runJob`.
 */
function scheduleStartupRecovery(secret: string): void {
  const timer = setTimeout(() => {
    try {
      tick(secret);
    } catch (err) {
      log.error('startup recovery tick threw', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, 5_000);
  timer.unref?.();
}

/**
 * Arranca el reloj. Idempotente **entre copias del módulo**: el guard mira
 * `globalThis`, no una variable de módulo, porque instrumentation y los route
 * handlers no comparten registro de módulos.
 *
 * No arranca sin `AUTOMATION_CRON_SECRET` (los endpoints responderían 401 en
 * cada corrida) ni durante `next build`.
 */
export function startScheduler(): void {
  const s = state();
  if (s.timer) return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  if (process.env.SCHEDULER_DISABLED === 'true') {
    log.info('scheduler disabled by env');
    return;
  }

  const secret = process.env.AUTOMATION_CRON_SECRET;
  if (!secret) {
    log.warn('scheduler not started: missing AUTOMATION_CRON_SECRET');
    return;
  }

  scheduleNextTick(secret);
  scheduleStartupRecovery(secret);
  log.info('scheduler started', { jobs: SCHEDULED_JOBS.length });
}

/**
 * Deja de tomar trabajo nuevo. Se llama al recibir SIGTERM.
 *
 * Sin esto, una instancia que Render está sacando de rotación seguía
 * despertando cada minuto y disparando trabajos, y cada `fetch` en vuelo
 * mantiene vivo el bucle de eventos: el proceso no terminaba de apagarse, el
 * despliegue nuevo se quedaba esperando el drenaje y terminaba expirando. Se vio
 * en producción el 2026-08-16 con dos despliegues seguidos en `update_failed`,
 * mientras los registros mostraban a la instancia vieja corriendo trabajos
 * durante los diecisiete minutos completos.
 *
 * No se cancelan las corridas ya lanzadas: la que está a mitad de camino
 * termina, y como cada una se registra en `cron_runs`, se sabe cuál fue.
 */
export function stopScheduler(): void {
  const s = state();
  s.draining = true;
  if (s.timer) clearTimeout(s.timer);
  s.timer = null;
  log.info('scheduler detenido (la instancia se está apagando)', {
    enVuelo: s.inFlight.size,
  });
}

/** Estado para `/api/cron/tick`, que es quien evita que la instancia se duerma. */
/**
 * Cuánto puede pasar sin un latido antes de dar el reloj por muerto.
 *
 * Dos minutos: el tick es cada minuto, así que uno perdido es ruido y dos son
 * un problema.
 */
const LATIDO_VIEJO_MS = 2 * 60_000;

export function schedulerStatus(): {
  started: boolean;
  jobs: number;
  lastTickAt: string | null;
  running: string[];
  /**
   * Si el reloj late. Lo decide ACÁ y no cada pantalla.
   *
   * La misma regla estaba escrita tres veces —el índice, la pantalla de
   * operación y esta capa— y en el navegador encima obligaba a llamar a
   * `Date.now()` durante el render, que React marca como impuro porque el
   * resultado cambia entre repintados sin que cambien los datos.
   */
  alive: boolean;
} {
  const s = state();
  const lastTickAt = s.lastTickAt ? s.lastTickAt.toISOString() : null;
  const started = s.timer !== null && !s.draining;
  const edadMs = s.lastTickAt ? Date.now() - s.lastTickAt.getTime() : null;
  return {
    started,
    jobs: SCHEDULED_JOBS.length,
    lastTickAt,
    running: [...s.inFlight].sort(),
    alive: started && edadMs !== null && edadMs < LATIDO_VIEJO_MS,
  };
}
