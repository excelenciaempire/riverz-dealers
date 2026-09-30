import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { resumePendingExecution } from '@/lib/automations/engine'
import type { AutomationContext } from '@/lib/automations/engine'
import { assertCronAuth } from '@/lib/auth/cron'
import { withCronRun } from "@/lib/cron/heartbeat";
import { serverError } from '@/lib/api/errors'
import { drainAutomationEvents, enqueueScheduledAutomations } from '@/lib/automations/event-worker'

/**
 * Drain due `automation_pending_executions` rows. Hit every minute by
 * the in-process scheduler (`src/lib/cron/schedule.ts`) — requires a
 * shared secret via the `x-cron-secret` header to match
 * `AUTOMATION_CRON_SECRET`.
 *
 * The claim step (status = 'running') serves as a simple lock so
 * overlapping invocations don't double-process rows. Best-effort
 * only; expensive SELECT ... FOR UPDATE is avoided in favor of a
 * two-step UPDATE-by-id.
 */
async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET')
  } catch (r) {
    if (r instanceof Response) return r
    throw r
  }

  const admin = supabaseAdmin()
  const followups = await admin.rpc('process_due_inbox_followups', { p_limit: 100 })
  if (followups.error) return serverError(followups.error)
  const assignments = await admin.rpc('dispatch_waiting_inbox_cases', { p_limit: 100 })
  if (assignments.error) return serverError(assignments.error)
  let events: { processed: number; failed: number }
  let scheduled: number
  try {
    scheduled = await enqueueScheduledAutomations(admin)
    events = await drainAutomationEvents(admin)
  } catch (error) { return serverError(error) }
  const { data: due, error } = await admin
    .from('automation_pending_executions')
    .select('*, automations!inner(is_active,deleted_at)')
    .eq('automations.is_active', true)
    .is('automations.deleted_at', null)
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true })
    .limit(50)

  if (error) return serverError(error)

  let processed = 0
  for (const row of due ?? []) {
    const { data: claim } = await admin
      .from('automation_pending_executions')
      .update({ status: 'running' })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!claim) continue

    await resumePendingExecution({
      id: row.id as string,
      automation_id: row.automation_id as string,
      workspace_id: (row.workspace_id ?? row.user_id) as string,
      contact_id: (row.contact_id as string | null) ?? null,
      log_id: (row.log_id as string | null) ?? null,
      parent_step_id: (row.parent_step_id as string | null) ?? null,
      branch: (row.branch as 'yes' | 'no' | null) ?? null,
      next_step_position: row.next_step_position as number,
      context: (row.context as AutomationContext) ?? {},
    })
    processed++
  }

  return NextResponse.json({ processed, scheduled, events, followups: followups.data, assignments: assignments.data }, { status: events.failed ? 207 : 200 })
}

/** Registra la corrida en cron_runs con duración y resultado reales. */
export const GET = withCronRun("automations", cronHandler);
