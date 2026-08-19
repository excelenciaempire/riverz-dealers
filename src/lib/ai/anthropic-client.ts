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
 */
export function getAnthropic(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 });
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
