export function isDemoMode(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  return process.env.NEXT_PUBLIC_DEMO_MODE === 'true'
}
