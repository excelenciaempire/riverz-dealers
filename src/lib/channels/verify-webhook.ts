import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Channel } from "@/types";
import {
  verifyMetaWebhookSignatureDetailed,
  type MetaSignatureRejection,
} from "@/lib/whatsapp/webhook-signature";

/**
 * Channel webhook verification — the floor. Every public POST against
 * /api/channels/:channel/webhook MUST pass through here before the
 * adapter parses anything. Adapters can re-verify per-event if they want
 * extra hardening (e.g. Outlook's clientState echo), but they can no
 * longer be the only line of defense.
 *
 * Returns `{ ok: true }` on a verified delivery. On rejection we return
 * `{ ok: false, reason }` so the caller can log it and ack 200 — re-driving
 * signed retries against a misconfigured secret only amplifies the problem.
 *
 * For Meta channels, `detail` is also populated so the route can log
 * exactly which failure mode happened (SHA1-only header, missing
 * header, wrong prefix, hmac mismatch) without leaking PII from the
 * body.
 */
export type ChannelVerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      detail?: {
        signaturePrefix: string | null;
        algorithm: string | null;
        sha1HeaderPresent: boolean;
      };
    };

const META_CHANNELS: ReadonlySet<Channel> = new Set([
  "whatsapp",
  "messenger",
  "instagram",
  "fb_comment",
  "ig_comment",
]);

export async function verifyChannelWebhook(
  channel: Channel,
  request: Request,
  rawBody: string,
): Promise<ChannelVerifyResult> {
  if (META_CHANNELS.has(channel)) {
    const signature = request.headers.get("x-hub-signature-256");
    const legacySignature = request.headers.get("x-hub-signature");
    const verdict = verifyMetaWebhookSignatureDetailed(
      rawBody,
      signature,
      legacySignature,
    );
    if (!verdict.ok) {
      return {
        ok: false,
        reason: metaRejectionLabel(verdict.reason),
        detail: verdict.detail,
      };
    }
    return { ok: true };
  }

  if (channel === "gmail") {
    // The unified route is not the production Gmail entry point — Pub/Sub
    // hits /api/channels/gmail/push directly — but the channel is in the
    // VALID list so we still enforce a hardened secret-query check here
    // in case anyone routes traffic this way.
    const url = new URL(request.url);
    const supplied = url.searchParams.get("secret") ?? "";
    const expected = process.env.GMAIL_PUSH_SECRET ?? "";
    if (!expected) return { ok: false, reason: "GMAIL_PUSH_SECRET not set" };
    if (!timingSafeStringEqual(supplied, expected)) {
      return { ok: false, reason: "gmail secret mismatch" };
    }
    return { ok: true };
  }

  if (channel === "outlook") {
    // Microsoft Graph notifications don't sign the body — they prove
    // authenticity by echoing a `clientState` value we set at subscription
    // time. The adapter performs the per-notification check against
    // OUTLOOK_PUSH_CLIENT_STATE; route-level all we can do is allow the
    // call through so the validationToken handshake (handled in the route
    // before this function runs) and the body parse can both happen.
    return { ok: true };
  }

  if (channel === "sms") {
    // SMS is a stub — no inbound webhook exists yet. Reject so a misrouted
    // call can't sneak past unverified.
    return { ok: false, reason: "sms channel not configured" };
  }

  return { ok: false, reason: `no verifier for channel ${channel}` };
}

/**
 * Map the verbose rejection enum to a stable log label. Keep these
 * snake_case so they're easy to grep + alert on in log aggregators.
 */
function metaRejectionLabel(reason: MetaSignatureRejection): string {
  switch (reason) {
    case "secret_unset":
      return "meta_secret_unset";
    case "missing_signature_header":
      return "meta_missing_signature_header";
    case "legacy_sha1_only":
      return "meta_legacy_sha1_only";
    case "wrong_signature_prefix":
      return "meta_wrong_signature_prefix";
    case "signature_length_mismatch":
      return "meta_signature_length_mismatch";
    case "hmac_mismatch":
      return "meta_hmac_mismatch";
  }
}

/**
 * Length-padded SHA-256 compare. We hash both sides so the buffers
 * timingSafeEqual sees are always 32 bytes — neither the secret nor its
 * length can be inferred from response time.
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  if (ha.length !== hb.length) return false;
  return timingSafeEqual(ha, hb);
}

/**
 * Shopify HMAC-SHA256 base64 verifier — exported for future use when the
 * unified route starts handling the Shopify channel. Today every Shopify
 * webhook lives under /api/shopify/webhooks/* with its own verifier, so
 * this is not wired into verifyChannelWebhook yet.
 */
export function verifyShopifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string | undefined,
): boolean {
  if (!secret) return false;
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
