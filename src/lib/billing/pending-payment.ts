import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';

export interface PendingPayment {
  invoiceId: string;
  invoiceUrl: string | null;
  graceUntil: string;
  blocked: boolean;
  hours: number;
}

/** Only Stripe-hosted invoice links can leave the application. */
export function safeInvoiceUrl(value: string | null | undefined): string | null {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' && url.hostname === 'invoice.stripe.com' &&
      !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export async function pendingSubscriptionPayment(
  db: SupabaseClient, workspaceId: string, now = Date.now(),
): Promise<PendingPayment | null> {
  const { data, error } = await db.from('workspace_billing_invoices')
    .select('invoice_id,hosted_invoice_url,grace_until')
    .eq('workspace_id', workspaceId).in('status', ['open', 'uncollectible'])
    .gt('amount_remaining', 0).lte('unpaid_since', new Date(now).toISOString())
    .order('unpaid_since').limit(1).maybeSingle();
  if (error) throw new Error('subscription_payment_state_unavailable');
  if (!data) return null;
  const remaining = new Date(data.grace_until).getTime() - now;
  return { invoiceId: data.invoice_id, invoiceUrl: safeInvoiceUrl(data.hosted_invoice_url),
    graceUntil: data.grace_until, blocked: remaining <= 0,
    hours: Math.max(0, Math.ceil(remaining / 3_600_000)) };
}

/** Read Stripe again: webhook snapshots may arrive out of order. Never charges. */
export async function syncSubscriptionInvoice(db: SupabaseClient, client: Stripe, invoiceId: string) {
  const invoice = await client.invoices.retrieve(invoiceId);
  const correction = invoice.metadata?.kind === 'riverz_subscription_correction';
  if (invoice.metadata?.kind && !correction) return null;
  const subscription = invoice.parent?.subscription_details?.subscription;
  const subscriptionId = correction ? invoice.metadata?.subscription_id :
    typeof subscription === 'string' ? subscription : subscription?.id;
  if (!subscriptionId || !invoice.status || invoice.status === 'draft') return null;
  // Capacity upgrades / voluntary proration invoices do not suspend an existing plan.
  if (!correction && invoice.billing_reason === 'subscription_update') return null;
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  const { data: account, error } = await db.from('workspace_subscriptions')
    .select('workspace_id,stripe_customer_id').eq('stripe_subscription_id', subscriptionId).maybeSingle();
  if (error) throw new Error('subscription_invoice_account_unavailable');
  if (!account) return null; // Not a Riverz subscription.
  if (!customerId || account.stripe_customer_id !== customerId ||
    (invoice.metadata?.workspace_id && invoice.metadata.workspace_id !== account.workspace_id)) {
    throw new Error('subscription_invoice_account_mismatch');
  }
  // A send-invoice agreement gets its grace period after the agreed due date.
  const since = Math.max(invoice.status_transitions.finalized_at ?? invoice.created,
    invoice.collection_method === 'send_invoice' ? invoice.due_date ?? 0 : 0);
  const { error: writeError } = await db.rpc('record_subscription_invoice', { p_invoice: {
    invoice_id: invoice.id, workspace_id: account.workspace_id, subscription_id: subscriptionId,
    customer_id: customerId, status: invoice.status, amount_remaining: invoice.amount_remaining,
    currency: invoice.currency, hosted_invoice_url: safeInvoiceUrl(invoice.hosted_invoice_url),
    unpaid_since: new Date(since * 1000).toISOString(),
  } });
  if (writeError) throw new Error('subscription_invoice_persistence_failed');
  return { workspaceId: account.workspace_id as string, subscriptionId, status: invoice.status };
}

/** Recover missed failure/paid events without changing customer balances or AI settings. */
export async function reconcileSubscriptionInvoices(db: SupabaseClient, client: Stripe,
  refreshSubscription: (subscriptionId: string) => Promise<unknown>) {
  const ids = new Set<string>();
  const { data, error } = await db.from('workspace_billing_invoices').select('invoice_id')
    .in('status', ['open', 'uncollectible']).gt('amount_remaining', 0);
  if (error) throw new Error('subscription_invoice_reconciliation_unavailable');
  for (const row of data ?? []) ids.add(row.invoice_id);
  const failures: string[] = [];
  for (const status of ['open', 'uncollectible'] as const) {
    try {
      for await (const invoice of client.invoices.list({ status, limit: 100 })) ids.add(invoice.id);
    } catch {
      // A failed discovery page must not prevent a known merchant's paid recovery.
      failures.push(`list_${status}`);
    }
  }
  let synced = 0;
  for (const id of ids) {
    try {
      const result = await syncSubscriptionInvoice(db, client, id);
      if (!result) continue;
      // Refresh even before payment: subscription events can also be missed.
      await refreshSubscription(result.subscriptionId);
      synced++;
    } catch { failures.push(id); }
  }
  return { synced, failures };
}
