import { createClient } from '@supabase/supabase-js'
import { mkdir, writeFile } from 'node:fs/promises'
import { loadStepsTree, replaceSteps } from '../src/lib/automations/steps-tree'
import { activationIssues } from '../src/lib/automations/activation'

const workspace = '522a68ae-568d-4dd9-92e5-2c8f633f1761'
const id = 'fb865aa4-f84a-405c-8fc1-88157e334a3c'
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
async function main() {
  const result = await db.from('automations').select('*').eq('workspace_id', workspace).eq('id', id).is('deleted_at', null).single()
  if (result.error) throw result.error
  const row = result.data
  if (row.trigger_config.retention_ai_managed === true) { console.log('Already uses AI handoff'); return }
  if (row.is_active || row.trigger_config.retention_installation !== 'pilar_postventa_v1') throw new Error('Expected inactive Pilar reorder draft')
  const pending = await db.from('automation_pending_executions').select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspace).eq('automation_id', id).in('status', ['pending', 'running'])
  if (pending.error || pending.count !== 0) throw new Error('Pending executions require review')
  const oldSteps = await loadStepsTree(id)
  const main = oldSteps.find(s => s.step_type === 'condition' && s.step_config.operand === 'automation_entry' && s.step_config.value === 'main')
  const steps = main?.branches?.yes
  if (!steps?.length) throw new Error('Main journey not found')
  const tag = await db.from('tags').select('id').eq('workspace_id', workspace).eq('name', 'pilar_postventa_v1: postventa permiso verificado').single()
  if (tag.error) throw tag.error
  const config = { ...row.trigger_config, stop_on_inbound: true, retention_ai_managed: true, retention_permission_tag: tag.data.id }
  delete config.event_entries
  delete config.event_triggers
  const issues = activationIssues({ triggerType: row.trigger_type, triggerConfig: config, steps })
  if (issues.length) throw new Error(JSON.stringify(issues))
  await mkdir('output/retention', { recursive: true })
  await writeFile('output/retention/pilar-before-ai-handoff.json', JSON.stringify({ row, steps: oldSteps }, null, 2), 'utf8')
  if (!process.argv.includes('--apply')) { console.log(JSON.stringify({ id, previousRoots: oldSteps.length, newRoots: steps.length, mode: 'preview' })); return }
  try {
    const error = await replaceSteps(id, steps)
    if (error) throw new Error(error)
    const update = await db.from('automations').update({ name: 'Recompras · Serum Pilar', trigger_config: config,
      description: 'Seguimiento por oferta comprada. Cualquier respuesta pausa la secuencia y continúa con la IA.' })
      .eq('workspace_id', workspace).eq('id', id).eq('is_active', false).eq('updated_at', row.updated_at).select('id')
    if (update.error || update.data?.length !== 1) throw new Error('Draft changed during migration')
  } catch (error) {
    const restore = await replaceSteps(id, oldSteps)
    if (restore) throw new Error(`Restore failed: ${restore}`)
    throw error
  }
  const saved = await loadStepsTree(id)
  if (JSON.stringify(saved).includes('automation_entry') || JSON.stringify(saved).includes('send_message')) throw new Error('Scripted response branch remains')
  console.log(JSON.stringify({ id, roots: saved.length, active: false, responseBranches: 0 }))
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })
