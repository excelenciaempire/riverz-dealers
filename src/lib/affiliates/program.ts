import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';

export const AFFILIATE_COOKIE = 'riverz_affiliate_ref';
export const AFFILIATE_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
export const DEFAULT_COMMISSION_BPS = 3500;
export const COMMISSION_HOLD_DAYS = 30;

const CODE_RE = /^[A-Z0-9]{8}$/;

export function paymentFollowsCallAttribution(
  paidAt: number,
  attributedAt: string
): boolean {
  return (
    Number.isFinite(paidAt) &&
    paidAt >= Math.ceil(Date.parse(attributedAt) / 1000)
  );
}

export function normalizeAffiliateCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

export function commissionAmountCents(
  grossCents: number,
  commissionBps = DEFAULT_COMMISSION_BPS
): number {
  if (!Number.isSafeInteger(grossCents) || grossCents <= 0) return 0;
  if (
    !Number.isInteger(commissionBps) ||
    commissionBps <= 0 ||
    commissionBps > 10_000
  )
    return 0;
  return Math.round((grossCents * commissionBps) / 10_000);
}

type Partner = {
  id: string;
  email: string;
  referral_code: string;
  commission_bps: number;
  status: string;
};

export async function activeAffiliate(
  db: SupabaseClient,
  rawCode: unknown
): Promise<Partner | null> {
  const code = normalizeAffiliateCode(rawCode);
  if (!code) return null;
  const { data, error } = await db
    .from('affiliate_partners')
    .select('id, email, referral_code, commission_bps, status')
    .eq('referral_code', code)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Partner | null) ?? null;
}

/** Fija la atribucion al alta. Una cuenta ya atribuida nunca cambia de socio. */
export async function recordAffiliateSignup(
  db: SupabaseClient,
  input: { code: unknown; userId: string; email: string }
): Promise<boolean> {
  const partner = await activeAffiliate(db, input.code);
  if (!partner || partner.email === input.email.trim().toLowerCase())
    return false;
  const { error } = await db.from('affiliate_referrals').upsert(
    {
      affiliate_id: partner.id,
      referred_user_id: input.userId,
      attribution_code: partner.referral_code,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'referred_user_id', ignoreDuplicates: true }
  );
  if (error) throw new Error(error.message);
  return true;
}

/** Une el alta atribuida con el workspace que finalmente contrata. */
export async function attachAffiliateWorkspace(
  db: SupabaseClient,
  workspaceId: string
): Promise<void> {
  const { data: workspace, error: workspaceError } = await db
    .from('workspaces')
    .select('owner_id')
    .eq('id', workspaceId)
    .maybeSingle();
  if (workspaceError) throw new Error(workspaceError.message);
  const ownerId = (workspace as { owner_id?: string } | null)?.owner_id;
  if (!ownerId) return;
  const { error } = await db
    .from('affiliate_referrals')
    .update({ workspace_id: workspaceId, updated_at: new Date().toISOString() })
    .eq('referred_user_id', ownerId)
    .is('workspace_id', null);
  if (error) throw new Error(error.message);
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const subscription = invoice.parent?.subscription_details?.subscription;
  if (!subscription) return null;
  return typeof subscription === 'string' ? subscription : subscription.id;
}

export function commissionableGross(invoice: Stripe.Invoice): number {
  if (
    ![
      'subscription_create',
      'subscription_cycle',
      'subscription_update',
    ].includes(invoice.billing_reason ?? '')
  ) {
    return 0;
  }
  const beforeTax = invoice.total_excluding_tax ?? invoice.total;
  return Math.max(0, Math.min(invoice.amount_paid, beforeTax));
}

/** Relee el estado actual: un webhook repetido o fuera de orden no resta dos veces. */
export async function reconcileAffiliateInvoice(
  db: SupabaseClient,
  stripe: Stripe,
  invoiceId: string
): Promise<string | null> {
  const { data: commission, error: commissionError } = await db
    .from('affiliate_commissions')
    .select('id, gross_cents')
    .eq('stripe_invoice_id', invoiceId)
    .maybeSingle();
  if (commissionError) throw new Error(commissionError.message);
  if (!commission) return null;
  const syncedAt = new Date().toISOString();
  const invoice = await stripe.invoices.retrieve(invoiceId);
  let refundedIncludingTax = 0;
  const seenCharges = new Set<string>();
  for await (const payment of stripe.invoicePayments.list({
    invoice: invoiceId,
    limit: 100,
  })) {
    const intent = payment.payment.payment_intent;
    const charge = payment.payment.charge;
    const charges = intent
      ? stripe.charges.list({
          payment_intent: typeof intent === 'string' ? intent : intent.id,
          limit: 100,
        })
      : null;
    if (charges) {
      for await (const item of charges) {
        if (seenCharges.has(item.id)) continue;
        seenCharges.add(item.id);
        refundedIncludingTax += item.amount_refunded;
      }
    } else if (charge) {
      const item =
        typeof charge === 'string'
          ? await stripe.charges.retrieve(charge)
          : charge;
      if (!seenCharges.has(item.id)) {
        seenCharges.add(item.id);
        refundedIncludingTax += item.amount_refunded;
      }
    }
  }
  // Las notas de credito pueden incluir el mismo reembolso anterior.
  // Sumamos solo su parte acreditada fuera de ese reembolso para no duplicar.
  for await (const note of stripe.creditNotes.list({
    invoice: invoiceId,
    limit: 100,
  })) {
    if (note.status === 'void' || note.type !== 'post_payment') continue;
    const cashRefunds = note.refunds.reduce(
      (sum, refund) => sum + refund.amount_refunded,
      0
    );
    refundedIncludingTax += Math.max(0, note.post_payment_amount - cashRefunds);
  }
  const refundedCents =
    invoice.status === 'void'
      ? commission.gross_cents
      : proportionalRefund(
          commission.gross_cents,
          invoice.amount_paid,
          refundedIncludingTax
        );
  const { error } = await db.rpc('reconcile_affiliate_commission', {
    p_invoice_id: invoiceId,
    p_refunded_cents: refundedCents,
    p_synced_at: syncedAt,
  });
  if (error) throw new Error(error.message);
  return `affiliate invoice ${invoiceId}: reconciled`;
}

