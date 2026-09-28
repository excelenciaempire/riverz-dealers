import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchPayment, fetchPayments, payerName, payerPhone, type MpPayment } from './client'
import { freshAccessToken } from './oauth'
import { normalizeToWhatsApp, isValidE164 } from '@/lib/whatsapp/phone-utils'

/** Cash vouchers and transfers awaiting the buyer, never card/risk processing. */
export function isActionablePending(payment: MpPayment, now = Date.now()): boolean {
  if (payment.live_mode === false || payment.status !== 'pending') return false
  if (!['pending_waiting_payment', 'pending_waiting_transfer'].includes(payment.status_detail ?? '')) return false
  if (!['ticket', 'atm', 'bank_transfer'].includes(payment.payment_type_id ?? '')) return false
  if (!(Number(payment.transaction_amount) > 0)) return false
  if (payment.date_of_expiration) {
    const expiry = Date.parse(payment.date_of_expiration)
    if (!Number.isFinite(expiry) || expiry <= now) return false
  }
  return true
}

export function paymentInstructionsUrl(payment: MpPayment): string | null {
  const raw = payment.transaction_details?.external_resource_url
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null
  } catch { return null }
}

/** Exact email only; ambiguous emails and masked names never choose a recipient. */
export function pendingPhone(payment: MpPayment, contacts: Array<{ email: string | null; phone: string | null }>, country: string): string | null {
  const own = payerPhone(payment) || (payment.payer?.phone?.number
    ? `${payment.payer.phone.area_code ?? ''}${payment.payer.phone.number}` : null)
  const normalize = (raw: string | null) => {
    const phone = raw ? normalizeToWhatsApp(raw, country).replace(/\D/g, '') : ''
    return isValidE164(phone) ? phone : null
  }
  if (own) return normalize(own)
  const email = payment.payer?.email?.trim().toLowerCase()
  if (!email || email.includes('*')) return null
  const phones = new Set(contacts.filter(c => c.email?.trim().toLowerCase() === email)
    .map(c => normalize(c.phone)).filter((p): p is string => !!p))
  return phones.size === 1 ? [...phones][0] : null
}

/** Upsert only source fields: never reset dispatch/delivery state on a replay. */
export async function ingestPendingPayments(db: SupabaseClient, workspaceId: string, payments: MpPayment[], country: string): Promise<number> {
  const unique = [...new Map(payments.map(p => [String(p.id), p])).values()]
  const candidates = unique.filter(p => isActionablePending(p) && Number.isFinite(Date.parse(p.date_created ?? '')))
  const emails = [...new Set(candidates.map(p => p.payer?.email?.trim().toLowerCase()).filter((e): e is string => !!e && !e.includes('*')))]
  let contacts: Array<{ email: string | null; phone: string | null }> = []
  if (emails.length) {
    const result = await db.from('contacts').select('email,phone').eq('workspace_id', workspaceId).in('email', emails)
    if (result.error) throw result.error
    contacts = result.data ?? []
  }
  if (candidates.length) {
    const rows = candidates.map(p => ({
      workspace_id: workspaceId, mp_payment_id: String(p.id), status: p.status,
      status_detail: p.status_detail, payment_created_at: p.date_created,
      expires_at: p.date_of_expiration ?? null, payer_name: payerName(p) || null,
      email: p.payer?.email?.trim().toLowerCase() ?? null,
      phone: pendingPhone(p, contacts, country), amount: p.transaction_amount,
      currency: p.currency_id ?? null, payment_method: p.payment_method_id ?? null,
      external_reference: p.external_reference ?? null, payment_url: paymentInstructionsUrl(p),
      updated_at: new Date().toISOString(),
    }))
    const result = await db.from('mp_pending_payments').upsert(rows, { onConflict: 'workspace_id,mp_payment_id' })
    if (result.error) throw result.error
  }
  // Stop previously queued payments that have since settled, expired or changed.
  const states = new Map<string, string[]>()
  for (const p of unique.filter(p => !isActionablePending(p))) {
    const status = p.status === 'pending' ? 'closed' : p.status
    states.set(status, [...(states.get(status) ?? []), String(p.id)])
  }
  for (const [status, ids] of states) {
    const result = await db.from('mp_pending_payments').update({ status, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId).in('mp_payment_id', ids)
    if (result.error) throw result.error
  }
  return candidates.length
}

/** Failure is unknown (throws); callers must not send based on stale state. */
export async function currentPendingPayment(db: SupabaseClient, workspaceId: string, paymentId: string): Promise<MpPayment> {
  const token = await freshAccessToken(db, workspaceId)
  if (!token) throw new Error('Mercado Pago connection unavailable')
  const payment = await fetchPayment(token, paymentId)
  // A buyer may abandon a cash voucher and pay the SAME purchase by card.
  // Only an exact purchase reference can link these attempts, never a name.
  if (isActionablePending(payment) && payment.external_reference && payment.date_created) {
    const since = new Date(Date.parse(payment.date_created) - 7 * 86_400_000).toISOString()
    const attempts = await fetchPayments(token, since, new Date().toISOString(), 20, payment.external_reference)
    if (attempts.some(p => p.status === 'approved' && p.external_reference === payment.external_reference))
      return { ...payment, status: 'approved', status_detail: 'purchase_paid_by_another_attempt' }
  }
  return payment
}
