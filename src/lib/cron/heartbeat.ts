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
      // 207 es el "fallo parcial" que usan todos los crons de la casa. Cuenta
      // como error: `response.ok` lo daba por bueno y el panel mostraba verde
      // mientras el trabajo avisaba de un hueco en cada corrida — así pasaron
      // seis días sin que nadie viera que Meta entregaba a un host muerto.
      const failed = !response.ok || response.status === 207;
      await record(
        name,
        startedAt,
        failed ? "error" : "ok",
        failed ? await motivo(response) : null,
      );
    }
    return response;
  };
}

/**
 * El motivo real de una corrida fallida.
 *
 * Sólo se conservaba el mensaje cuando el handler LANZABA. Los que atrapan el
 * error y devuelven un 500 con JSON —la mayoría, porque así se evita que un
 * comercio roto tumbe el barrido entero— quedaban registrados con la cadena
 * literal "HTTP 500". La columna del panel se llama "Último error" y casi nunca
 * decía cuál: había que ir a los logs con la hora en la mano.
 *
 * Se lee sobre un CLON: el cuerpo del original tiene que seguir intacto para
 * quien llamó.
 */
async function motivo(response: Response): Promise<string> {
  const prefijo =
    response.status === 207 ? "HTTP 207 (fallo parcial)" : `HTTP ${response.status}`;
  try {
    const texto = (await response.clone().text()).trim();
    if (!texto) return prefijo;
    // Los handlers de la casa contestan `{ error: '…' }` o `{ message: '…' }`.
    try {
      const j = JSON.parse(texto) as Record<string, unknown>;
      const detalle = j.error ?? j.message ?? j.reason;
      if (typeof detalle === "string" && detalle) {
        return `${prefijo}: ${detalle}`.slice(0, 500);
      }
    } catch {
      /* no era JSON: sirve el texto crudo */
    }
    return `${prefijo}: ${texto}`.slice(0, 500);
  } catch {
    return prefijo;
  }
}
