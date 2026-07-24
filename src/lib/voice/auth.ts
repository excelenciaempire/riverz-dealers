/**
 * Voice AI — shared-secret auth for the worker → web internal endpoints.
 * The Python worker sends `Authorization: Bearer ${VOICE_WORKER_SECRET}`.
 */
import { safeSecretEqual } from '@/lib/auth/cron';

/**
 * Throws a 401/503 `Response` when the request isn't an authenticated
 * worker call. Route handlers do `try { assertVoiceWorkerAuth(req) }
 * catch (r) { if (r instanceof Response) return r; throw r }`.
 */
export function assertVoiceWorkerAuth(req: Request): void {
  const expected = process.env.VOICE_WORKER_SECRET;
  if (!expected) {
    throw new Response('Voice worker not configured', { status: 503 });
  }
  const header = req.headers.get('authorization') ?? '';
  const supplied = header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : '';
  if (!safeSecretEqual(supplied, expected)) {
    throw new Response('Unauthorized', { status: 401 });
  }
}
