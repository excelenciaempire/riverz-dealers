import type { SupabaseClient } from '@supabase/supabase-js'
import { currentPendingPayment, isActionablePending } from '@/lib/mercadopago/pending'
import { getActiveShopifyConnection, fetchOrderFinancialStatus } from '@/lib/attribution/shopify'
import { AwaitTemplateAvailability, StopSessionSequence } from './session-template'

export function isPendingReminder(trigger: string, config: Record<string, unknown> | null | undefined, vars: Record<string, unknown> = {}): boolean {
  return trigger === 'payment_pending' || config?.pending_payment_reminder === true || vars.pending_payment_reminder === true
}

export async function pendingPaymentCondition(db: SupabaseClient, workspaceId: string, vars: Record<string, unknown>, wantPaid: boolean): Promise<boolean> {
  let payment
  try { payment = await currentPendingPayment(db, workspaceId, String(vars.payment_id ?? '')) }
  catch { throw new AwaitTemplateAvailability('waiting to verify Mercado Pago payment status') }
  if (payment.status === 'approved') return wantPaid
  if (!isActionablePending(payment)) throw new StopSessionSequence('payment cancelled, expired or no longer awaiting buyer payment')
  return !wantPaid
}

/** A fresh provider lookup before EVERY send. Uncertainty parks the execution. */
export async function assertPaymentStillPending(db: SupabaseClient, workspaceId: string, trigger: string,
  contactId: string | null, vars: Record<string, unknown>) {
  if (trigger === 'payment_pending') {
    let pending: boolean
    try {
      pending = isActionablePending(await currentPendingPayment(db, workspaceId, String(vars.payment_id ?? '')))
    } catch { throw new AwaitTemplateAvailability('waiting to verify Mercado Pago payment status') }
    if (!pending) throw new StopSessionSequence('Mercado Pago payment no longer awaiting buyer payment')
  } else {
    const orderId = String(vars.order_id ?? '')
    const conn = await getActiveShopifyConnection(db, workspaceId)
    const status = conn && orderId ? await fetchOrderFinancialStatus(conn, orderId) : null
    if (status === null) throw new AwaitTemplateAvailability('waiting to verify current order payment status')
    if (status !== 'pending') throw new StopSessionSequence('order payment no longer pending')
    const mirrored = await db.from('orders').select('status,payment_reported_at')
      .eq('workspace_id', workspaceId).eq('shopify_order_id', orderId).limit(1).maybeSingle()
    if (mirrored.error) throw mirrored.error
    if (mirrored.data?.payment_reported_at || ['cancelled','canceled','refunded'].includes(String(mirrored.data?.status)))
      throw new StopSessionSequence('order cancelled or payment reported')
  }
  if (contactId && vars.payment_created_at) {
    const reported = await db.from('orders').select('id').eq('workspace_id', workspaceId)
      .eq('contact_id', contactId).gte('payment_reported_at', String(vars.payment_created_at)).limit(1)
    if (reported.error) throw reported.error
    if (reported.data?.length) throw new StopSessionSequence('customer reported payment; awaiting confirmation')
  }
}

export async function claimPendingSequence(db: SupabaseClient, workspaceId: string, contactId: string, logId: string | null) {
  if (!logId) throw new Error('pending reminders require a persistent execution')
  const contact = await db.from('contacts').select('phone').eq('workspace_id', workspaceId).eq('id', contactId).single()
  if (contact.error) throw contact.error
  const phone = String(contact.data?.phone ?? '').replace(/\D/g, '')
  const claim = await db.rpc('claim_pending_payment_sequence', { p_workspace_id: workspaceId, p_phone: phone, p_log_id: logId })
  if (claim.error) throw claim.error
  if (claim.data !== true) throw new StopSessionSequence('another pending-payment reminder sequence owns this recipient')
}

/** A later cash/transfer attempt replaces the earlier card/cart recovery. */
export async function assertNoPendingReplacement(db: SupabaseClient, workspaceId: string, contactId: string, since: string) {
  if (!Number.isFinite(Date.parse(since))) return
  const contact = await db.from('contacts').select('phone').eq('workspace_id', workspaceId).eq('id', contactId).single()
  if (contact.error) throw contact.error
  const phone = String(contact.data?.phone ?? '').replace(/\D/g, '')
  if (!phone) return
  const pending = await db.from('mp_pending_payments').select('mp_payment_id').eq('workspace_id', workspaceId)
    .eq('phone', phone).eq('status', 'pending').gte('payment_created_at', since)
    .order('payment_created_at', {ascending:false}).limit(1).maybeSingle()
  if (pending.error) throw pending.error
  if (pending.data) {
    let actionable: boolean
    try { actionable = isActionablePending(await currentPendingPayment(db, workspaceId, pending.data.mp_payment_id)) }
    catch { throw new AwaitTemplateAvailability('waiting to verify replacement payment') }
    if (actionable) throw new StopSessionSequence('cash or transfer attempt replaces earlier payment/cart recovery')
  }
}
