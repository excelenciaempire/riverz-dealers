/**
 * Thin re-export wrapper around the runner's internal advance helper.
 * Kept separate so the cron route can reach `advanceFromNodeKey`
 * without engine.ts having to be its own public surface.
 *
 * The actual implementation stays in engine.ts; this file's only job
 * is to bridge the cron's resume path back into the same advance loop
 * the live webhook uses, so a parked `wait` node resumes with all the
 * same logging, optimistic-lock, and error-handling semantics.
 */

import { supabaseAdmin } from './admin-client'
import type { FlowNodeRow, FlowRunRow } from './types'

export async function advanceParkedRun(
  run: FlowRunRow,
  nextNodeKey: string,
  nodes: Map<string, FlowNodeRow>,
): Promise<void> {
  // Drop our circular dep on engine.ts by lazy-loading it. The cron
  // path is single-shot so the import cost is negligible.
  const engine = (await import('./engine')) as unknown as {
    __advanceFromNodeKeyForResume?: typeof advanceForResumeRef
  }
  if (typeof engine.__advanceFromNodeKeyForResume !== 'function') {
    throw new Error(
      'flows engine did not expose __advanceFromNodeKeyForResume — check engine.ts export',
    )
  }
  const db = supabaseAdmin()
  await engine.__advanceFromNodeKeyForResume(db, run, nextNodeKey, nodes)
}

// Phantom — used only for the typeof above so the import contract is
// type-checked at compile time.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare function advanceForResumeRef(
  db: ReturnType<typeof supabaseAdmin>,
  run: FlowRunRow,
  startNodeKey: string,
  nodes: Map<string, FlowNodeRow>,
): Promise<{ outcome: 'advanced' | 'completed' | 'handed_off' }>