export function proportionalRefund(
  grossCents: number,
  paidCents: number,
  refundedCents: number
): number {
  if (paidCents <= 0 || refundedCents <= 0) return 0;
  return Math.min(
    grossCents,
    Math.round((grossCents * Math.min(paidCents, refundedCents)) / paidCents)
  );
}

/**
 * Crea o revierte la comision de una factura. Es idempotente por invoice id.
 * Impuestos, descuentos y saldos no cobrados quedan fuera de la base.
 */
export async function applyAffiliateStripeEvent(
  db: SupabaseClient,
  event: Stripe.Event,
  stripe: Stripe
): Promise<string | null> {
  if (
    [
      'credit_note.created',
      'credit_note.updated',
      'credit_note.voided',
    ].includes(event.type)
  ) {
    const note = event.data.object as Stripe.CreditNote;
    return reconcileAffiliateInvoice(
      db,
      stripe,
      typeof note.invoice === 'string' ? note.invoice : note.invoice.id
    );
  }
  if (
    event.type === 'charge.refunded' ||
    event.type === 'refund.created' ||
    event.type === 'refund.updated'
  ) {
    const object = event.data.object as Stripe.Charge | Stripe.Refund;
    const intent = object.payment_intent;
    if (!intent) return null;
    for await (const payment of stripe.invoicePayments.list({
      payment: {
        type: 'payment_intent',
        payment_intent: typeof intent === 'string' ? intent : intent.id,
      },
      limit: 100,
    })) {
      const invoiceId =
        typeof payment.invoice === 'string'
          ? payment.invoice
          : payment.invoice.id;
      await reconcileAffiliateInvoice(db, stripe, invoiceId);
    }
    return null;
  }
  if (event.type === 'invoice.voided') {
    const invoice = event.data.object as Stripe.Invoice;
    return reconcileAffiliateInvoice(db, stripe, invoice.id);
  }
  if (event.type !== 'invoice.paid') return null;

  const invoice = event.data.object as Stripe.Invoice;
  if (invoice.metadata?.kind === 'riverz_capacity_upgrade') return null;
  const grossCents = commissionableGross(invoice);
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId || grossCents <= 0) return null;

  const { data: subscription, error: subscriptionError } = await db
    .from('workspace_subscriptions')
    .select('workspace_id')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();
  if (subscriptionError) throw new Error(subscriptionError.message);
  // Stripe puede entregar invoice.paid antes de subscription.created. El id
  // de workspace tambien viaja en los metadatos de la suscripcion, dentro de
  // la factura, para que el orden de llegada no pierda la primera comision.
  const workspaceId =
    (subscription as { workspace_id?: string } | null)?.workspace_id ??
    invoice.parent?.subscription_details?.metadata?.workspace_id ??
    null;
  if (!workspaceId) return null;

  await attachAffiliateWorkspace(db, workspaceId);
  const { data: referral, error: referralError } = await db
    .from('affiliate_referrals')
    .select(
      'id, affiliate_id, first_paid_at, attributed_at, attribution_source, affiliate_partners!inner(commission_bps, status)'
    )
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (referralError) throw new Error(referralError.message);
  if (!referral) return null;

  const joined = referral as {
    id: string;
    affiliate_id: string;
    first_paid_at: string | null;
    attributed_at: string;
    attribution_source: string;
    affiliate_partners:
      | { commission_bps: number; status: string }
      | Array<{ commission_bps: number; status: string }>;
  };
  const partner = Array.isArray(joined.affiliate_partners)
    ? joined.affiliate_partners[0]
    : joined.affiliate_partners;
  if (!partner || partner.status !== 'active') return null;
  // A manual assignment does not retroactively reward historical payments.
  if (
    joined.attribution_source === 'call' &&
    !paymentFollowsCallAttribution(
      invoice.status_transitions?.paid_at ?? event.created,
      joined.attributed_at
    )
  )
    return null;
  const commissionCents = commissionAmountCents(
    grossCents,
    partner.commission_bps
  );
  if (commissionCents <= 0) return null;

  const earnedAt = new Date(event.created * 1000);
  const availableAt = new Date(earnedAt);
  availableAt.setUTCDate(availableAt.getUTCDate() + COMMISSION_HOLD_DAYS);
  const { error } = await db.from('affiliate_commissions').upsert(
    {
      affiliate_id: joined.affiliate_id,
      referral_id: joined.id,
      workspace_id: workspaceId,
      stripe_invoice_id: invoice.id,
      stripe_event_id: event.id,
      gross_cents: grossCents,
      commission_cents: commissionCents,
      commission_bps: partner.commission_bps,
      currency: invoice.currency.toLowerCase(),
      earned_at: earnedAt.toISOString(),
      available_at: availableAt.toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'stripe_invoice_id', ignoreDuplicates: true }
  );
  if (error) throw new Error(error.message);

  await reconcileAffiliateInvoice(db, stripe, invoice.id);
  const { error: referralUpdateError } = await db
    .from('affiliate_referrals')
    .update({
      status: 'paying',
      first_paid_at: joined.first_paid_at ?? earnedAt.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', joined.id);
  if (referralUpdateError) throw new Error(referralUpdateError.message);
  return `affiliate invoice ${invoice.id}: ${commissionCents} ${invoice.currency}`;
}
