import { createHash, randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MetaApiError, sanitizeTemplateTextParameter } from '@/lib/whatsapp/meta-api'
import { isUsPhone, isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'
import { resolveBroadcastParams, templateVariableNumbers } from './variables'

/** Final status comes from every stored recipient, including earlier batches. */
export async function finalizeBroadcastProgress(db: SupabaseClient, workspaceId: string, broadcastId: string, actorId: string | null = null) {
  const result = await db.rpc('finalize_broadcast_delivery_progress', { p_workspace_id: workspaceId, p_broadcast_id: broadcastId, p_actor_id: actorId, p_defer_seconds: 60 })
  if (result.error || !['draft','scheduled','sending','sent','failed'].includes(result.data?.status)) throw new Error('broadcast_delivery_unavailable')
  return result.data.status as string
}

export type DeliveryResult = {
  status: 'sent' | 'failed' | 'deferred' | 'skipped'
  code?: string
  messageId?: string
  attempted: boolean
  replayed: boolean
  recorded?: boolean
  payload?: DeliveryPayload
}
export type BroadcastRecipient = Record<string, unknown> & {
  id: string
  contact: Record<string, unknown> | null
}
export type BroadcastTemplate = { id: string; category: string; status: string; body_text: string }
export type DeliveryPayload = { phone: string; params: string[]; template: BroadcastTemplate | null }

function canonical(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return JSON.stringify(value ?? null)
}
export function deliveryHash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}
export function deliverySource(broadcast: Record<string, unknown>, recipient: BroadcastRecipient, template: BroadcastTemplate | null) {
  return {
    template_name: broadcast.template_name,
    template_language: broadcast.template_language ?? 'en_US',
    voice_note: broadcast.voice_note ?? null,
    variable_mapping: broadcast.variable_mapping ?? null,
    audience_filter: broadcast.audience_filter ?? null,
    contact_id: recipient.contact_id,
    params: recipient.params ?? null,
    phone: recipient.contact?.phone ?? null,
    template,
  }
}
export async function loadBroadcastTemplate(db: SupabaseClient, workspaceId: string, name: string, language: string, creatorId: string): Promise<BroadcastTemplate | null> {
  const result = await db.from('message_templates').select('id,category,status,body_text')
    .eq('workspace_id', workspaceId).eq('user_id', creatorId).eq('name', name).eq('language', language).limit(2)
  if (result.error) throw new Error('broadcast_delivery_unavailable')
  let row = result.data?.length === 1 ? result.data[0] : null
  if (result.data?.length === 0) {
    // Teammates may share a WABA cache without a personal copy. Use it only
    // when every scoped copy describes exactly the same approved payload.
    const config = await db.from('whatsapp_config').select('waba_id').eq('workspace_id', workspaceId).eq('status', 'connected').limit(2)
    if (config.error) throw new Error('broadcast_delivery_unavailable')
    const wabaId = config.data?.length === 1 ? config.data[0].waba_id : null
    if (!wabaId) return null
    const copies = await db.from('message_templates').select('id,category,status,body_text')
      .eq('workspace_id', workspaceId).eq('waba_id', wabaId).eq('name', name).eq('language', language).order('id').limit(101)
    if (copies.error) throw new Error('broadcast_delivery_unavailable')
    if (!copies.data?.length || copies.data.length > 100 || new Set(copies.data.map(t => canonical({ category: String(t.category).toLowerCase(), status: String(t.status).toLowerCase(), body_text: t.body_text }))).size !== 1) return null
    row = copies.data[0]
  }
  if (!row || String(row.status).toLowerCase() !== 'approved' ||
    !['marketing', 'utility', 'authentication'].includes(String(row.category).toLowerCase()) ||
    typeof row.body_text !== 'string') return null
  return row as BroadcastTemplate
}

/** Only a concrete non-timeout client rejection is definite. Network/5xx is uncertain. */
export function definiteDeliveryRejection(error: unknown): boolean {
  return error instanceof MetaApiError && error.status >= 400 && error.status < 500 && ![408, 409].includes(error.status)
}

async function finish(db: SupabaseClient, id: string, state: string, messageId: string | null, code: string | null): Promise<boolean> {
  // The same receipt/proof is idempotent. Retrying this database write never calls a provider.
  for (let i = 0; i < 2; i++) {
    try {
      const result = await db.rpc('finish_broadcast_delivery', { p_id: id, p_state: state, p_message_id: messageId, p_error_code: code })
      if (!result.error && result.data?.ok === true) return true
    } catch { /* Preserve the reservation on a database/network failure. */ }
  }
  console.warn('[broadcast] delivery receipt outcome could not be recorded')
  return false
}

