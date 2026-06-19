import crypto from "crypto";

/**
 * Parse + verify a Meta `signed_request` (used by the Data Deletion and
 * Deauthorize callbacks). Format: `<base64url(sig)>.<base64url(payload)>`,
 * where sig = HMAC-SHA256(payload, APP_SECRET). Returns the decoded payload
 * only if the signature is valid, else null.
 *
 * Docs: https://developers.facebook.com/docs/development/data-deletion-request-callback/
 */
export interface SignedRequestPayload {
  algorithm?: string;
  issued_at?: number;
  user_id?: string;
  [k: string]: unknown;
}

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function parseSignedRequest(
  signedRequest: string,
  appSecret: string,
): SignedRequestPayload | null {
  const dot = signedRequest.indexOf(".");
  if (dot < 0) return null;
  const encodedSig = signedRequest.slice(0, dot);
  const encodedPayload = signedRequest.slice(dot + 1);
  if (!encodedSig || !encodedPayload) return null;

  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(encodedPayload)
    .digest();
  const provided = base64UrlDecode(encodedSig);
  if (
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(provided, expected)
  ) {
    return null;
  }

  try {
    const json = base64UrlDecode(encodedPayload).toString("utf8");
    const data = JSON.parse(json) as SignedRequestPayload;
    if ((data.algorithm ?? "").toUpperCase() !== "HMAC-SHA256") return null;
    return data;
  } catch {
    return null;
  }
}

/** Public base URL of the current request, honoring the proxy headers. */
export function requestOrigin(req: Request): string {
  const host =
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host") ??
    "riverz.co";
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}
