import { createHmac, timingSafeEqual } from 'crypto'
import { normalizeShopDomain } from '@/lib/shopify/oauth'

/**
 * Verify a Shopify App Bridge session token (JWT, HS256 signed with the
 * app's API secret). These tokens authenticate requests coming from the
 * embedded page inside Shopify admin — Shopify mints one per minute per
 * user, and the payload pins the shop (`dest`) and our app (`aud`).
 *
 * Reference shape:
 *   { iss: "https://{shop}.myshopify.com/admin",
 *     dest: "https://{shop}.myshopify.com",
 *     aud: "<api key>", sub: "<user id>",
 *     exp, nbf, iat, jti, sid }
 *
 * Implemented with node:crypto directly (HS256 = HMAC-SHA256) to avoid a
 * JWT dependency for a single fixed-algorithm verification.
 */

const CLOCK_SKEW_S = 10

interface SessionTokenPayload {
  iss?: string
  dest?: string
  aud?: string | string[]
  sub?: string
  exp?: number
  nbf?: number
}

function b64urlToBuffer(s: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null
  try {
    return Buffer.from(s, 'base64url')
  } catch {
    return null
  }
}

/**
 * Returns the canonical `*.myshopify.com` shop domain the token was
 * minted for, or null when the token is invalid/expired/not ours.
 */
export function verifySessionToken(
  token: string,
  args: { apiKey: string; apiSecret: string },
): { shop: string; sub: string | null } | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [headerB64, payloadB64, signatureB64] = parts

  const signature = b64urlToBuffer(signatureB64)
  if (!signature) return null
  const expected = createHmac('sha256', args.apiSecret)
    .update(`${headerB64}.${payloadB64}`, 'utf8')
    .digest()
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(signature, expected)
  ) {
    return null
  }

  const headerBuf = b64urlToBuffer(headerB64)
  const payloadBuf = b64urlToBuffer(payloadB64)
  if (!headerBuf || !payloadBuf) return null

  let header: { alg?: string }
  let payload: SessionTokenPayload
  try {
    header = JSON.parse(headerBuf.toString('utf8'))
    payload = JSON.parse(payloadBuf.toString('utf8'))
  } catch {
    return null
  }
  if (header.alg !== 'HS256') return null

  const now = Math.floor(Date.now() / 1000)
  if (typeof payload.exp !== 'number' || now > payload.exp + CLOCK_SKEW_S)
    return null
  if (typeof payload.nbf === 'number' && now < payload.nbf - CLOCK_SKEW_S)
    return null

  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (!aud.includes(args.apiKey)) return null

  // dest pins the shop; iss must live under it (defense in depth).
  if (!payload.dest || !payload.iss) return null
  let destHost: string
  try {
    destHost = new URL(payload.dest).host
  } catch {
    return null
  }
  const shop = normalizeShopDomain(destHost)
  if (!shop) return null
  if (!payload.iss.startsWith(`https://${destHost}/`)) return null

  return { shop, sub: payload.sub ?? null }
}
