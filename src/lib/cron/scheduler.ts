import { getLogger } from "@/lib/log/logger";
import { supabaseAdmin } from "@/lib/channels/admin-client";

import { DEFAULT_TIMEOUT_MS, dueJobs, SCHEDULED_JOBS } from "./schedule";

const log = getLogger("scheduler");

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

const STATE_KEY = "__riverzScheduler";

function state(): SchedulerState {
  const g = globalThis as typeof globalThis & { [STATE_KEY]?: SchedulerState };
  if (!g[STATE_KEY]) {
    g[STATE_KEY] = { timer: null, lastTickAt: null, inFlight: new Set(), draining: false };
  }
  return g[STATE_KEY];
}

function baseUrl(): string {
  const port = process.env.PORT ?? "3000";
  return `http://127.0.0.1:${port}`;
}

async function runJob(
  name: string,
  path: string,
  secret: string,
  timeoutMs: number,
): Promise<void> {
  const s = state();
  // Un trabajo que todavía corre no se vuelve a lanzar: meta-dm-backfill tarda
  // ~22 min y con schedule horario se apilaba encima de sí mismo.
  if (s.inFlight.has(name)) {
    log.warn("job skipped (still running)", { job: name });
    return;
  }
  s.inFlight.add(name);
  const startedAt = Date.now();
  try {
    const res = await fetch(baseUrl() + path, {
      method: "GET",
      headers: { "x-cron-secret": secret },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ms = Date.now() - startedAt;
    // 207 es 2xx pero los polls de correo lo usan para "falló una casilla".
    if (!res.ok || res.status === 207) {
      log.warn("job failed", { job: name, status: res.status, ms });
    } else {
      log.info("job ok", { job: name, status: res.status, ms });
    }
  } catch (err) {
    log.error("job threw", {
      job: name,
      ms: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    s.inFlight.delete(name);
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

function tick(secret: string): void {
  const s = state();
  if (s.draining) return;
  const now = new Date();
  s.lastTickAt = now;
  const jobs = dueJobs(now);
  if (jobs.length === 0) return;

  void (async () => {
    // El turno se pide DESPUÉS de un salto asíncrono, así que hay que volver a
    // mirar: la instancia pudo entrar en drenaje mientras tanto.
    if (state().draining) return;
    if (!(await claimTick(now))) {
      log.info('otro proceso tomó este minuto', { jobs: jobs.length });
      return;
    }
    // Sin await: un trabajo lento no debe correr el tick del minuto siguiente.
    // Cada uno registra su propio resultado.
    for (const job of jobs) {
      void runJob(job.name, job.path, secret, job.timeoutMs ?? DEFAULT_TIMEOUT_MS);
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
      log.error("tick threw", { error: err instanceof Error ? err.message : String(err) });
    }
  }, delay);
  // No mantener vivo el proceso sólo por este timer.
  t.unref?.();
  state().timer = t;
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
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.SCHEDULER_DISABLED === "true") {
    log.info("scheduler disabled by env");
    return;
  }

  const secret = process.env.AUTOMATION_CRON_SECRET;
  if (!secret) {
    log.warn("scheduler not started: missing AUTOMATION_CRON_SECRET");
    return;
  }

  scheduleNextTick(secret);
  log.info("scheduler started", { jobs: SCHEDULED_JOBS.length });
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
  log.info("scheduler detenido (la instancia se está apagando)", {
    enVuelo: s.inFlight.size,
  });
}

/** Estado para `/api/cron/tick`, que es quien evita que la instancia se duerma. */
export function schedulerStatus(): {
  started: boolean;
  jobs: number;
  lastTickAt: string | null;
  running: string[];
} {
  const s = state();
  return {
    started: s.timer !== null && !s.draining,
    jobs: SCHEDULED_JOBS.length,
    lastTickAt: s.lastTickAt ? s.lastTickAt.toISOString() : null,
    running: [...s.inFlight].sort(),
  };
}
