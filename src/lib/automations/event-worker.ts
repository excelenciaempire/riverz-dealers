import type { SupabaseClient } from '@supabase/supabase-js'
import { automationScheduleSlot } from './schedule'
import { runAutomationById, type AutomationContext } from './engine'

export async function enqueueScheduledAutomations(db: SupabaseClient, at = new Date()): Promise<number> {
  let cursor = ''
  let queued = 0
  for (;;) {
    let query = db.from('automations').select('id,trigger_config,workspaces!inner(timezone)')
      .eq('trigger_type', 'time_based').eq('is_active', true).is('deleted_at', null)
      .order('id').limit(200)
    if (cursor) query = query.gt('id', cursor)
    const { data, error } = await query
    if (error) throw new Error(error.message)
    for (const row of data ?? []) {
      const cfg = (row.trigger_config ?? {}) as Record<string, unknown>
      const ws = row.workspaces as unknown as { timezone: string }
      const slot = automationScheduleSlot(cfg.schedule, String(cfg.timezone ?? ws.timezone), at)
      if (!slot) continue
      const result = await db.rpc('enqueue_automation_schedule', { p_automation_id: row.id, p_slot: slot })
      if (result.error) throw new Error(result.error.message)
      queued += Number(result.data ?? 0)
    }
    if (!data || data.length < 200) return queued
    cursor = String(data[data.length - 1].id)
  }
}

export async function drainAutomationEvents(db: SupabaseClient): Promise<{ processed: number; failed: number }> {
  const claimed = await db.rpc('claim_automation_events', { p_limit: 40 })
  if (claimed.error) throw new Error(claimed.error.message)
  let processed = 0
  let failed = 0
  for (const row of claimed.data ?? []) {
    let status = 'failed'
    let reason: string | null = null
    try {
      const result = await runAutomationById({
        automationId: row.automation_id, contactId: row.contact_id,
        workspaceId: row.workspace_id, eventType: row.event_type,
        context: { ...(row.context as AutomationContext), event_id: row.id },
      })
      status = result.executed ? 'completed' : result.reason === 'error' ? 'failed' : 'skipped'
      reason = result.reason ?? null
      if (result.executed) {
        const log = await db.from('automation_logs').select('status').eq('id', row.id)
          .eq('workspace_id', row.workspace_id).maybeSingle()
        if (log.error) throw new Error(log.error.message)
        if (!log.data) { status = 'skipped'; reason = 'execution_guard' }
        else if (log.data.status === 'failed') { status = 'failed'; reason = 'step_failed' }
      }
    } catch {
      reason = 'error'
    }
    const saved = await db.from('automation_event_jobs').update({ status, reason, finished_at: new Date().toISOString() })
      .eq('id', row.id).eq('status', 'running')
    if (saved.error) throw new Error(saved.error.message)
    if (status === 'failed') failed++
    processed++
  }
  return { processed, failed }
}
