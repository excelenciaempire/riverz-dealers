import { createHash, timingSafeEqual } from 'node:crypto'

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

/**
 * Constant-time comparison of two secrets. Hashea ambos lados a 32 bytes
 * antes de `timingSafeEqual`, así no filtra longitud ni contenido por
 * timing. Para secretos que no llegan en el header `x-cron-secret`
 * (p.ej. el `?secret=` de Pub/Sub que no permite headers custom).
 */
export function safeSecretEqual(
  supplied: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!expected) return false
  const a = sha256(supplied ?? '')
  const b = sha256(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Verify the `x-cron-secret` header against the expected env value.
 *
 * Compares SHA-256 digests via `timingSafeEqual` so both buffers are
 * always the same length (32 bytes) and response time leaks neither
 * the secret nor its length. Throws a `Response` (401) on mismatch
 * so route handlers can `try { assertCronAuth(...) } catch (r) { return r }`
 * or just `throw` it up to Next.
 */
export function assertCronAuth(req: Request, secretEnvName: string): void {
  const expected = process.env[secretEnvName]
  if (!expected) {
    throw new Response('Cron not configured', { status: 503 })
  }
  const supplied = req.headers.get('x-cron-secret') ?? ''
  if (!safeSecretEqual(supplied, expected)) {
    throw new Response('Unauthorized', { status: 401 })
  }
}
