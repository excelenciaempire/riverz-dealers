/** A run can start as onboarding and yield after its first commercial offer.
 * Only booleans enable the per-run override; imported text cannot do so. */
export function shouldStopRunOnInbound(triggerConfig: unknown, context: unknown): boolean {
  const cfg = triggerConfig as { stop_on_inbound?: unknown } | null
  const run = context as { vars?: { stop_on_inbound?: unknown } } | null
  return cfg?.stop_on_inbound === true || run?.vars?.stop_on_inbound === true
}
