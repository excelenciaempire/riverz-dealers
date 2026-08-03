import { getLogger } from "@/lib/log/logger";

import { dueJobs, SCHEDULED_JOBS } from "./schedule";

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
 * Un solo proceso: el servicio corre con una instancia, así que no hay dos
 * relojes compitiendo. Si algún día se escala horizontalmente, esto necesita
 * un lock en la base antes de disparar.
 */

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastTickAt: Date | null = null;

function baseUrl(): string {
  const port = process.env.PORT ?? "3000";
  return `http://127.0.0.1:${port}`;
}

async function runJob(name: string, path: string, secret: string): Promise<void> {
  const startedAt = Date.now();
  try {
    const res = await fetch(baseUrl() + path, {
      method: "GET",
      headers: { "x-cron-secret": secret },
      // Los trabajos largos (contacts-sync ronda los 85 s) no deben cortarse
      // a mitad: sin timeout explícito manda el del runtime.
      signal: AbortSignal.timeout(180_000),
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
  }
}

function tick(secret: string): void {
  const now = new Date();
  lastTickAt = now;
  const jobs = dueJobs(now);
  if (jobs.length === 0) return;
  // Sin await: un trabajo lento no debe correr el tick del minuto siguiente.
  // Cada uno registra su propio resultado.
  for (const job of jobs) void runJob(job.name, job.path, secret);
}

/** Programa el próximo tick justo en el segundo 0 del minuto siguiente. */
function scheduleNextTick(secret: string): void {
  const now = Date.now();
  const delay = 60_000 - (now % 60_000);
  timer = setTimeout(() => {
    scheduleNextTick(secret);
    try {
      tick(secret);
    } catch (err) {
      log.error("tick threw", { error: err instanceof Error ? err.message : String(err) });
    }
  }, delay);
  // No mantener vivo el proceso sólo por este timer.
  timer.unref?.();
}

/**
 * Arranca el reloj. Idempotente: llamarlo dos veces no duplica los disparos.
 *
 * No arranca sin `AUTOMATION_CRON_SECRET` (los endpoints responderían 401 en
 * cada corrida) ni durante `next build`.
 */
export function startScheduler(): void {
  if (started) return;
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

  started = true;
  scheduleNextTick(secret);
  log.info("scheduler started", { jobs: SCHEDULED_JOBS.length });
}

/** Estado para `/api/cron/tick`, que es quien evita que la instancia se duerma. */
export function schedulerStatus(): {
  started: boolean;
  jobs: number;
  lastTickAt: string | null;
} {
  return {
    started,
    jobs: SCHEDULED_JOBS.length,
    lastTickAt: lastTickAt ? lastTickAt.toISOString() : null,
  };
}
