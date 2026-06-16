import crypto from 'node:crypto'

/**
 * Verify the HMAC-SHA256 signature Meta attaches to webhook POSTs.
 *
 * Meta signs the raw request body with your App Secret and sends the
 * result in the `x-hub-signature-256: sha256=<hex>` header. Without
 * verification, anyone who knows our webhook URL can POST fabricated
 * status updates and drift broadcast counts arbitrarily.
 *
 * Reference:
 *   https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verify-payloads
 *
 * Contract:
 *   `META_APP_SECRET` is **required**. If it's missing we fail closed —
 *   every request is rejected until the operator configures the
 *   secret. A previous version fell open with a warning log, which is
 *   unsafe for a public template: anyone who forgets the env var would
 *   be running a fully spoofable webhook.
 */
export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  return verifyMetaWebhookSignatureDetailed(rawBody, signatureHeader, null).ok
}

/**
 * Reason buckets for a rejected Meta webhook delivery. Each is
 * actionable by the operator without leaking PII into logs.
 */
export type MetaSignatureRejection =
  | 'secret_unset'
  | 'missing_signature_header'
  | 'legacy_sha1_only'
  | 'wrong_signature_prefix'
  | 'signature_length_mismatch'
  | 'hmac_mismatch'

export type MetaSignatureResult =
  | { ok: true }
  | {
      ok: false
      reason: MetaSignatureRejection
      detail: {
        /** First 8 chars of the supplied signature header (or null). */
        signaturePrefix: string | null
        /** Algorithm prefix parsed from the supplied header. */
        algorithm: string | null
        /** True when the legacy sha1 header is present but sha256 isn't. */
        sha1HeaderPresent: boolean
      }
    }

/**
 * Verbose variant of `verifyMetaWebhookSignature` — used by the route
 * to log WHY a rejection happened (SHA1-only, missing header, wrong
 * prefix, hmac mismatch, …) without leaking PII from the body.
 */
export function verifyMetaWebhookSignatureDetailed(
  rawBody: string,
  signatureHeader: string | null,
  legacySha1Header: string | null,
): MetaSignatureResult {
  const secret = process.env.META_APP_SECRET
  if (!secret) {
    console.error(
      '[webhook] META_APP_SECRET is not set — rejecting request. ' +
        'Configure the env var (Meta → App Settings → Basic → App Secret) ' +
        'to enable signature verification.',
    )
    return {
      ok: false,
      reason: 'secret_unset',
      detail: {
        signaturePrefix: signatureHeader?.slice(0, 8) ?? null,
        algorithm: parseAlgorithm(signatureHeader),
        sha1HeaderPresent: !!legacySha1Header,
      },
    }
  }

  if (!signatureHeader) {
    return {
      ok: false,
      reason: legacySha1Header ? 'legacy_sha1_only' : 'missing_signature_header',
      detail: {
        signaturePrefix: null,
        algorithm: null,
        sha1HeaderPresent: !!legacySha1Header,
      },
    }
  }
  if (!signatureHeader.startsWith('sha256=')) {
    return {
      ok: false,
      reason: 'wrong_signature_prefix',
      detail: {
        signaturePrefix: signatureHeader.slice(0, 8),
        algorithm: parseAlgorithm(signatureHeader),
        sha1HeaderPresent: !!legacySha1Header,
      },
    }
  }

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(rawBody).digest('hex')

  const a = Buffer.from(signatureHeader)
  const b = Buffer.from(expected)
  // Bail if lengths differ — timingSafeEqual throws otherwise.
  if (a.length !== b.length) {
    return {
      ok: false,
      reason: 'signature_length_mismatch',
      detail: {
        signaturePrefix: signatureHeader.slice(0, 8),
        algorithm: 'sha256',
        sha1HeaderPresent: !!legacySha1Header,
      },
    }
  }
  if (crypto.timingSafeEqual(a, b)) return { ok: true }
  return {
    ok: false,
    reason: 'hmac_mismatch',
    detail: {
      signaturePrefix: signatureHeader.slice(0, 8),
      algorithm: 'sha256',
      sha1HeaderPresent: !!legacySha1Header,
    },
  }
}

function parseAlgorithm(header: string | null): string | null {
  if (!header) return null
  const eq = header.indexOf('=')
  return eq > 0 ? header.slice(0, eq) : null
}
