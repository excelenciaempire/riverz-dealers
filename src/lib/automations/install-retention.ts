import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { Locale } from '@/lib/i18n/config'
import { ensureTag } from '@/lib/contacts/tags'
import { crearPlantilla } from '@/lib/templates/create'
import { buildRetentionPlan, clearRetentionProduct, type RetentionOffer, type RetentionTags } from './retention-plan'
import { insertSteps, loadStepsTree } from './steps-tree'
import { activationIssues } from './activation'

export interface InstallRetentionOptions {
  workspaceId: string
  userId: string
  locale: Locale
  product: string
  offers: RetentionOffer[]
  installationKey?: string
  handoffAgentId?: string
  requireProductSelection?: boolean
}

/** Creates a tenant-owned, inert package. No customer tags, campaigns, provider
 * submissions, activation requests or existing automations are changed. */
export async function installRetentionPackage(db: SupabaseClient, o: InstallRetentionOptions) {
  const key = o.installationKey ?? `retention_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const { data: prior, error: priorError } = await db.from('automations').select('id,name,trigger_type,is_active,trigger_config')
    .eq('workspace_id', o.workspaceId).contains('trigger_config', { retention_installation: key }).is('deleted_at', null)
  if (priorError) throw new Error(priorError.message)
  if (prior?.length) {
    // Never rewrite an installation: an operator may have edited it already.
    const expected = 1
    if (prior.length !== expected) throw new Error(`Incomplete retention installation (${prior.length}/${expected}). Review before retrying.`)
    return { automations: prior, templates: [], reused: true, installationKey: key }
  }
  const tags: Partial<RetentionTags> = {}
  const names = o.locale === 'en'
    ? { enrolled: 'post-purchase enrolled', permission: 'post-purchase permission verified', paused: 'post-purchase paused', help: 'post-purchase needs support' }
    : { enrolled: 'postventa inscrita', permission: 'postventa permiso verificado', paused: 'postventa pausada', help: 'postventa necesita atención' }
  for (const tagKey of Object.keys(names) as (keyof RetentionTags)[]) {
    const id = await ensureTag(db, o.workspaceId, `${key}: ${names[tagKey]}`)
    if (!id) throw new Error(`Could not create retention tag: ${tagKey}`)
    tags[tagKey] = id
  }
  const plan = buildRetentionPlan({ locale: o.locale, prefix: key, product: o.product, offers: o.offers, tags: tags as RetentionTags })
  const templates: Array<{ id: string | null; name: string; status: string }> = []
  for (const input of plan.templates) {
    // A different tenant can share the owner: use workspace-scoped lookup.
    const { data: existing, error } = await db.from('message_templates').select('id,name,status')
      .eq('workspace_id', o.workspaceId).eq('name', input.nombre).eq('language', o.locale).maybeSingle()
    if (error) throw new Error(error.message)
    if (existing) { templates.push(existing); continue }
    const created = await crearPlantilla(db, { ...input, workspaceId: o.workspaceId, userId: null, enviarAMeta: false })
    if (!created.ok) throw new Error(created.mensaje ?? created.claveI18n ?? 'Template creation failed')
    templates.push({ id: created.id, name: created.name, status: created.estado })
  }
  const automations: Array<{ id: string; name: string; trigger_type: string; is_active: boolean }> = []
  try {
    for (const flow of plan.flows) {
      if (o.requireProductSelection && (flow.trigger_type === 'shopify_order_delivered' || flow.trigger_type === 'shopify_order_cancelled' || flow.trigger_type === 'shopify_order_refunded')) {
        clearRetentionProduct(flow.steps)
      }
      const issues = activationIssues({ triggerType: flow.trigger_type, triggerConfig: flow.trigger_config, steps: flow.steps })
      if (issues.some(issue => !(o.requireProductSelection && issue.path.endsWith('.value')))) throw new Error(JSON.stringify(issues))
      const { data, error } = await db.from('automations').insert({
        workspace_id: o.workspaceId, user_id: o.userId,
        name: `${flow.name} · ${o.product}`,
        description: o.locale === 'en' ? 'Post-purchase package. Requires approved templates and verified messaging permission. Offers use current checkout prices.' : 'Programa de postventa. Requiere plantillas aprobadas y permiso verificado. Las ofertas usan el precio vigente del checkout.',
        trigger_type: flow.trigger_type,
        trigger_config: { ...flow.trigger_config, retention_installation: key, retention_flow: flow.key,
          ...(o.handoffAgentId ? { handoff_ai_agent_id: o.handoffAgentId } : {}) },
        is_active: false, activation_state: 'draft',
      }).select('id,name,trigger_type,is_active').single()
      if (error || !data) throw new Error(error?.message ?? 'Automation creation failed')
      automations.push(data)
      const stepError = await insertSteps(data.id, flow.steps)
      if (stepError) throw new Error(stepError)
      const saved = await loadStepsTree(data.id)
      if (!saved.length) throw new Error('Saved automation has no steps')
    }
  } catch (error) {
    // Only remove inert rows created by THIS attempt. Keep reusable drafts.
    if (automations.length) await db.from('automations').delete().eq('workspace_id', o.workspaceId)
      .eq('is_active', false).in('id', automations.map(a => a.id))
    throw error
  }
  return { automations, templates, tags, reused: false, installationKey: key }
}
