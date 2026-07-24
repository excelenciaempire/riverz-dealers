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

/**
 * Like {@link assertCronAuth} but accepts the `x-cron-secret` if it matches ANY
 * of the configured env secrets. Guards against a config footgun where the cron
 * service sends one secret name (e.g. CRON_SECRET) while a route was pinned to a
 * differently-named env — a mismatch would silently 401 every run and the job
 * would never fire. All names are the operator's own trusted cron secrets, so
 * accepting any is no weaker. Passes only if at least one name is configured.
 */
export function assertCronAuthAny(req: Request, secretEnvNames: string[]): void {
  const configured = secretEnvNames
    .map((n) => process.env[n])
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
  if (configured.length === 0) {
    throw new Response('Cron not configured', { status: 503 })
  }
  const supplied = req.headers.get('x-cron-secret') ?? ''
  if (!configured.some((expected) => safeSecretEqual(supplied, expected))) {
    throw new Response('Unauthorized', { status: 401 })
  }
}
