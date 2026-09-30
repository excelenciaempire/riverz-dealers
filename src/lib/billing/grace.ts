export const DEFAULT_GRACE_HOURS = 24;
export const MAX_GRACE_HOURS = 720;
export function validGraceHours(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= DEFAULT_GRACE_HOURS && value <= MAX_GRACE_HOURS;
}
export function resolvedGraceHours(value: unknown): number {
  return validGraceHours(value) ? value : DEFAULT_GRACE_HOURS;
}
