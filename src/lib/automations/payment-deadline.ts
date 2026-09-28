/** Optional deadlines keep payment reminders from surviving an expired payment window. */
export function paymentStartedAt(
  vars: Record<string, unknown> | undefined,
  fallback: string
): string {
  for (const key of ['order_created_at', 'rejected_at', 'payment_created_at']) {
    const value = vars?.[key];
    if (typeof value === 'string' && Number.isFinite(Date.parse(value)))
      return value;
  }
  return fallback;
}

export function templatePastDeadline(
  config: { expires_after_hours?: unknown },
  startedAt: string,
  now: number
): boolean {
  const hours = Number(config.expires_after_hours);
  if (!Number.isFinite(hours) || hours <= 0) return false;
  const started = Date.parse(startedAt);
  return !Number.isFinite(started) || now >= started + hours * 3_600_000;
}

export function anchoredWait(
  config: { from_trigger_hours?: unknown },
  startedAt: string,
  fallback: Date
): Date {
  const hours = Number(config.from_trigger_hours);
  const started = Date.parse(startedAt);
  return Number.isFinite(hours) && hours > 0 && Number.isFinite(started)
    ? new Date(started + hours * 3_600_000)
    : fallback;
}
