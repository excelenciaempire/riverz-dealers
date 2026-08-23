import Anthropic from "@anthropic-ai/sdk";

/**
 * Shared Anthropic client factory.
 *
 * Centralizes the per-request budget. The SDK defaults to a 10-minute timeout
 * and maxRetries: 2 with exponential backoff on 408/409/429/5xx, and timeouts
 * are themselves retried — so a single provider stall (rate-limit, 529
 * overloaded, or a transient error) could hold a request open for ~30 minutes.
 * The bot reply path is dispatched fire-and-forget from the webhook, so an
 * uncapped call there piles up in-process tasks under load and can degrade the
 * whole service. We fail fast instead: a tight timeout and a single retry.
 *
 * Use this everywhere instead of `new Anthropic({ apiKey })`.
 *
 * El techo se puede mover con `ANTHROPIC_TIMEOUT_MS`, y en producción no está
 * puesto: los 45 segundos siguen siendo el valor. Existe porque `ANTHROPIC_BASE_URL`
 * permite poner otra cosa del otro lado —una pasarela propia, un modelo local, un
 * banco de pruebas— y ahí el presupuesto correcto no es el de la API pública.
 * Fijarlo en el código convertía ese apuntador en algo inutilizable.
 */
function techoMs(): number {
  const crudo = Number(process.env.ANTHROPIC_TIMEOUT_MS);
  return Number.isFinite(crudo) && crudo > 0 ? crudo : 45_000;
}

export function getAnthropic(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, timeout: techoMs(), maxRetries: 1 });
}

/**
 * Cliente para los turnos que se transmiten en vivo.
 *
 * El de arriba corta a los 45 segundos, y ahí ese techo es correcto: la
 * respuesta a un cliente sale disparada desde el webhook y nadie la está
 * mirando, así que fallar rápido evita que un atasco del proveedor acumule
 * tareas en el proceso.
 *
 * Acá es al revés. Hay una persona mirando la pantalla, ve el texto aparecer, y
 * un turno con razonamiento y varias herramientas se pasa de 45 segundos sin
 * que nada esté mal. Cortarlo sería cortar algo que está funcionando delante de
 * quien lo pidió. Sin reintentos: reintentar un stream a medio camino
 * duplicaría lo que ya se mostró.
 */
export function getAnthropicStreaming(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, timeout: 10 * 60_000, maxRetries: 0 });
}

/**
 * Cliente para un subagente del equipo.
 *
 * Los diez minutos de arriba son correctos para el orquestador, que es lo que
 * la persona está leyendo. Para un subagente son demasiado: trabaja adentro de
 * un turno, con otros dos corriendo al mismo tiempo, y uno colgado se lleva
 * puesto el turno entero mientras los demás ya terminaron. Dos minutos alcanzan
 * de sobra para un encargo acotado y acotan el daño de uno que no vuelve.
 *
 * Sin reintentos, por lo mismo que el de arriba.
 */
export function getAnthropicSubagent(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, timeout: 2 * 60_000, maxRetries: 0 });
}
