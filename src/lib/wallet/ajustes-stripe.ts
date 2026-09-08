import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stripe } from '@/lib/billing/stripe';
import { COMISION_REAL } from './comision';
import { mover } from './saldo';

/** Reflect actual Stripe balance adjustments, including reversals, once per balance transaction. */
export async function ajustarRecargaDesdeEvento(
  db: SupabaseClient,
  event: Stripe.Event
): Promise<string | null> {
  let chargeId: string | null = null;
  let transactions: Array<string | Stripe.BalanceTransaction | null> = [];
  if (
    event.type === 'refund.updated' ||
    event.type === 'refund.created' ||
    event.type === 'refund.failed'
  ) {
    const refund = event.data.object as Stripe.Refund;
    chargeId =
      typeof refund.charge === 'string'
        ? refund.charge
        : (refund.charge?.id ?? null);
    transactions = [
      refund.balance_transaction,
      refund.failure_balance_transaction ?? null,
    ];
  } else if (
    event.type === 'charge.dispute.funds_withdrawn' ||
    event.type === 'charge.dispute.funds_reinstated'
  ) {
    const dispute = event.data.object as Stripe.Dispute;
    chargeId =
      typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id;
    transactions = dispute.balance_transactions;
  } else return null;
  if (!chargeId) return null;
  const charge = await stripe().charges.retrieve(chargeId);
  const piId =
    typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!piId) return null;
  const pi = await stripe().paymentIntents.retrieve(piId);
  if (
    pi.metadata.tipo !== 'recarga_billetera' ||
    pi.metadata.comision !== COMISION_REAL
  )
    return null;
  const workspaceId = pi.metadata.workspace_id;
  if (!workspaceId) throw new Error('wallet_adjustment_missing_workspace');
  const { data: original, error } = await db
    .from('wallet_movimientos')
    .select('id')
    .eq('stripe_id', piId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error || !original)
    throw new Error('wallet_adjustment_waiting_for_topup');
  if (!transactions.some(Boolean)) throw new Error('wallet_adjustment_pending');
  for (const item of transactions) {
    if (!item) continue;
    const tx =
      typeof item === 'string'
        ? await stripe().balanceTransactions.retrieve(item)
        : item;
    if (tx.currency !== 'usd' || !Number.isSafeInteger(tx.net))
      throw new Error('wallet_adjustment_currency_mismatch');
    await mover(db, workspaceId, {
      tipo: tx.net >= 0 ? 'reembolso' : 'ajuste',
      concepto: 'recarga_ajuste',
      centavos: tx.net,
      stripeId: `wallet:${tx.id}`,
      detalle: {
        paymentIntent: piId,
        balanceTransaction: tx.id,
        evento: event.id,
        moneda: tx.currency,
      },
    });
  }
  return `wallet adjustment: ${piId}`;
}
