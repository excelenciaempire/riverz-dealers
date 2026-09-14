import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { buildRetentionPlan } from '../src/lib/automations/retention-plan'
import { loadStepsTree, replaceSteps, type BuilderStepInput } from '../src/lib/automations/steps-tree'
import { activationIssues } from '../src/lib/automations/activation'

// This migration is intentionally restricted to Pilar's first-day cursors.
// It never activates, sends, resets dates, or replays completed enrollment.
const workspace = '522a68ae-568d-4dd9-92e5-2c8f633f1761'
const id = 'fb865aa4-f84a-405c-8fc1-88157e334a3c'
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
async function main() {
  const { data: automation, error } = await db.from('automations').select('*')
    .eq('workspace_id', workspace).eq('id', id).is('deleted_at', null).single()
  if (error) throw error
  if (automation.is_active || automation.activation_state !== 'draft') throw Error('Pause Pilar before migrating')
  if (automation.trigger_config.retention_layout_version === 2) { console.log('Already compacted'); return }
  const old = await loadStepsTree(id)
  const pending = await db.from('automation_pending_executions').select('*').eq('workspace_id', workspace).eq('automation_id', id)
  const logs = await db.from('automation_logs').select('*').eq('workspace_id', workspace).eq('automation_id', id)
  if (pending.error || logs.error) throw pending.error ?? logs.error
  if (pending.data.some(p => p.status === 'running')) throw Error('An execution is still running')
  if (logs.data.some(l => l.steps_executed?.some((s: { step_type: string }) => s.step_type === 'send_template'))) throw Error('Review runs beyond enrollment before migrating')
  const flat: BuilderStepInput[] = []
  const visit = (nodes: BuilderStepInput[]) => nodes.forEach(s => { flat.push(s); visit(s.branches?.yes ?? []); visit(s.branches?.no ?? []) })
  visit(old)
  const quantityIds = flat.filter(s => s.step_config.operand === 'retention_units').map(s => s.id)
  if (pending.data.some(p => p.next_step_position !== 2 || p.branch !== 'yes' || !quantityIds.includes(p.parent_step_id))) throw Error('Unexpected continuation; no changes made')
  const enrolled = flat.find(s => s.step_type === 'add_tag')?.step_config.tag_id
  if (typeof enrolled !== 'string') throw Error('Enrollment tag missing')
  const plan = buildRetentionPlan({ locale: 'es', prefix: 'pilar_postventa_v1', product: 'Serum Pilar',
    offers: [{ units: 1, day: 22, label: '1 unidad' }, { units: 3, day: 82, label: '2 unidades + 1 gratis' }, { units: 4, day: 112, label: '3 unidades + 1 gratis' }],
    tags: { enrolled, paused: automation.trigger_config.retention_pause_tag, permission: '', help: '' } })
  const next = plan.flows[0].steps
  const assign = (nodes: BuilderStepInput[]) => nodes.forEach(s => { s.id = randomUUID(); assign(s.branches?.yes ?? []); assign(s.branches?.no ?? []) })
  assign(next)
  const issues = activationIssues({ triggerType: automation.trigger_type, triggerConfig: automation.trigger_config, steps: next })
  if (issues.length) throw Error(JSON.stringify(issues))
  const summary = { previousNodes: flat.length, nextNodes: JSON.stringify(next).match(/"step_type"/g)?.length,
    runs: logs.data.length, pending: pending.data.filter(p => p.status === 'pending').length,
    stoppedByReply: logs.data.filter(l => l.steps_executed?.some((s: { detail?: string }) => s.detail === 'cancelled by inbound reply')).length,
    sends: 0, active: false }
  console.log(JSON.stringify(summary))
  if (!process.argv.includes('--apply')) return
  await mkdir('output/retention', { recursive: true })
  const backup = `output/retention/pilar-before-compact-${Date.now()}.json`
  await writeFile(backup, JSON.stringify({ automation, steps: old, pending: pending.data, logs: logs.data }, null, 2), 'utf8')
  try {
    const replaced = await replaceSteps(id, next)
    if (replaced) throw Error(replaced)
    for (const p of pending.data) {
      // Includes stopped rows: their AI handoff tokens may resume this cursor.
      const r = await db.from('automation_pending_executions').update({ parent_step_id: next[0].id })
        .eq('workspace_id', workspace).eq('automation_id', id).eq('id', p.id)
        .eq('next_step_position', 2).select('id')
      if (r.error || r.data?.length !== 1) throw Error(r.error?.message ?? 'Cursor changed during migration')
    }
    const changed = await db.from('automations').update({ trigger_config: { ...automation.trigger_config, retention_layout_version: 2 } })
      .eq('workspace_id', workspace).eq('id', id).eq('is_active', false).eq('updated_at', automation.updated_at).select('id')
    if (changed.error || changed.data?.length !== 1) throw Error('Automation changed during migration')
    const verify = await db.from('automation_pending_executions').select('id,parent_step_id,next_step_position,run_at,status')
      .eq('workspace_id', workspace).eq('automation_id', id)
    if (verify.error || verify.data.length !== pending.data.length || verify.data.some(p =>
      p.parent_step_id !== next[0].id || p.next_step_position !== 2 || p.run_at !== pending.data.find(old => old.id === p.id)?.run_at)) throw Error('Continuation verification failed')
    const waiting = verify.data.filter(p => p.status === 'pending').map(p => pending.data.find(old => old.id === p.id)!.log_id)
    if (waiting.length) {
      const fixed = await db.from('automation_logs').update({ status: 'partial' }).eq('workspace_id', workspace)
        .eq('automation_id', id).in('id', waiting).eq('status', 'success')
      if (fixed.error) throw fixed.error
    }
  } catch (error) {
    const restored = await replaceSteps(id, old)
    const failures: string[] = restored ? [restored] : []
    for (const p of pending.data) {
      const r = await db.from('automation_pending_executions').update({ parent_step_id: p.parent_step_id })
        .eq('workspace_id', workspace).eq('automation_id', id).eq('id', p.id)
      if (r.error) failures.push(r.error.message)
    }
    const reset = await db.from('automations').update({ trigger_config: automation.trigger_config })
      .eq('workspace_id', workspace).eq('id', id).eq('is_active', false)
    if (reset.error) failures.push(reset.error.message)
    if (failures.length) throw Error(`Restore needs review: ${backup}; ${failures.join('; ')}`)
    throw error
  }
  console.log(JSON.stringify({ migrated: true, ...summary, backup }))
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })
