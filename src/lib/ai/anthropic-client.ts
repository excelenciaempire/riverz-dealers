import type { BillingContext } from '@/lib/wallet/operacion';
import Anthropic from '@anthropic-ai/sdk';
import { meteredAnthropicFetch } from './metered-fetch';
import { guardedAnthropicFetch } from './guarded-fetch';

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

export function getAnthropic(
  apiKey: string,
  billing?: BillingContext
): Anthropic {
  return new Anthropic({
    apiKey,
    fetch: billing
      ? guardedAnthropicFetch(meteredAnthropicFetch(billing))
      : async () => {
          throw new Error('wallet_billing_context_required');
        },
    timeout: techoMs(),
    // Un reintento, como dice el comentario de arriba. Estaba en cero: el
    // 2026-09-15 tres "Connection error." —la conexión se cayó antes de que
    // la API contestara nada— salieron al cliente como "en un momento te
    // responde una persona", a un "Hola buenas tardes" y a un sticker de
    // agradecimiento. Reintentar una llamada que no llegó no duplica nada.
    maxRetries: 1,
  });
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
export function getAnthropicStreaming(
  apiKey: string,
  billing?: BillingContext
): Anthropic {
  return new Anthropic({
    apiKey,
    fetch: billing
      ? guardedAnthropicFetch(meteredAnthropicFetch(billing))
      : async () => {
          throw new Error('wallet_billing_context_required');
        },
    timeout: 10 * 60_000,
    maxRetries: 0,
  });
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
export function getAnthropicSubagent(
  apiKey: string,
  billing?: BillingContext
): Anthropic {
  return new Anthropic({
    apiKey,
    fetch: billing
      ? guardedAnthropicFetch(meteredAnthropicFetch(billing))
      : async () => {
          throw new Error('wallet_billing_context_required');
        },
    timeout: 2 * 60_000,
    maxRetries: 0,
  });
}

/**
 * El mensaje de un error del SDK, con la causa de verdad.
 *
 * Todo lo que lanza el `fetch` a medida —la reserva de la billetera que
 * falla, `sin_saldo`, el conteo de tokens que devuelve 5xx— el SDK lo
 * envuelve en `APIConnectionError` con el texto genérico "Connection error.",
 * y ESO era lo que quedaba en `ai_replies.error` y en el caso escalado. El
 * 2026-09-17 hubo catorce "Connection error." en un día y no se podía saber
 * cuáles eran la base colgada y cuáles la billetera. La causa viaja en
 * `cause`; acá se la saca.
 */
export function mensajeDeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const causa = (err as { cause?: unknown }).cause;
  if (causa instanceof Error && causa.message && causa.message !== err.message) {
    return `${err.message} (${causa.message})`;
  }
  return err.message;
}
