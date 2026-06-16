import { supabaseAdmin } from "@/lib/channels/admin-client";

/**
 * Persist a webhook delivery whose processing threw AFTER signature
 * verification, into `webhook_events_raw` (migration 059), so a Supabase
 * blip (or any unexpected exception) mid-processing doesn't silently lose
 * the event. The raw body + headers are kept for inspection and manual
 * replay.
 *
 * NOTE: this is capture-for-recovery, not auto-replay. Re-running a
 * Meta/Shopify delivery is only safe where the receiver is idempotent;
 * sending a WhatsApp message has no idempotency key, so automatic replay
 * could double-send. Operators replay deliberately from this table.
 *
 * Best-effort: never throws — the caller is already in a failure path and
 * must still ack the provider (200) to avoid a retry storm.
 */
export async function captureWebhookFailure(args: {
  provider: string;
  rawBody: string;
  signature?: string | null;
  headers?: Record<string, string>;
  error?: unknown;
}): Promise<void> {
  try {
    await supabaseAdmin()
      .from("webhook_events_raw")
      .insert({
        provider: args.provider,
        raw_body: args.rawBody.slice(0, 1_000_000),
        signature: args.signature ?? null,
        headers: args.headers ?? null,
        last_error:
          args.error instanceof Error
            ? args.error.message.slice(0, 1000)
            : args.error
              ? String(args.error).slice(0, 1000)
              : null,
      });
  } catch {
    /* best-effort — do not mask the original failure */
  }
}
