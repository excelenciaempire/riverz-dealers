import type { AutomationLogStepResult } from '@/types'

/** A completed scope is not necessarily a completed run. */
export function settledLogStatus(
  results: Pick<AutomationLogStepResult, 'status'>[],
  pendingCount: number,
  previousStatus?: string | null,
): 'success' | 'partial' | 'failed' {
  if (previousStatus === 'failed' || results.some(r => r.status === 'failed')) return 'failed'
  return pendingCount > 0 ? 'partial' : 'success'
}
