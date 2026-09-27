import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Prepare paid access synchronously; never credit money or enable auto-recharge. */
export async function prepareSubscriptionWallet(
  db: SupabaseClient,
  api: Stripe,
  workspaceId: string,
  sub: Stripe.Subscription
): Promise<void> {
  const { error } = await db
    .from('wallet_accounts')
    .upsert(
      { workspace_id: workspaceId },
      { onConflict: 'workspace_id', ignoreDuplicates: true }
    );
  if (error) throw new Error(error.message);

  const customerId =
    typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  // Wallet/card visibility belongs only to balance-billed merchants. Preserve
  // the official and BYOK plans instead of changing their agreed billing model.
  const account = await db
    .from('workspace_subscriptions')
    .select('modelo_cobro')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (account.error) throw new Error(account.error.message);
  if (account.data?.modelo_cobro !== 'saldo') return;

  let method = sub.default_payment_method;
  if (!method) {
    const customer = await api.customers.retrieve(customerId);
    if (!customer.deleted)
      method = customer.invoice_settings.default_payment_method;
  }
  if (!method) return;
  const paymentMethod =
    typeof method === 'string'
      ? await api.paymentMethods.retrieve(method)
      : method;
  const methodCustomer =
    typeof paymentMethod.customer === 'string'
      ? paymentMethod.customer
      : paymentMethod.customer?.id;
  if (methodCustomer !== customerId)
    throw new Error('subscription_payment_method_customer_mismatch');
  const saved = await db
    .from('wallet_accounts')
    .update({
      stripe_payment_method_id: paymentMethod.id,
      tarjeta_marca: paymentMethod.card?.brand ?? null,
      tarjeta_ultimos4: paymentMethod.card?.last4 ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId);
  if (saved.error) throw new Error(saved.error.message);
}