/** All persisted campaign sends share one reservation. No abandoned attempt is resent. */
export async function dispatchBroadcastRecipient(
  db: SupabaseClient,
  input: {
    broadcast: Record<string, unknown>
    recipient: BroadcastRecipient
    actorId?: string
    send: (payload: DeliveryPayload) => Promise<{ messageId?: string }>
  },
): Promise<DeliveryResult> {
  const { broadcast, recipient } = input
  const workspaceId = broadcast.workspace_id as string
  const denied = (code: string, status: DeliveryResult['status'] = 'failed'): DeliveryResult => ({ status, code, attempted: false, replayed: false })
  if (!workspaceId || recipient.broadcast_id !== broadcast.id || !recipient.contact || recipient.contact.workspace_id !== workspaceId || recipient.contact.id !== recipient.contact_id) return denied('invalid')
  const rawPhone = recipient.contact.phone
  const phone = typeof rawPhone === 'string' ? sanitizePhoneForMeta(rawPhone) : ''
  if (!isValidE164(phone)) return denied('invalidPhone')
  const voice = broadcast.voice_note != null
  const template = voice ? null : await loadBroadcastTemplate(db, workspaceId, String(broadcast.template_name), String(broadcast.template_language ?? 'en_US'), String(broadcast.user_id))
  if (!voice && !template) return denied('templateUnavailable')
  if (template?.category.toLowerCase() === 'marketing' && isUsPhone(phone)) return denied('marketingUnavailable')
  const mapping = broadcast.variable_mapping
  if (mapping != null && (typeof mapping !== 'object' || Array.isArray(mapping) || Object.keys(mapping).length > 64 || Object.keys(mapping).some(key => !/^[1-9]\d*$/.test(key) || Number(key) > 64) || Object.values(mapping).some(v => typeof v !== 'string' || v.length > 100))) return denied('variables')
  const fallback = recipient.params
  if (fallback != null && (!Array.isArray(fallback) || fallback.length > 64 || fallback.some(v => typeof v !== 'string' || v.length > 4096))) return denied('variables')
  let params: string[]
  try { params = voice ? [] : (await resolveBroadcastParams(db, recipient.contact, fallback as string[] | null, mapping as Record<string, string> | null)).map(sanitizeTemplateTextParameter) }
  catch (error) { if (error instanceof Error && error.message === 'broadcast_delivery_variables') return denied('variables'); throw error }
  if (template) {
    const numbers = templateVariableNumbers(template.body_text)
    if (numbers.length !== params.length || numbers.some((n, i) => n !== i + 1)) return denied('variables')
  }
  const id = randomUUID()
  const claim = await db.rpc('claim_broadcast_delivery', {
    p_id: id, p_workspace_id: workspaceId, p_broadcast_id: broadcast.id, p_recipient_id: recipient.id,
    p_actor_id: input.actorId ?? null,
    p_destination_hash: deliveryHash([workspaceId, phone]),
    p_payload_hash: deliveryHash({ phone, template_name: broadcast.template_name, template_language: broadcast.template_language ?? 'en_US', template, params, voice_note: broadcast.voice_note ?? null }),
    p_source: deliverySource(broadcast, recipient, template),
  })
  if (claim.error || !claim.data || typeof claim.data.claimed !== 'boolean') throw new Error('broadcast_delivery_unavailable')
  const prior = claim.data as { claimed: boolean; state: string; message_id?: string; receipt_id?: string }
  if (!prior.claimed) {
    if (prior.state === 'accepted' && typeof prior.message_id === 'string' && prior.message_id && prior.receipt_id) {
      const recorded = await finish(db, prior.receipt_id, 'accepted', prior.message_id, null)
      return { status: 'sent', messageId: prior.message_id, attempted: false, replayed: true, recorded, payload: { phone, params, template } }
    }
    if (prior.state === 'sending') return { ...denied('pendingConfirmation', 'deferred'), replayed: true }
    if (prior.state === 'paused') return denied('paused', 'deferred')
    if (prior.state === 'opted_out' || prior.state === 'excluded') return denied(prior.state === 'opted_out' ? 'optedOut' : 'excluded', 'skipped')
    const codes: Record<string, string> = { uncertain: 'uncertain', rejected: 'rejected', changed: 'changed', duplicate: 'duplicate', template_unavailable: 'templateUnavailable', already_sent: 'alreadySent', not_pending: 'notPending' }
    return { ...denied(codes[prior.state] ?? 'unavailable'), replayed: true }
  }
  if (prior.receipt_id !== id || prior.state !== 'sending') throw new Error('broadcast_delivery_unavailable')
  try {
    const sent = await input.send({ phone, params, template })
    if (typeof sent.messageId !== 'string' || !sent.messageId || sent.messageId.length > 500) throw new Error('invalid_provider_receipt')
    const recorded = await finish(db, id, 'accepted', sent.messageId, null)
    return { status: 'sent', messageId: sent.messageId, attempted: true, replayed: false, recorded, payload: { phone, params, template } }
  } catch (error) {
    const rejected = definiteDeliveryRejection(error)
    const code = rejected ? 'broadcast_delivery_rejected' : 'broadcast_delivery_uncertain'
    const recorded = await finish(db, id, rejected ? 'rejected' : 'uncertain', null, code)
    return { status: 'failed', code: rejected ? 'rejected' : 'uncertain', attempted: true, replayed: false, recorded }
  }
}
