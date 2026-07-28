import { supabaseAdmin } from "@/lib/channels/admin-client";

/**
 * Latido de los trabajos de fondo en `cron_runs` (migración 059).
 *
 * `pingCron` marca "esto se disparó" y nada más: escribe `status: 'ok'` con
 * `started_at = finished_at`, así que **nunca registró un fallo ni una
 * duración**. Para `/api/health/crons` alcanzaba (la pregunta era "¿corrió?"),
 * pero un panel que muestra todo verde mientras un cron revienta en cada
 * corrida es peor que no tener panel.
 *
 * `withCronRun` envuelve el handler y escribe una fila al terminar, con la
 * duración real y el resultado de verdad. Se saltan los rechazos de
 * autenticación: la URL es pública y cualquiera puede golpearla — registrar
 * esos intentos llenaría la tabla de ruido y falsearía el estado.
 */

/**
 * Marca de "se disparó", sin resultado. Se mantiene porque además de los
 * llamados históricos hay usos deliberados como reloj de throttle (el cron de
 * comentarios lee la última fila para decidir si toca reconciliar).
 */
export async function pingCron(name: string): Promise<void> {
  try {
    const now = new Date().toISOString();
    await supabaseAdmin()
      .from("cron_runs")
      .insert({ name, status: "ok", started_at: now, finished_at: now });
  } catch {
    /* best-effort heartbeat */
  }
}

async function record(
  name: string,
  startedAt: Date,
  status: "ok" | "error",
  error: string | null,
): Promise<void> {
  try {
    await supabaseAdmin()
      .from("cron_runs")
      .insert({
        name,
        status,
        started_at: startedAt.toISOString(),
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt.getTime(),
        error,
      });
  } catch {
    /* best-effort heartbeat */
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 500);
  return String(err).slice(0, 500);
}

/**
 * Envuelve el handler de un cron para que su corrida quede registrada con
 * duración y resultado reales:
 *
 *   export const GET = withCronRun('flows-resume', async (request) => { … });
 */
export function withCronRun(
  name: string,
  handler: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const startedAt = new Date();
    let response: Response;
    try {
      response = await handler(request);
    } catch (err) {
      await record(name, startedAt, "error", describe(err));
      throw err;
    }
    // 401/403 = alguien golpeó la URL sin el secreto; no es una corrida.
    if (response.status !== 401 && response.status !== 403) {
      await record(
        name,
        startedAt,
        response.ok ? "ok" : "error",
        response.ok ? null : `HTTP ${response.status}`,
      );
    }
    return response;
  };
}
