import type { BandejaCtx } from './bandeja'

/** No model-supplied account, contact, automation or execution identifiers. */
export async function gestionarRecompra(ctx: BandejaCtx, input: { accion?: string; dias?: number; confirmado?: boolean }): Promise<string> {
  const fail = (error: string) => JSON.stringify({ ok: false, error })
  if (!ctx.conversationId || !['cancelar', 'reprogramar'].includes(input.accion ?? '')) return fail('invalid_request')
  if (input.accion === 'reprogramar' && (input.confirmado !== true || !Number.isSafeInteger(input.dias) || input.dias! < 1 || input.dias! > 365)) return fail('confirmed_days_required')
  const { data: conversation, error } = await ctx.db.from('conversations').select('automation_context')
    .eq('workspace_id', ctx.workspaceId).eq('contact_id', ctx.contactId).eq('id', ctx.conversationId).maybeSingle()
  if (error) return fail('conversation_unavailable')
  const handoff = conversation?.automation_context?.retention_handoff
  if (!handoff || typeof handoff.automation_id !== 'string') return fail('no_reorder_context')
  const { data: automation, error: automationError } = await ctx.db.from('automations').select('id,is_active,trigger_config')
    .eq('workspace_id', ctx.workspaceId).eq('id', handoff.automation_id).is('deleted_at', null).maybeSingle()
  if (automationError || automation?.trigger_config?.retention_ai_managed !== true) return fail('reorder_unavailable')
  if (input.accion === 'cancelar') {
    const tagId = automation.trigger_config.retention_permission_tag
    if (typeof tagId !== 'string') return fail('permission_tag_missing')
    const { data: tag, error: tagError } = await ctx.db.from('tags').select('id').eq('workspace_id', ctx.workspaceId).eq('id', tagId).maybeSingle()
    if (tagError || !tag) return fail('permission_tag_missing')
    const removed = await ctx.db.from('contact_tags').delete().eq('contact_id', ctx.contactId).eq('tag_id', tagId)
    if (removed.error) return fail('permission_update_failed')
    return JSON.stringify({ ok: true, accion: 'cancelar' })
  }
  if (typeof handoff.pending_id !== 'string' || typeof handoff.token !== 'string') return fail('no_paused_reorder')
  const { data: pending, error: pendingError } = await ctx.db.from('automation_pending_executions').select('*')
    .eq('workspace_id', ctx.workspaceId).eq('contact_id', ctx.contactId).eq('automation_id', automation.id).eq('id', handoff.pending_id).eq('status', 'done')
    .eq('context->vars->>retention_pause_token', handoff.token).maybeSingle()
  if (pendingError || !pending) return fail('reorder_no_longer_paused')
  if (input.accion === 'reprogramar' && !automation.is_active) return fail('automation_inactive')
  const permission = await ctx.db.from('contact_tags').select('contact_id').eq('contact_id', ctx.contactId)
    .eq('tag_id', automation.trigger_config.retention_permission_tag).maybeSingle()
  if (permission.error || !permission.data) return fail('reorder_permission_missing')
  const runAt = input.accion === 'reprogramar' ? new Date(Date.now() + input.dias! * 86400000).toISOString() : null
  const result = await ctx.db.from('automation_pending_executions').update({
    status: runAt ? 'pending' : 'done', ...(runAt ? { run_at: runAt } : {}),
    context: { ...pending.context, vars: { ...pending.context?.vars, retention_pause_token: null } },
  }).eq('workspace_id', ctx.workspaceId).eq('contact_id', ctx.contactId).eq('id', pending.id)
    .eq('status', 'done').eq('context->vars->>retention_pause_token', handoff.token).select('id')
  if (result.error || result.data?.length !== 1) return fail('reorder_changed_retry')
  return JSON.stringify({ ok: true, accion: input.accion, ...(runAt ? { siguiente_contacto: runAt, etapa: 'siguiente etapa del recorrido existente; se vuelven a comprobar permisos y compras' } : {}) })
}
