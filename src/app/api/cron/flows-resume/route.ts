import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { resumeFlowRun } from '@/lib/flows/resume'

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
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret')
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
      await admin
        .from('flow_pending_executions')
        .update({ status: 'failed' })
        .eq('id', row.id)
      console.error('[flows] resume failed:', err)
    }
  }

  return NextResponse.json({ processed })
}
