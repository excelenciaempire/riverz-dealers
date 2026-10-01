import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Handlers de los webhooks de PLANTILLA de WhatsApp — compartidos por las dos
 * rutas de webhook (la legacy `/api/whatsapp/webhook` y la activa
 * `/api/channels/whatsapp/webhook`). Meta avisa por webhook cuando una plantilla
 * cambia de estado (APPROVED/REJECTED/PAUSED/DISABLED) o de calidad
 * (GREEN/YELLOW/RED/UNKNOWN); sin procesarlos, el comercio no se entera de que su
 * plantilla nueva quedó retenida o pausada hasta la próxima sincronización manual.
 */

export interface TemplateWebhookValue {
  event?: string
  message_template_id?: number | string
  message_template_name?: string
  message_template_language?: string
  reason?: string
  previous_quality_score?: string
  new_quality_score?: string
}

/** Estado crudo de Meta → status reducido (CHECK Draft/Pending/Approved/Rejected).
 *  PAUSED sigue siendo "Approved" (solo pausado); DISABLED sí es inutilizable. */
export function normalizeTemplateStatusEvent(event?: string): string | null {
  switch ((event ?? '').toUpperCase()) {
    case 'APPROVED':
      return 'Approved'
    case 'REJECTED':
    case 'DISABLED':
      return 'Rejected'
    case 'PENDING':
    case 'IN_APPEAL':
    case 'PENDING_DELETION':
      return 'Pending'
    case 'PAUSED':
    case 'FLAGGED':
      return 'Approved'
    default:
      return null
  }
}

/** message_template_status_update: guarda el estado crudo (meta_status, preserva
 *  PAUSED/DISABLED) y actualiza el status reducido. `wabaId` = entry.id. */
export async function handleTemplateStatusUpdate(
  db: SupabaseClient,
  wabaId: string,
  value: TemplateWebhookValue,
): Promise<void> {
  const name = value.message_template_name
  // A WABA is mandatory: never update equally named templates in other accounts.
  if (!name || !wabaId) return
  const patch: Record<string, unknown> = { meta_status: value.event ?? null }
  const status = normalizeTemplateStatusEvent(value.event)
  if (status) patch.status = status
  let q = db.from('message_templates').update(patch).eq('name', name)
  if (value.message_template_language) q = q.eq('language', value.message_template_language)
  if (wabaId) q = q.eq('waba_id', wabaId)
  const { data, error } = await q.select('workspace_id')
  if (error) {
    console.error('[webhook] template status update failed:', error.message)
    return
  }
  // Approval can be the last missing dependency; pauses must also stop active
  // flows. Reuse the activation gate, which preserves drafts and payment checks.
  const { reconcileWorkspaceAutomationReadiness } = await import('@/lib/automations/activation')
  const workspaces = new Set((data ?? []).map(row => row.workspace_id).filter(Boolean))
  for (const workspaceId of workspaces) {
    if ((value.event ?? '').toUpperCase() === 'APPROVED') {
      if (name === 'revitaly_envase_presentacion_20261001') {
        const { deliverQueuedRevitalyPackaging } = await import('@/lib/ai/revitaly-packaging-delivery')
        await deliverQueuedRevitalyPackaging(db, workspaceId)
      }
      const { promoteApprovedRiverzoficialTemplate } = await import(
        '@/lib/automations/riverzoficial-template-promotion'
      )
      await promoteApprovedRiverzoficialTemplate(
        db,
        workspaceId,
        name,
        value.message_template_language ?? 'es',
      )
    }
    await reconcileWorkspaceAutomationReadiness(db, workspaceId)
  }
}

/** message_template_quality_update: guarda el nuevo quality_score
 *  (UNKNOWN/GREEN/YELLOW/RED) — UNKNOWN = plantilla nueva elegible a pacing. */
export async function handleTemplateQualityUpdate(
  db: SupabaseClient,
  wabaId: string,
  value: TemplateWebhookValue,
): Promise<void> {
  const name = value.message_template_name
  const score = value.new_quality_score
  if (!name || !score) return
  let q = db.from('message_templates').update({ quality_score: score }).eq('name', name)
  if (value.message_template_language) q = q.eq('language', value.message_template_language)
  if (wabaId) q = q.eq('waba_id', wabaId)
  const { error } = await q
  if (error) console.error('[webhook] template quality update failed:', error.message)
}
