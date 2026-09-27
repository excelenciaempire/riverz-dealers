/** A brief recovery does not make the same incident a new WhatsApp alert. */
export const ALERT_REPEAT_GUARD_MS = 24 * 60 * 60_000;
export type AlertHistory = Record<string, string>;
export function alertCandidates(
  keys: string[],
  history: AlertHistory,
  now = Date.now()
): string[] {
  return keys.filter((key) => {
    const previous = Date.parse(history[key] ?? '');
    return (
      !Number.isFinite(previous) || now - previous >= ALERT_REPEAT_GUARD_MS
    );
  });
}
export function rememberAlerts(
  history: AlertHistory,
  keys: string[],
  now = Date.now()
): AlertHistory {
  const out = Object.fromEntries(
    Object.entries(history).filter(
      ([, at]) => now - Date.parse(at) < 7 * ALERT_REPEAT_GUARD_MS
    )
  );
  for (const key of keys) out[key] = new Date(now).toISOString();
  return out;
}
