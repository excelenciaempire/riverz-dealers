import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { templateDraftContext } from './draft-context'

export async function loadTemplateDraftContext(db: SupabaseClient, workspaceId: string, input: { product_id?: string; agent_id?: string; use_business_context?: boolean }) {
  let product: Record<string, unknown> | null = null
  let agent: Record<string, unknown> | null = null
  if (input.product_id) {
    const found = await db.from('shopify_products').select('*').eq('workspace_id', workspaceId).eq('id', input.product_id).maybeSingle()
    if (found.error) throw new Error('template_draft_context_unavailable')
    if (!found.data) throw new Error('template_draft_context_invalid')
    product = found.data
  }
  if (input.use_business_context === false) {
    if (input.agent_id) throw new Error('template_draft_context_invalid')
    return templateDraftContext(product, null)
  }
  let query = db.from('ai_agents').select('id,name,persona,knowledge,tone,language,updated_at').eq('workspace_id', workspaceId).eq('is_active', true)
  if (input.agent_id) query = query.eq('id', input.agent_id)
  const found = await query.order('id').limit(2)
  if (found.error) throw new Error('template_draft_context_unavailable')
  if (input.agent_id && found.data?.length !== 1) throw new Error('template_draft_context_invalid')
  // There is no arbitrary choice of training when a business has several profiles.
  if (found.data?.length === 1) agent = found.data[0]
  return templateDraftContext(product, agent)
}
