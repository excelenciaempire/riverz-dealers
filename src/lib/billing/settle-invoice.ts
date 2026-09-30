import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import type { AdminActor } from '@/lib/admin/guard';
import { syncSubscriptionInvoice } from './pending-payment';

export interface InvoiceSettlement {
  workspace_id: string;
  invoice_id: string;
  amount_remaining: number;
  currency: string;
  method: 'external_payment' | 'agreement';
  reason: string;
}

export function validInvoiceSettlement(value: unknown): value is InvoiceSettlement {
  if (!value || typeof value !== 'object') return false;
  const v = value as InvoiceSettlement;
  return typeof v.workspace_id === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(v.workspace_id) &&
    typeof v.invoice_id === 'string' && /^in_[a-zA-Z0-9]+$/.test(v.invoice_id) &&
    Number.isSafeInteger(v.amount_remaining) && v.amount_remaining > 0 &&
    typeof v.currency === 'string' && /^[a-z]{3}$/.test(v.currency) &&
    ['external_payment', 'agreement'].includes(v.method) &&
    typeof v.reason === 'string' && v.reason.trim().length > 0 && v.reason.length <= 500;
}

export class InvoiceSettlementError extends Error {
  constructor(readonly code: 'mismatch' | 'changed' | 'unavailable') { super(code); }
}

/** Settle exactly one monthly invoice. Never changes the plan, schedule or wallet. */
export async function settleSubscriptionInvoice(
  db: SupabaseClient, client: Stripe, input: InvoiceSettlement, actor: AdminActor,
) {
  const { data: account, error } = await db.from('workspace_subscriptions')
    .select('stripe_subscription_id,stripe_customer_id').eq('workspace_id', input.workspace_id).maybeSingle();
  if (error) throw new InvoiceSettlementError('unavailable');
  if (!account?.stripe_subscription_id || !account.stripe_customer_id) throw new InvoiceSettlementError('mismatch');
  let invoice = await client.invoices.retrieve(input.invoice_id);
  const correction = invoice.metadata?.kind === 'riverz_subscription_correction';
  const parent = invoice.parent?.subscription_details?.subscription;
  const subscriptionId = correction ? invoice.metadata?.subscription_id : typeof parent === 'string' ? parent : parent?.id;
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  if (customerId !== account.stripe_customer_id || subscriptionId !== account.stripe_subscription_id ||
      (invoice.metadata?.workspace_id && invoice.metadata.workspace_id !== input.workspace_id) ||
      (invoice.metadata?.kind && !correction) || (!correction && invoice.billing_reason === 'subscription_update')) {
    throw new InvoiceSettlementError('mismatch');
  }
  // A timed-out successful request can safely reconcile again; never grant credit twice.
  const alreadySettled = invoice.status === 'paid' && invoice.amount_remaining === 0;
  if (!alreadySettled) {
    if (invoice.status !== 'open' || invoice.amount_remaining !== input.amount_remaining || invoice.currency !== input.currency) {
      throw new InvoiceSettlementError('changed');
    }
    const metadata = {
      riverz_settlement_method: input.method, riverz_settlement_reason: input.reason.trim(),
      riverz_settlement_actor: actor.userId, riverz_settlement_email: actor.email,
    };
    const key = `riverz-admin-settle-${invoice.id}-${input.method}-v1`;
    if (input.method === 'agreement') {
      // A full credit note changes the invoice to paid without inventing revenue
      // or placing credit on the next month's invoice. No customer email is sent.
      await client.creditNotes.create({ invoice: invoice.id, amount: input.amount_remaining,
        reason: 'order_change', memo: input.reason.trim(), email_type: 'none',
        metadata: { ...metadata, workspace_id: input.workspace_id },
      }, { idempotencyKey: key });
    } else {
      await client.invoices.update(invoice.id, { metadata });
      await client.invoices.pay(invoice.id, { paid_out_of_band: true }, { idempotencyKey: key });
    }
    invoice = await client.invoices.retrieve(invoice.id);
  }
  if (invoice.status !== 'paid' || invoice.amount_remaining !== 0) throw new InvoiceSettlementError('unavailable');
  const synced = await syncSubscriptionInvoice(db, client, invoice.id);
  if (synced?.workspaceId !== input.workspace_id) throw new InvoiceSettlementError('unavailable');
  const subscription = await client.subscriptions.retrieve(account.stripe_subscription_id);
  if (subscription.status === 'active') {
    const updated = await db.from('workspace_subscriptions').update({ estado: 'activa', vencida_desde: null,
      updated_at: new Date().toISOString() }).eq('workspace_id', input.workspace_id)
      .eq('stripe_subscription_id', subscription.id);
    if (updated.error) throw new InvoiceSettlementError('unavailable');
  }
  return { invoiceId: invoice.id, status: invoice.status, amountRemaining: invoice.amount_remaining, alreadySettled };
}
