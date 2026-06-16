import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { resumeFlowRun } from '@/lib/flows/resume'
import { assertCronAuth } from '@/lib/auth/cron'
import { nextRetryDelayMs } from '@/lib/flows/engine'

/**
 * Drain due `flow_pending_executions` rows — the `wait` flow node
 * inserts them with `run_at` set to now + delta. Hit on a schedule
 * (Vercel Cron / external pinger) with the shared `x-cron-secret`
 * header matching `AUTOMATION_CRON_SECRET`.
 *
 * Mirrors the automations cron route: two-step claim (UPDATE to
 * 'running' filtered by 'pending') prevents double-processing under
 * overlapping invocations without needing FOR UPDATE locks.
 */
export async function GET(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET')
  } catch (r) {
    if (r instanceof Response) return r
    throw r
  }

  const admin = supabaseAdmin()
  const { data: due, error } = await admin
    .from('flow_pending_executions')
    .select('*')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true })
    .limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!due || due.length === 0) return NextResponse.json({ processed: 0 })

  let processed = 0
  for (const row of due) {
    const { data: claim } = await admin
      .from('flow_pending_executions')
      .update({ status: 'running' })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!claim) continue

    try {
      await resumeFlowRun({
        flowRunId: row.flow_run_id as string,
        nextNodeKey: row.next_node_key as string,
      })
      await admin
        .from('flow_pending_executions')
        .update({ status: 'done' })
        .eq('id', row.id)
      processed++
    } catch (err) {
      // Migration 059 added `attempt` + `max_attempts` + `last_error`.
      // Use the same exponential backoff as the sibling retries cron
      // instead of marking permanently failed on the first throw.
      const errMsg = err instanceof Error ? err.message : String(err)
      const attempt =
        ((row as { attempt?: number }).attempt ?? 0) + 1
      const maxAttempts = (row as { max_attempts?: number }).max_attempts ?? 3
      if (attempt >= maxAttempts) {
        await admin
          .from('flow_pending_executions')
          .update({
            status: 'failed',
            attempt,
            last_error: errMsg.slice(0, 500),
          })
          .eq('id', row.id)
      } else {
        const runAt = new Date(Date.now() + nextRetryDelayMs(attempt)).toISOString()
        await admin
          .from('flow_pending_executions')
          .update({
            status: 'pending',
            attempt,
            run_at: runAt,
            last_error: errMsg.slice(0, 500),
          })
          .eq('id', row.id)
      }
      console.error('[flows] resume failed:', errMsg)
    }
  }

  return NextResponse.json({ processed })
}
