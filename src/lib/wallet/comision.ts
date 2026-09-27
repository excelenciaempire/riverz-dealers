import type { SupabaseClient } from '@supabase/supabase-js'
import { stripe } from '@/lib/billing/stripe'
import { mover } from './saldo'

/** Legacy metadata marker; Stripe processing is now an operating expense. */
export const COMISION_REAL = 'stripe_real_v1'

export async function descontarComision(db: SupabaseClient, workspaceId: string, pago: string) {
  const pi = await stripe().paymentIntents.retrieve(pago, {
    expand: ['latest_charge.balance_transaction'],
  })
  if (pi.metadata.comision !== COMISION_REAL) return
  if (pi.metadata.workspace_id !== workspaceId || pi.status !== 'succeeded' || pi.currency !== 'usd') {
    throw new Error('wallet_fee_invalid_payment')
  }
  const charge = pi.latest_charge
  const tx = charge && typeof charge !== 'string' ? charge.balance_transaction : null
  // Stripe creates this asynchronously. Throw so the webhook retries, never guess a fee.
  if (!tx || typeof tx === 'string') throw new Error('wallet_fee_pending')
  if (tx.currency !== 'usd' || !Number.isSafeInteger(tx.fee) || tx.fee < 0 || tx.fee > pi.amount_received) {
    throw new Error('wallet_fee_invalid_transaction')
  }
  if (tx.fee === 0) return
  await mover(db, workspaceId, {
    tipo: 'consumo',
    concepto: 'comision_stripe',
    centavos: 0,
    costoCentavos: tx.fee,
    stripeId: `${pago}:comision`,
    detalle: { paymentIntent: pago, balanceTransaction: tx.id, brutoCentavos: pi.amount_received, moneda: tx.currency, asumidaPor: 'riverz' },
  })
}
