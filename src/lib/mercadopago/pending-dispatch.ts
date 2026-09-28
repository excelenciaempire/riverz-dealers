import type { SupabaseClient } from '@supabase/supabase-js'
import { currentPendingPayment, isActionablePending, paymentInstructionsUrl } from './pending'
import { upsertWhatsappContact } from '@/lib/shopify/contact-upsert'
import { isOptedOut } from '@/lib/whatsapp/opt-out'
import type { AutomationTriggerType } from '@/types'
import { sessionRunId } from '@/lib/automations/session-template'

interface PendingRow {
  id: string; workspace_id: string; mp_payment_id: string; payment_created_at: string;
  phone: string; payer_name: string | null; email: string | null;
}
type Dispatch = (input: { workspaceId: string; triggerType: AutomationTriggerType; contactId: string;
  context: { vars: Record<string, string> } }) => Promise<unknown>

/** No claim before execution: deterministic execution IDs permit safe retries
 * of dispatch failures; successful enrollment (including waits) is acknowledged. */
export async function dispatchPendingPayments(db: SupabaseClient, dispatch: Dispatch) {
  const flows = await db.from('automations').select('workspace_id,created_at,activation_requested_at')
    .eq('trigger_type', 'payment_pending').eq('is_active', true).is('deleted_at', null)
  if (flows.error) throw flows.error
  if (!flows.data?.length) return { pending_enrolled: 0, pending_failed: 0 }
  const starts = new Map<string, string>()
  for (const f of flows.data) {
    const start = f.activation_requested_at ?? f.created_at
    if (!starts.has(f.workspace_id) || start < starts.get(f.workspace_id)!) starts.set(f.workspace_id, start)
  }
  const result = await db.from('mp_pending_payments')
    .select('id,workspace_id,mp_payment_id,payment_created_at,phone,payer_name,email')
    .in('workspace_id', [...starts.keys()]).eq('status', 'pending')
    .is('dispatched_at', null).not('phone', 'is', null)
    .order('updated_at', { ascending: true }).order('payment_created_at', { ascending: true }).limit(50)
  if (result.error) throw result.error
  let enrolled = 0, failed = 0
  for (const row of (result.data ?? []) as PendingRow[]) {
    try {
      // Never blast the merchant's historical unpaid payments on activation.
      if (Date.parse(row.payment_created_at) < Date.parse(starts.get(row.workspace_id)!)) {
        const skipped = await db.from('mp_pending_payments').update({ dispatched_at: new Date().toISOString() }).eq('id', row.id)
        if (skipped.error) throw skipped.error
        continue
      }
      const payment = await currentPendingPayment(db, row.workspace_id, row.mp_payment_id)
      if (!isActionablePending(payment)) {
        const stopped = await db.from('mp_pending_payments').update({ status: 'closed' }).eq('id', row.id)
        if (stopped.error) throw stopped.error
        continue
      }
      const contactId = await upsertWhatsappContact(db, { workspaceId: row.workspace_id,
        phone: row.phone, name: row.payer_name ?? undefined, email: row.email ?? undefined, isShopifyCustomer: false })
      if (!contactId) throw new Error('pending payment recipient unavailable')
      if (await isOptedOut(db, row.workspace_id, contactId)) {
        const skipped = await db.from('mp_pending_payments').update({ dispatched_at: new Date().toISOString() }).eq('id', row.id)
        if (skipped.error) throw skipped.error
        continue
      }
      await dispatch({ workspaceId: row.workspace_id, triggerType: 'payment_pending', contactId,
        context: { vars: {
          payment_id: row.mp_payment_id, payment_created_at: row.payment_created_at,
          payment_gateway: 'mercadopago', financial_status: 'pending',
          customer_name: row.payer_name ?? '', customer_email: row.email ?? '', customer_phone: row.phone,
          total_price: String(payment.transaction_amount ?? ''), currency: payment.currency_id ?? '',
          payment_url: paymentInstructionsUrl(payment) ?? '',
          payment_expiration: payment.date_of_expiration ?? '',
          payment_method: payment.payment_method_id ?? '',
          external_reference: payment.external_reference ?? '',
        } } })
      // The engine swallows a failed INSERT. Acknowledge only persisted runs.
      const logs = await db.from('automation_logs').select('id').eq('workspace_id', row.workspace_id)
        .eq('contact_id', contactId).eq('trigger_event', 'payment_pending')
        .in('id', await pendingRunIds(db, row.workspace_id, contactId, row.mp_payment_id))
        .limit(1)
      if (logs.error || !logs.data?.length) throw new Error('pending payment enrollment was not persisted')
      const done = await db.from('mp_pending_payments').update({ dispatched_at: new Date().toISOString() }).eq('id', row.id)
      if (done.error) throw done.error
      enrolled++
    } catch {
      failed++
      // Rotate unavailable recipients/workspaces instead of letting the same
      // 50 oldest failures starve every other merchant on each cron tick.
      await db.from('mp_pending_payments').update({updated_at:new Date().toISOString()}).eq('id',row.id)
    }
  }
  return { pending_enrolled: enrolled, pending_failed: failed }
}

async function pendingRunIds(db: SupabaseClient, workspaceId: string, contactId: string, paymentId: string) {
  const result = await db.from('automations').select('id').eq('workspace_id', workspaceId)
    .eq('trigger_type', 'payment_pending').eq('is_active', true).is('deleted_at', null)
  if (result.error) throw result.error
  return (result.data ?? []).map(a => sessionRunId(workspaceId, a.id, 'payment_pending', contactId, { payment_id: paymentId }))
}
