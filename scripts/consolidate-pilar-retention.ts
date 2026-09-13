import { createClient } from '@supabase/supabase-js'
import { mkdir, writeFile } from 'node:fs/promises'
import { buildRetentionPlan, type RetentionTags } from '../src/lib/automations/retention-plan'
import { loadStepsTree, replaceSteps } from '../src/lib/automations/steps-tree'
import { activationIssues } from '../src/lib/automations/activation'

const workspaceId = '522a68ae-568d-4dd9-92e5-2c8f633f1761'
const installation = 'pilar_postventa_v1'
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
async function main() {
  const { data: rows, error } = await db.from('automations').select('*').eq('workspace_id', workspaceId)
    .contains('trigger_config', { retention_installation: installation }).is('deleted_at', null)
  if (error) throw error
  if (rows?.length === 1 && rows[0].trigger_config.event_entries) { console.log('Already consolidated'); return }
  if (rows?.length !== 9 || rows.some(r => r.is_active || r.created_at !== r.updated_at)) throw new Error('Expected nine unchanged inactive drafts')
  const primary = rows.find(r => r.trigger_config.retention_flow === 'main')!
  const helpers = rows.filter(r => r.id !== primary.id)
  const pending = await db.from('automation_pending_executions').select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId).in('automation_id', rows.map(r => r.id)).in('status', ['pending', 'running'])
  if (pending.error || pending.count !== 0) throw new Error('Cannot consolidate with pending runs')
  const { data: tagRows, error: tagError } = await db.from('tags').select('id,name').eq('workspace_id', workspaceId).like('name', `${installation}: %`)
  if (tagError) throw tagError
  const suffix = { enrolled: 'postventa inscrita', permission: 'postventa permiso verificado', paused: 'postventa pausada', help: 'postventa necesita atención' }
  const tags = Object.fromEntries(Object.entries(suffix).map(([k, v]) => [k, tagRows?.find(t => t.name === `${installation}: ${v}`)?.id])) as unknown as RetentionTags
  if (Object.values(tags).some(v => !v)) throw new Error('Retention tags missing')
  const plan = buildRetentionPlan({ locale: 'es', prefix: installation, product: 'Serum Pilar', tags,
    offers: [{ units: 1, day: 22, label: '1 unidad' }, { units: 3, day: 82, label: '2 unidades + 1 gratis' }, { units: 4, day: 112, label: '3 unidades + 1 gratis' }] })
  const flow = plan.flows[0]
  const issues = activationIssues({ triggerType: flow.trigger_type, triggerConfig: flow.trigger_config, steps: flow.steps })
  if (issues.length) throw new Error(JSON.stringify(issues))
  const backup = await Promise.all(rows.map(async row => ({ row, steps: await loadStepsTree(row.id) })))
  await mkdir('output/retention', { recursive: true })
  await writeFile('output/retention/pilar-before-consolidation.json', JSON.stringify(backup, null, 2), 'utf8')
  if (!process.argv.includes('--apply')) { console.log(JSON.stringify({ main: primary.id, archive: helpers.map(r => r.id), mode: 'preview' })); return }
  try {
    const stepError = await replaceSteps(primary.id, flow.steps)
    if (stepError) throw new Error(stepError)
    const updated = await db.from('automations').update({ trigger_config: { ...primary.trigger_config, ...flow.trigger_config },
      description: 'Un solo recorrido de postventa y recompra con atención, experiencia y gestión de respuestas.' })
      .eq('workspace_id', workspaceId).eq('id', primary.id).eq('is_active', false).eq('updated_at', primary.updated_at).select('id')
    if (updated.error || updated.data?.length !== 1) throw new Error('Main draft changed during consolidation')
    const archived = await db.from('automations').update({ deleted_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId).eq('is_active', false).in('id', helpers.map(r => r.id)).select('id')
    if (archived.error || archived.data?.length !== helpers.length) throw new Error('Could not archive helper drafts')
  } catch (error) {
    const restored = await replaceSteps(primary.id, backup.find(b => b.row.id === primary.id)!.steps)
    const reset = await db.from('automations').update({ trigger_config: primary.trigger_config, description: primary.description })
      .eq('workspace_id', workspaceId).eq('id', primary.id).eq('is_active', false)
    const unarchive = await db.from('automations').update({ deleted_at: null }).eq('workspace_id', workspaceId).eq('is_active', false).in('id', helpers.map(r => r.id))
    if (restored || reset.error || unarchive.error) throw new Error('Consolidation failed; restore requires review of output/retention/pilar-before-consolidation.json')
    throw error
  }
  const verified = await db.from('automations').select('id,name,is_active,trigger_config').eq('workspace_id', workspaceId)
    .contains('trigger_config', { retention_installation: installation }).is('deleted_at', null)
  if (verified.error || verified.data?.length !== 1 || verified.data[0].id !== primary.id || verified.data[0].is_active) throw new Error('Consolidation verification failed')
  console.log(JSON.stringify({ automation: primary.id, visible: 1, archived: helpers.length, active: false, steps: (await loadStepsTree(primary.id)).length }))
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })
