import { createHash } from 'node:crypto';

/** A bad credential cannot recover by trying the next contact two seconds later.
 * Cache only failures, keyed by credential; rotating a key retries immediately.
 * This is a per-process guard, not a durable incident or a successful sync. */
const failures = new Map<string, { until: number; reason: string; status?: number }>();
const keyId = (key: string) => createHash('sha256').update(key).digest('hex');

export function getProviderCooldown(key: string, now = Date.now()) {
  const id = keyId(key);
  const failure = failures.get(id);
  if (failure && failure.until > now) return failure;
  failures.delete(id);
  return null;
}

export function setProviderCooldown(
  key: string,
  reason: string,
  status?: number,
  now = Date.now(),
) {
  const duration = reason === 'authentication' || reason === 'billing'
    ? 15 * 60_000 : reason === 'rate_limit' ? 60_000 : 0;
  if (!duration) return;
  for (const [id, failure] of failures) if (failure.until <= now) failures.delete(id);
  if (failures.size >= 1_000) failures.delete(failures.keys().next().value!);
  failures.set(keyId(key), { reason, status, until: now + duration });
}
