import { createHash, timingSafeEqual } from 'node:crypto'

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
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
  const a = sha256(supplied)
  const b = sha256(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Response('Unauthorized', { status: 401 })
  }
}
