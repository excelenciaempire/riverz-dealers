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
